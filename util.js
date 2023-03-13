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

/* exported CancellableChild, getUniqueBusName, getBusNames,
   introspectBusObject, dbusNodeImplementsInterfaces, waitForStartupCompletion,
   connectSmart, disconnectSmart, versionCheck, getDefaultTheme, destroyDefaultTheme,
   getProcessName, indicatorId, tryCleanupOldIndicators, DBusProxy */

const ByteArray = imports.byteArray;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const GObject = imports.gi.GObject;
const St = imports.gi.St;

const Config = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const PromiseUtils = Extension.imports.promiseUtils;
const Signals = imports.signals;

var BUS_ADDRESS_REGEX = /([a-zA-Z0-9._-]+\.[a-zA-Z0-9.-]+)|(:[0-9]+\.[0-9]+)$/;

PromiseUtils._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');
PromiseUtils._promisify(Gio._LocalFilePrototype, 'read', 'read_finish');
PromiseUtils._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

function indicatorId(service, busName, objectPath) {
    if (service && service !== busName && service.match(BUS_ADDRESS_REGEX))
        return service;

    return `${busName}@${objectPath}`;
}

async function getUniqueBusName(bus, name, cancellable) {
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

async function getBusNames(bus, cancellable) {
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

async function getProcessName(connectionName, cancellable = null,
    priority = GLib.PRIORITY_DEFAULT, bus = Gio.DBus.session) {
    const pid = await getProcessId(connectionName, cancellable, bus);
    const cmdFile = Gio.File.new_for_path(`/proc/${pid}/cmdline`);
    const inputStream = await cmdFile.read_async(priority, cancellable);
    const bytes = await inputStream.read_bytes_async(2048, priority, cancellable);
    return ByteArray.toString(bytes.toArray().map(v => !v ? 0x20 : v));
}

async function* introspectBusObject(bus, name, cancellable,
    interfaces = undefined, path = undefined) {
    if (!path)
        path = '/';

    const [introspection] = (await bus.call(name, path, 'org.freedesktop.DBus.Introspectable',
        'Introspect', null, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE,
        5000, cancellable)).deep_unpack();

    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(introspection);

    if (!interfaces || dbusNodeImplementsInterfaces(nodeInfo, interfaces))
        yield { nodeInfo, path };

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

var NameWatcher = class AppIndicatorsNameWatcher {
    constructor(name) {
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
};
Signals.addSignalMethods(NameWatcher.prototype);

function connectSmart3A(src, signal, handler) {
    let id = src.connect(signal, handler);
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
function connectSmart(...args) {
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

function disconnectSmart(...args) {
    if (arguments.length === 2)
        return disconnectSmart3A(...args);
    else if (arguments.length === 3)
        return disconnectSmart4A(...args);

    throw new TypeError('Unexpected number of arguments');
}

let _defaultTheme;
function getDefaultTheme() {
    if (_defaultTheme)
        return _defaultTheme;

    if (St.IconTheme) {
        _defaultTheme = new St.IconTheme();
        return _defaultTheme;
    }

    if (Gdk.Screen && Gdk.Screen.get_default()) {
        _defaultTheme = Gtk.IconTheme.get_default();
        if (_defaultTheme)
            return _defaultTheme;
    }

    _defaultTheme = new Gtk.IconTheme();
    _defaultTheme.set_custom_theme(St.Settings.get().gtk_icon_theme);
    return _defaultTheme;
}

function destroyDefaultTheme() {
    _defaultTheme = null;
}

// eslint-disable-next-line valid-jsdoc
/**
 * Helper function to wait for the system startup to be completed.
 * Adding widgets before the desktop is ready to accept them can result in errors.
 */
async function waitForStartupCompletion(cancellable) {
    if (Main.layoutManager._startingUp)
        await Main.layoutManager.connect_once('startup-complete', cancellable);

    if (!St.IconTheme && !Meta.is_wayland_compositor()) {
        const displayManager = Gdk.DisplayManager.get();
        if (displayManager && !displayManager.get_default_display())
            await displayManager.connect_once('display-opened', cancellable);
    }
}

/**
 * Helper class for logging stuff
 */
var Logger = class AppIndicatorsLogger {
    static _logStructured(logLevel, message, extraFields = {}) {
        if (!Object.values(GLib.LogLevelFlags).includes(logLevel)) {
            Logger._logStructured(GLib.LogLevelFlags.LEVEL_WARNING,
                'logLevel is not a valid GLib.LogLevelFlags');
            return;
        }

        Logger._init(Extension.metadata.name);
        if (!Logger._levels.includes(logLevel))
            return;

        let fields = {
            'SYSLOG_IDENTIFIER': Extension.metadata.uuid,
            'MESSAGE': `${message}`,
        };

        let thisFile = null;
        let { stack } = new Error();
        for (let stackLine of stack.split('\n')) {
            stackLine = stackLine.replace('resource:///org/gnome/Shell/', '');
            let [code, line] = stackLine.split(':');
            let [func, file] = code.split(/@(.+)/);

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

    static _init(domain) {
        if (Logger._domain)
            return;

        const allLevels = Object.values(GLib.LogLevelFlags);
        const domains = GLib.getenv('G_MESSAGES_DEBUG');
        Logger._domain = domain.replaceAll ? domain.replaceAll(' ', '-')
            : domain.split(' ').join('-');

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
};

function versionCheck(required) {
    if (ExtensionUtils.versionCheck instanceof Function)
        return ExtensionUtils.versionCheck(required, Config.PACKAGE_VERSION);

    const current = Config.PACKAGE_VERSION;
    let currentArray = current.split('.');
    let major = currentArray[0];
    let minor = currentArray[1];
    for (let i = 0; i < required.length; i++) {
        let requiredArray = required[i].split('.');
        if (requiredArray[0] === major &&
            (requiredArray[1] === undefined && isFinite(minor) ||
                requiredArray[1] === minor))
            return true;
    }
    return false;
}

function tryCleanupOldIndicators() {
    const IndicatorStatusIcon = Extension.imports.indicatorStatusIcon;
    const indicatorType = IndicatorStatusIcon.BaseStatusIcon;
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

var CancellableChild = GObject.registerClass({
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

        super._init({ parent });

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

var DBusProxy = GObject.registerClass({
    Signals: { 'destroy': {} },
}, class DBusProxy extends Gio.DBusProxy {
    static get TUPLE_VARIANT_TYPE() {
        if (!this._tupleVariantType)
            this._tupleVariantType = new GLib.VariantType('(v)');

        return this._tupleVariantType;
    }

    static destroy() {
        delete this._tupleType;
    }

    _init(busName, objectPath, interfaceInfo, flags = Gio.DBusProxyFlags.NONE) {
        if (interfaceInfo.signals.length)
            Logger.warn('Avoid exposing signals to gjs!');

        super._init({
            gConnection: Gio.DBus.session,
            gInterfaceName: interfaceInfo.name,
            gInterfaceInfo: interfaceInfo,
            gName: busName,
            gObjectPath: objectPath,
            gFlags: flags,
        });

        this._signalIds = [];

        if (!(flags & Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS)) {
            this._signalIds.push(this.connect('g-signal',
                (_proxy, ...args) => this._onSignal(...args)));
        }

        this._signalIds.push(this.connect('notify::g-name-owner', () =>
            this._onNameOwnerChanged()));
    }

    async initAsync(cancellable) {
        cancellable = new CancellableChild(cancellable);
        await this.init_async(GLib.PRIORITY_DEFAULT, cancellable);
        this._cancellable = cancellable;

        this.gInterfaceInfo.methods.map(m => m.name).forEach(method =>
            this._ensureAsyncMethod(method));
    }

    destroy() {
        this.emit('destroy');

        this._signalIds.forEach(id => this.disconnect(id));

        if (this._cancellable)
            this._cancellable.cancel();
    }

    // This can be removed when we will have GNOME 43 as minimum version
    _ensureAsyncMethod(method) {
        if (this[`${method}Async`])
            return;

        if (!this[`${method}Remote`])
            throw new Error(`Missing remote method '${method}'`);

        this[`${method}Async`] = function (...args) {
            return new Promise((resolve, reject) => {
                this[`${method}Remote`](...args, (ret, e) => {
                    if (e)
                        reject(e);
                    else
                        resolve(ret);
                });
            });
        };
    }

    _onSignal() {
    }

    getProperty(propertyName, cancellable) {
        return this.gConnection.call(this.gName,
            this.gObjectPath, 'org.freedesktop.DBus.Properties', 'Get',
            GLib.Variant.new('(ss)', [this.gInterfaceName, propertyName]),
            DBusProxy.TUPLE_VARIANT_TYPE, Gio.DBusCallFlags.NONE, -1,
            cancellable);
    }

    getProperties(cancellable) {
        return this.gConnection.call(this.gName,
            this.gObjectPath, 'org.freedesktop.DBus.Properties', 'GetAll',
            GLib.Variant.new('(s)', [this.gInterfaceName]),
            GLib.VariantType.new('(a{sv})'), Gio.DBusCallFlags.NONE, -1,
            cancellable);
    }
});

if (imports.system.version < 17101) {
    /* In old versions wrappers are not applied to sub-classes, so let's do it */
    DBusProxy.prototype.init_async = Gio.DBusProxy.prototype.init_async;
}
