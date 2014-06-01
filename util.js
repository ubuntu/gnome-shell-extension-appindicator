/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Copyright (C) 2013-2014 Jonas Kuemmerlin <rgcjonas@gmail.com>
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

const Lang = imports.lang;
const St = imports.gi.St;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

/*
 * The standard array map operation, but in async mode
 * `mapFunc` is expected to have the signature `function(element, index, array, callback)` where `callback` is `function(error, result)`.
 * `callback` is expected to have the siganture `function(error, result)`
 *
 * The callback function is called when every mapping operation has finished, with the original array as result.
 * or when at least one mapFunc returned an error, then immediately with that error.
 *
 * If you pass any wrong parameters, the result is undefined (most likely some kind of cryptic error)
 */
function asyncMap(array, mapFunc, callback) {
    if (!callback) callback = function(){};

    var newArray = array.slice(0);
    var toFinish = 0;

    // empty object
    if (newArray.length == 0) {
        callback(null, newArray);
        return;
    }

    for (let i = 0; i < newArray.length; ++i) {
        toFinish += 1;
        mapFunc(newArray[i], i, newArray, function(i, error, result) {
            toFinish -= 1;
            if (error) {
                callback(error);
                callback = function(){};
            } else {
                newArray[i] = result;

                if (toFinish <= 0) {
                    callback(null, newArray);
                }
            }
        }.bind(null, i));
    }
}

//data: GBytes
const createPixbufFromMemoryImage = function(data) {
    var stream = Gio.MemoryInputStream.new_from_bytes(data);
    return GdkPixbuf.Pixbuf.new_from_stream(stream, null);
}

/**
 * Refetches invalidated properties
 *
 * A handler for the "g-properties-changed" signal of a GDbusProxy.
 * It will refetch all invalidated properties and put them in the cache, and
 * then raise another "g-properties-changed" signal with the updated properties.
 *
 * Essentially poor man's G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES.
 */
function refreshInvalidatedProperties(proxy, changed, invalidated) {
    if (invalidated.length < 1) return

    asyncMap(invalidated, function(property, i, a, callback) {
        proxy.g_connection.call(
            proxy.g_name_owner,
            proxy.g_object_path,
            "org.freedesktop.DBus.Properties",
            "Get",
            GLib.Variant.new("(ss)", [ proxy.g_interface_name, property ]),
            GLib.VariantType.new("(v)"),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            function(conn, res) {
                try {
                    let newValue = proxy.g_connection.call_finish(res).deep_unpack()[0]
                    callback(null, {
                        name: property,
                        value: newValue
                    })
                } catch (error) {
                    callback(error)
                }
            }
        );
    }, function(error, result) {
        if (error) {
            //FIXME: what else can we do?
            Logger.error("While refreshing invalidated properties: "+error)
        } else {
            // build up the dictionary we feed into the variant later
            let changed = {}

            for each(let i in result) {
                changed[i.name] = i.value

                proxy.set_cached_property(i.name, i.value)
            }

            // avoid any form of recursion
            GLib.idle_add(GLib.PRIORITY_DEFAULT, proxy.emit.bind(proxy, "g-properties-changed", new GLib.Variant("a{sv}", changed), []))
        }
    });
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
