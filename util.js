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
const Gio = imports.gi.Gio
const GLib = imports.gi.GLib
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const GObject = imports.gi.GObject
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Params = imports.misc.params;

var refreshPropertyOnProxy = function(proxy, propertyName, params) {
    if (!proxy._proxyCancellables)
        proxy._proxyCancellables = new Map();

    params = Params.parse(params, {
        skipEqualtyCheck: false,
    });

    let cancellable = cancelRefreshPropertyOnProxy(proxy, {
        propertyName,
        addNew: true
    });

    proxy.g_connection.call(
        proxy.g_name,
        proxy.g_object_path,
        'org.freedesktop.DBus.Properties',
        'Get',
        GLib.Variant.new('(ss)', [ proxy.g_interface_name, propertyName ]),
        GLib.VariantType.new('(v)'),
        Gio.DBusCallFlags.NONE,
        -1,
        cancellable,
        (conn, result) => {
        try {
            let valueVariant = conn.call_finish(result).deep_unpack()[0];
            proxy._proxyCancellables.delete(propertyName);

            if (!params.skipEqualtyCheck &&
                proxy.get_cached_property(propertyName).equal(valueVariant))
                return;

            proxy.set_cached_property(propertyName, valueVariant)

            // synthesize a batched property changed event
            if (!proxy._proxyChangedProperties)
                proxy._proxyChangedProperties = {};
            proxy._proxyChangedProperties[propertyName] = valueVariant;

            if (!proxy._proxyPropertiesEmitId) {
                proxy._proxyPropertiesEmitId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT_IDLE, 16, () => {
                    delete proxy._proxyPropertiesEmitId;

                    proxy.emit('g-properties-changed', GLib.Variant.new('a{sv}',
                        proxy._proxyChangedProperties), []);
                    delete proxy._proxyChangedProperties;

                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                // the property may not even exist, silently ignore it
                Logger.debug(`While refreshing property ${propertyName}: ${e}`);
                proxy._proxyCancellables.delete(propertyName);
                delete proxy._proxyChangedProperties[propertyName];
            }
        }
    });
}

var cancelRefreshPropertyOnProxy = function(proxy, params) {
    if (!proxy._proxyCancellables)
        return;

    params = Params.parse(params, {
        propertyName: undefined,
        addNew: false,
    });

    if (params.propertyName !== undefined) {
        let cancellable = proxy._proxyCancellables.get(params.propertyName);
        if (cancellable) {
            cancellable.cancel();

            if (!params.addNew)
                proxy._proxyCancellables.delete(params.propertyName);
        }

        if (params.addNew) {
            cancellable = new Gio.Cancellable();
            proxy._proxyCancellables.set(params.propertyName, cancellable);
            return cancellable;
        }
    } else {
        if (proxy._proxyPropertiesEmitId) {
            GLib.source_remove(proxy._proxyPropertiesEmitId);
            delete proxy._proxyPropertiesEmitId;
        }
        proxy._proxyCancellables.forEach(c => c.cancel());
        delete proxy._proxyChangedProperties;
        delete proxy._proxyCancellables;
    }
}

var getUniqueBusNameSync = function(bus, name) {
    if (name[0] == ':')
        return name;

    if (!bus)
        bus = Gio.DBus.session;

    let variant_name = new GLib.Variant("(s)", [name]);
    let [unique] = bus.call_sync("org.freedesktop.DBus", "/", "org.freedesktop.DBus",
                                 "GetNameOwner", variant_name, null,
                                 Gio.DBusCallFlags.NONE, -1, null).deep_unpack();

    return unique;
}

var traverseBusNames = function(bus, cancellable, callback) {
    if (!bus)
        bus = Gio.DBus.session;

    if (typeof(callback) !== "function")
        throw new Error("No traversal callback provided");

    bus.call("org.freedesktop.DBus", "/", "org.freedesktop.DBus",
             "ListNames", null, new GLib.VariantType("(as)"), 0, -1, cancellable,
             function (bus, task) {
                if (task.had_error())
                    return;

                let [names] = bus.call_finish(task).deep_unpack();
                let unique_names = new Set();

                for (let name of names) {
                    try {
                        unique_names.add(getUniqueBusNameSync(bus, name));
                    } catch (e) {
                        Logger.debug(`Impossible to get the unique name of ${name}: ${e}`);
                    }
                }

                unique_names.forEach((name) => callback(bus, name, cancellable));
            });
}

var introspectBusObject = function(bus, name, cancellable, filterFunction, targetCallback, path) {
    if (!path)
        path = "/";

    if (typeof targetCallback !== "function")
        throw new Error("No introspection callback defined");

    bus.call (name, path, "org.freedesktop.DBus.Introspectable", "Introspect",
              null, new GLib.VariantType("(s)"), Gio.DBusCallFlags.NONE, -1,
              cancellable, function (bus, task) {
                if (task.had_error())
                    return;

                let introspection = bus.call_finish(task).deep_unpack().toString();
                let node_info = Gio.DBusNodeInfo.new_for_xml(introspection);

                if ((typeof filterFunction === "function" && filterFunction(node_info) === true) ||
                    !filterFunction) {
                    targetCallback(name, path);
                }

                if (path === "/")
                    path = ""

                for (let sub_nodes of node_info.nodes) {
                    let sub_path = path+"/"+sub_nodes.path;
                    introspectBusObject (bus, name, cancellable, filterFunction,
                                         targetCallback, sub_path);
                }
            });
}

var dbusNodeImplementsInterfaces = function(node_info, interfaces) {
    if (!(node_info instanceof Gio.DBusNodeInfo) || !Array.isArray(interfaces))
        return false;

    for (let iface of interfaces) {
        if (node_info.lookup_interface(iface) !== null)
            return true;
    }

    return false;
}

const connectSmart3A = function(src, signal, handler) {
    let id = src.connect(signal, handler)

    if (src.connect && (!(src instanceof GObject.Object) || GObject.signal_lookup('destroy', src))) {
        let destroy_id = src.connect('destroy', () => {
            src.disconnect(id)
            src.disconnect(destroy_id)
        })
    }
}

const connectSmart4A = function(src, signal, target, method) {
    if (typeof method === 'string')
        method = target[method].bind(target)
    if (typeof method === 'function')
        method = method.bind(target)

    let signal_id = src.connect(signal, method)

    // GObject classes might or might not have a destroy signal
    // JS Classes will not complain when connecting to non-existent signals
    let src_destroy_id = src.connect && (!(src instanceof GObject.Object) || GObject.signal_lookup('destroy', src)) ? src.connect('destroy', on_destroy) : 0
    let tgt_destroy_id = target.connect && (!(target instanceof GObject.Object) || GObject.signal_lookup('destroy', target)) ? target.connect('destroy', on_destroy) : 0

    function on_destroy() {
        src.disconnect(signal_id)
        if (src_destroy_id) src.disconnect(src_destroy_id)
        if (tgt_destroy_id) target.disconnect(tgt_destroy_id)
    }
}

/**
 * Connect signals to slots, and remove the connection when either source or
 * target are destroyed
 *
 * Usage:
 *      Util.connectSmart(srcOb, 'signal', tgtObj, 'handler')
 * or
 *      Util.connectSmart(srcOb, 'signal', () => { ... })
 */
var connectSmart = function() {
    if (arguments.length == 4)
        return connectSmart4A.apply(null, arguments)
    else
        return connectSmart3A.apply(null, arguments)
}

/**
 * Helper class to wait for the system startup to be completed.
 * Adding widgets before the desktop is ready to accept them can result in errors.
 */
var StartUpCompletionHelper = class AppIndicators_StartUpCompletionHelper {

    constructor() {
        this._startupComplete = false;
        this._displayAvailable = false;
        this._listeners = new Set();

        // If the desktop is still starting up, we must wait until it is ready
        if (Main.layoutManager._startingUp) {
            let startupPreparedId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(startupPreparedId);
                this._startupComplete = true;
                this._checkStartUpComplete();
            });
        } else {
            this._startupComplete = true;
        }

        // Ensure that the default Gdk Screen is available
        if (Gtk.IconTheme.get_default() == null) {
            let waitForThemeId = Gdk.DisplayManager.get().connect('display-opened', () => {
                Gdk.DisplayManager.get().disconnect(waitForThemeId);
                this._displayAvailable = true;
                this._checkStartUpComplete();
            });
        } else {
            this._displayAvailable = true;
        }
    }

    _checkStartUpComplete() {
        if (this._startupComplete && this._displayAvailable) {
            this._listeners.forEach(callback => callback());
            this._listeners.clear();
        }
    }

    whenStartUpComplete(callback) {
        if (this._startupComplete && this._displayAvailable) {
            callback();
        } else {
            this._listeners.add(callback);
        }
    }
};

/**
 * Helper class for logging stuff
 */
var Logger = class AppIndicators_Logger {
    static _logStructured(logLevel, message, extraFields = {}) {
        if (!Object.values(GLib.LogLevelFlags).includes(logLevel)) {
            _logStructured(GLib.LogLevelFlags.LEVEL_WARNING,
                'logLevel is not a valid GLib.LogLevelFlags');
            return;
        }

        let domain = Extension.metadata.name;
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

        GLib.log_structured(domain, logLevel, Object.assign(fields, extraFields));
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
