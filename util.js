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
const GObject = imports.gi.GObject

const Lang = imports.lang
const Signals = imports.signals

const refreshPropertyOnProxy = function(proxy, property_name) {
    proxy.g_connection.call(proxy.g_name,
                            proxy.g_object_path,
                            'org.freedesktop.DBus.Properties',
                            'Get',
                            GLib.Variant.new('(ss)', [ proxy.g_interface_name, property_name ]),
                            GLib.VariantType.new('(v)'),
                            Gio.DBusCallFlags.NONE,
                            -1,
                            null,
                            function(conn, result) {
                                try {
                                    let value_variant = conn.call_finish(result).deep_unpack()[0]

                                    proxy.set_cached_property(property_name, value_variant)

                                    // synthesize a property changed event
                                    let changed_obj = {}
                                    changed_obj[property_name] = value_variant
                                    proxy.emit('g-properties-changed', GLib.Variant.new('a{sv}', changed_obj), [])
                                } catch (e) {
                                    // the property may not even exist, silently ignore it
                                    //Logger.debug("While refreshing property "+property_name+": "+e)
                                }
                            })
}

const getUniqueBusNameSync = function(bus, name) {
    if (name[0] == ':')
        return name;

    if (typeof bus === "undefined" || !bus)
        bus = Gio.DBus.session;

    let variant_name = new GLib.Variant("(s)", [name]);
    let [unique] = bus.call_sync("org.freedesktop.DBus", "/", "org.freedesktop.DBus",
                                 "GetNameOwner", variant_name, null,
                                 Gio.DBusCallFlags.NONE, -1, null).deep_unpack();

    return unique;
}

const traverseBusNames = function(bus, cancellable, callback) {
    if (typeof bus === "undefined" || !bus)
        bus = Gio.DBus.session;

    if (typeof(callback) !== "function")
        throw new Error("No traversal callback provided");

    bus.call("org.freedesktop.DBus", "/", "org.freedesktop.DBus",
             "ListNames", null, new GLib.VariantType("(as)"), 0, -1, cancellable,
             function (bus, task) {
                if (task.had_error())
                    return;

                let [names] = bus.call_finish(task).deep_unpack();
                let unique_names = [];

                for (let name of names) {
                    let unique = getUniqueBusNameSync(bus, name);
                    if (unique_names.indexOf(unique) == -1)
                        unique_names.push(unique);
                }

                for (let name of unique_names)
                    callback(bus, name, cancellable);
            });
}

const introspectBusObject = function(bus, name, cancellable, filterFunction, targetCallback, path) {
    if (typeof path === "undefined" || !path)
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
                    typeof filterFunction === "undefined" || !filterFunction) {
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

const dbusNodeImplementsInterfaces = function(node_info, interfaces) {
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
        let destroy_id = src.connect('destroy', function() {
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
 *      Util.connectSmart(srcOb, 'signal', function() { ... })
 */
const connectSmart = function() {
    if (arguments.length == 4)
        return connectSmart4A.apply(null, arguments)
    else
        return connectSmart3A.apply(null, arguments)
}

/**
 * Helper class for logging stuff
 */
const Logger = {
    _log: function(prefix, message) {
        global.log("[AppIndicatorSupport-"+prefix+"] "+message)
    },

    debug: function(message) {
        Logger._log("DEBUG", message);
    },

    warn: function(message) {
        Logger._log("WARN", message);
    },

    error: function(message) {
        Logger._log("ERROR", message);
    },

    fatal: function(message) {
        Logger._log("FATAL", message);
    }
};

/**
 * Workaround for https://bugzilla.gnome.org/show_bug.cgi?id=734071
 *
 * Will append the given name with a number to distinguish code loaded later from the last loaded version
 */
const WORKAROUND_RELOAD_TYPE_REGISTER = function(name) {
    return 'Gjs_' + name + '__' + global['--appindicator-loaded-count']
}

// this will only execute once when the extension is loaded
if (!global['--appindicator-loaded-count'])
    global['--appindicator-loaded-count'] = 1
else
    global['--appindicator-loaded-count']++
