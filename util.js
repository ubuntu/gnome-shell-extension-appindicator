// This file is part of the AppIndicator/KStatusNotifierItem GNOME Shell extension
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {BaseStatusIcon} from './indicatorStatusIcon.js';

export const BUS_ADDRESS_REGEX = /([a-zA-Z0-9._-]+\.[a-zA-Z0-9.-]+)|(:[0-9]+\.[0-9]+)$/;

Gio._promisify(Gio.DBusConnection.prototype, 'call');
Gio._promisify(Gio._LocalFilePrototype, 'read');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');

export function indicatorId(service, busName, objectPath) {
    if (service !== busName && service?.match(BUS_ADDRESS_REGEX))
        return service;

    return `${busName}@${objectPath}`;
}

export async function getUniqueBusName(bus, name, cancellable) {
    if (name[0] === ':')
        return name;

    if (!bus)
        bus = Gio.DBus.session;

    const variantName = new GLib.Variant('(s)', [name]);
    const [unique] = (await bus.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus',
        'GetNameOwner', variantName, new GLib.VariantType('(s)'),
        Gio.DBusCallFlags.NONE, -1, cancellable)).deep_unpack();

    return unique;
}

export async function getBusNames(bus, cancellable) {
    if (!bus)
        bus = Gio.DBus.session;

    const [names] = (await bus.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus',
        'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE,
        -1, cancellable)).deep_unpack();

    const uniqueNames = new Map();
    const requests = names.map(name => getUniqueBusName(bus, name, cancellable));
    const results = await Promise.allSettled(requests);

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
            let namesForBus = uniqueNames.get(result.value);
            if (!namesForBus) {
                namesForBus = new Set();
                uniqueNames.set(result.value, namesForBus);
            }
            namesForBus.add(result.value !== names[i] ? names[i] : null);
        } else if (!result.reason.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            Logger.debug(`Impossible to get the unique name of ${names[i]}: ${result.reason}`);
        }
    }

    return uniqueNames;
}

async function getProcessId(connectionName, cancellable = null, bus = Gio.DBus.session) {
    const res = await bus.call('org.freedesktop.DBus', '/',
        'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
        new GLib.Variant('(s)', [connectionName]),
        new GLib.VariantType('(u)'),
        Gio.DBusCallFlags.NONE,
        -1,
        cancellable);
    const [pid] = res.deepUnpack();
    return pid;
}

export async function getProcessName(connectionName, cancellable = null,
    priority = GLib.PRIORITY_DEFAULT, bus = Gio.DBus.session) {
    const pid = await getProcessId(connectionName, cancellable, bus);
    const cmdFile = Gio.File.new_for_path(`/proc/${pid}/cmdline`);
    const inputStream = await cmdFile.read_async(priority, cancellable);
    const bytes = await inputStream.read_bytes_async(2048, priority, cancellable);
    const textDecoder = new TextDecoder();
    return textDecoder.decode(bytes.toArray().map(v => !v ? 0x20 : v));
}

export async function* introspectBusObject(bus, name, cancellable,
    interfaces = undefined, path = undefined) {
    if (!path)
        path = '/';

    const [introspection] = (await bus.call(name, path, 'org.freedesktop.DBus.Introspectable',
        'Introspect', null, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE,
        5000, cancellable)).deep_unpack();

    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(introspection);

    if (!interfaces || dbusNodeImplementsInterfaces(nodeInfo, interfaces))
        yield {nodeInfo, path};

    if (path === '/')
        path = '';

    for (const subNodeInfo of nodeInfo.nodes) {
        const subPath = `${path}/${subNodeInfo.path}`;
        yield* introspectBusObject(bus, name, cancellable, interfaces, subPath);
    }
}

function dbusNodeImplementsInterfaces(nodeInfo, interfaces) {
    if (!(nodeInfo instanceof Gio.DBusNodeInfo) || !Array.isArray(interfaces))
        return false;

    return interfaces.some(iface => nodeInfo.lookup_interface(iface));
}

export class NameWatcher extends Signals.EventEmitter {
    constructor(name) {
        super();

        this._watcherId = Gio.DBus.session.watch_name(name,
            Gio.BusNameWatcherFlags.NONE, () => {
                this._nameOnBus = true;
                Logger.debug(`Name ${name} appeared`);
                this.emit('changed');
                this.emit('appeared');
            }, () => {
                this._nameOnBus = false;
                Logger.debug(`Name ${name} vanished`);
                this.emit('changed');
                this.emit('vanished');
            });
    }

    destroy() {
        this.emit('destroy');

        Gio.DBus.session.unwatch_name(this._watcherId);
        delete this._watcherId;
    }

    get nameOnBus() {
        return !!this._nameOnBus;
    }
}

function connectSmart3A(src, signal, handler) {
    const id = src.connect(signal, handler);
    let destroyId = 0;

    if (src.connect && (!(src instanceof GObject.Object) || GObject.signal_lookup('destroy', src))) {
        destroyId = src.connect('destroy', () => {
            src.disconnect(id);
            src.disconnect(destroyId);
        });
    }

    return [id, destroyId];
}

function connectSmart4A(src, signal, target, method) {
    if (typeof method !== 'function')
        throw new TypeError('Unsupported function');

    method = method.bind(target);
    const signalId = src.connect(signal, method);
    const onDestroy = () => {
        src.disconnect(signalId);
        if (srcDestroyId)
            src.disconnect(srcDestroyId);
        if (tgtDestroyId)
            target.disconnect(tgtDestroyId);
    };

    // GObject classes might or might not have a destroy signal
    // JS Classes will not complain when connecting to non-existent signals
    const srcDestroyId = src.connect && (!(src instanceof GObject.Object) ||
        GObject.signal_lookup('destroy', src)) ? src.connect('destroy', onDestroy) : 0;
    const tgtDestroyId = target.connect && (!(target instanceof GObject.Object) ||
        GObject.signal_lookup('destroy', target)) ? target.connect('destroy', onDestroy) : 0;

    return [signalId, srcDestroyId, tgtDestroyId];
}

// eslint-disable-next-line valid-jsdoc
/**
 * Connect signals to slots, and remove the connection when either source or
 * target are destroyed
 *
 * Usage:
 *      Util.connectSmart(srcOb, 'signal', tgtObj, 'handler')
 * or
 *      Util.connectSmart(srcOb, 'signal', () => { ... })
 */
export function connectSmart(...args) {
    if (arguments.length === 4)
        return connectSmart4A(...args);
    else
        return connectSmart3A(...args);
}

function disconnectSmart3A(src, signalIds) {
    const [id, destroyId] = signalIds;
    src.disconnect(id);

    if (destroyId)
        src.disconnect(destroyId);
}

function disconnectSmart4A(src, tgt, signalIds) {
    const [signalId, srcDestroyId, tgtDestroyId] = signalIds;

    disconnectSmart3A(src, [signalId, srcDestroyId]);

    if (tgtDestroyId)
        tgt.disconnect(tgtDestroyId);
}

export function disconnectSmart(...args) {
    if (arguments.length === 2)
        return disconnectSmart3A(...args);
    else if (arguments.length === 3)
        return disconnectSmart4A(...args);

    throw new TypeError('Unexpected number of arguments');
}

let _defaultTheme;
export function getDefaultTheme() {
    if (_defaultTheme)
        return _defaultTheme;

    _defaultTheme = new St.IconTheme();
    return _defaultTheme;
}

export function destroyDefaultTheme() {
    _defaultTheme = null;
}

// eslint-disable-next-line valid-jsdoc
/**
 * Helper function to wait for the system startup to be completed.
 * Adding widgets before the desktop is ready to accept them can result in errors.
 */
export async function waitForStartupCompletion(cancellable) {
    if (Main.layoutManager._startingUp)
        await Main.layoutManager.connect_once('startup-complete', cancellable);
}

/**
 * Helper class for logging stuff
 */
export class Logger {
    static _logStructured(logLevel, message, extraFields = {}) {
        if (!Object.values(GLib.LogLevelFlags).includes(logLevel)) {
            Logger._logStructured(GLib.LogLevelFlags.LEVEL_WARNING,
                'logLevel is not a valid GLib.LogLevelFlags');
            return;
        }

        if (!Logger._levels.includes(logLevel))
            return;

        let fields = {
            'SYSLOG_IDENTIFIER': this.uuid,
            'MESSAGE': `${message}`,
        };

        let thisFile = null;
        const {stack} = new Error();
        for (let stackLine of stack.split('\n')) {
            stackLine = stackLine.replace('resource:///org/gnome/Shell/', '');
            const [code, line] = stackLine.split(':');
            const [func, file] = code.split(/@(.+)/);

            if (!thisFile || thisFile === file) {
                thisFile = file;
                continue;
            }

            fields = Object.assign(fields, {
                'CODE_FILE': file || '',
                'CODE_LINE': line || '',
                'CODE_FUNC': func || '',
            });

            break;
        }

        GLib.log_structured(Logger._domain, logLevel, Object.assign(fields, extraFields));
    }

    static init(extension) {
        if (Logger._domain)
            return;

        const allLevels = Object.values(GLib.LogLevelFlags);
        const domains = GLib.getenv('G_MESSAGES_DEBUG');
        const {name: domain} = extension.metadata;
        this.uuid = extension.metadata.uuid;
        Logger._domain = domain.replaceAll(' ', '-');

        if (domains === 'all' || (domains && domains.split(' ').includes(Logger._domain))) {
            Logger._levels = allLevels;
        } else {
            Logger._levels = allLevels.filter(
                l => l <= GLib.LogLevelFlags.LEVEL_WARNING);
        }
    }

    static debug(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_DEBUG, message);
    }

    static message(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_MESSAGE, message);
    }

    static warn(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_WARNING, message);
    }

    static error(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_ERROR, message);
    }

    static critical(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_CRITICAL, message);
    }
}

export function versionCheck(required) {
    const current = Config.PACKAGE_VERSION;
    const currentArray = current.split('.');
    const [major] = currentArray;
    return major >= required;
}

export function tryCleanupOldIndicators() {
    const indicatorType = BaseStatusIcon;
    const indicators = Object.values(Main.panel.statusArea).filter(i => i instanceof indicatorType);

    try {
        const panelBoxes = [
            Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox,
        ];

        panelBoxes.forEach(box =>
            indicators.push(...box.get_children().filter(i => i instanceof indicatorType)));
    } catch (e) {
        logError(e);
    }

    new Set(indicators).forEach(i => i.destroy());
}

export function addActor(obj, actor) {
    if (obj.add_actor)
        obj.add_actor(actor);
    else
        obj.add_child(actor);
}

export function removeActor(obj, actor) {
    if (obj.remove_actor)
        obj.remove_actor(actor);
    else
        obj.remove_child(actor);
}

export const CancellableChild = GObject.registerClass({
    Properties: {
        'parent': GObject.ParamSpec.object(
            'parent', 'parent', 'parent',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            Gio.Cancellable.$gtype),
    },
},
class CancellableChild extends Gio.Cancellable {
    _init(parent) {
        if (parent && !(parent instanceof Gio.Cancellable))
            throw TypeError('Not a valid cancellable');

        super._init({parent});

        if (parent) {
            if (parent.is_cancelled()) {
                this.cancel();
                return;
            }

            this._connectToParent();
        }
    }

    _connectToParent() {
        this._connectId = this.parent.connect(() => {
            this._realCancel();

            if (this._disconnectIdle)
                return;

            this._disconnectIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                delete this._disconnectIdle;
                this._disconnectFromParent();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _disconnectFromParent() {
        if (this._connectId && !this._disconnectIdle) {
            this.parent.disconnect(this._connectId);
            delete this._connectId;
        }
    }

    _realCancel() {
        Gio.Cancellable.prototype.cancel.call(this);
    }

    cancel() {
        this._disconnectFromParent();
        this._realCancel();
    }
});
