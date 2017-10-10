// Copyright (C) 2013-2014 Jonas Kümmerlin <rgcjonas@gmail.com>
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

    if (!bus)
        bus = Gio.DBus.session;

    let variant_name = new GLib.Variant("(s)", [name]);
    let [unique] = bus.call_sync("org.freedesktop.DBus", "/", "org.freedesktop.DBus",
                                 "GetNameOwner", variant_name, null,
                                 Gio.DBusCallFlags.NONE, -1, null).deep_unpack();

    Logger.debug("Unique name of "+name+" is "+unique);

    return unique;
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
