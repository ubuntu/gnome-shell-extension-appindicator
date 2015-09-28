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
    let signal_id = src.connect(signal, target[method].bind(target))

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
 * will take the given signals and handlers, connect them to the object
 * and push the id needed to disconnect it into the given array.
 * the id array is returned, too
 *
 * if you do not pass a predefined array, it will be created for you.
 */
const connectAndSaveId = function(target, handlers /* { "signal": handler } */, idArray) {
    idArray = typeof idArray != 'undefined' ? idArray : []
    for (let signal in handlers) {
        idArray.push(target.connect(signal, handlers[signal]))
    }
    return idArray
}

/**
 * will connect the given handlers to the object, and automatically disconnect them
 * when the 'destroy' signal is emitted
 */
const connectAndRemoveOnDestroy = function(target, handlers, /* optional */ destroyTarget, /* optional */ destroySignal) {
    var ids, destroyId

    ids = connectAndSaveId(target, handlers)

    if (typeof destroyTarget == 'undefined') destroyTarget = target
    if (typeof destroySignal == 'undefined') destroySignal = 'destroy'

    destroyId = destroyTarget.connect(destroySignal, function() {
        disconnectArray(target, ids)
        destroyTarget.disconnect(destroyId)
    })
}

/**
 * disconnect an array of signal handler ids. The ids are then removed from the array.
 */
const disconnectArray = function(target, idArray) {
    for (let handler = idArray.shift(); handler !== undefined; handler = idArray.shift()) {
        target.disconnect(handler);
    }
}

/**
 * connects a handler and removes it after the first call, or if the source object is destroyed
 */
const connectOnce = function(target, signal, handler, /* optional */ destroyTarget, /* optional */ destroySignal) {
    var signalId, destroyId

    if (typeof destroyTarget == 'undefined') destroyTarget = target
    if (typeof destroySignal == 'undefined') destroySignal = 'destroy'

    signalId = target.connect(signal, function() {
        target.disconnect(signalId)
        handler.apply(this, arguments)
    })

    if (!destroyTarget.connect)
        return

    destroyId = destroyTarget.connect(destroySignal, function() {
        target.disconnect(signalId)
    })
}

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
