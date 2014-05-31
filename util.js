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
const byteArray = imports.byteArray;

/*
 * UtilMixin:
 * Mixes in the given properties in _mixin into the object
 */
const Mixin = new Lang.Class({
    Name: 'UtilMixin',
    
    _init: function() {
        this._lateMixin = {};
    },
    
    _mixin: {},
    
    _conserve: [],
    
    attach: function(o) {
        if (!this._mixin) return;
        if (this._conserve && this._conserve.forEach) {
            o._conserved = {};
            this._conserve.forEach(function(e) {
                    if (e in o) {
                        o._conserved[e] = o[e];
                    } else if (o.prototype && e in o.prototype) {
                        o._conserved[e] = o.prototype[e];
                    } else {
                        Logger.warn("attempted to conserve property '"+e+"' but not found.");
                    }
            });
        }
        for (var i in this._mixin) {
            o[i] = this._mixin[i];
        }
        for (var i in this._lateMixin) {
            o[i] = this._lateMixin[i]
        }
        if (this._mixinInit) {
            this._mixinInit.apply(o, Array.prototype.slice.call(arguments, 1));
        }
    }
});

/*
 * AsyncTaskQueue:
 * Schedules asynchrouns tasks which may not overlap during execution
 *
 * The scheduled functions are required to take a callback as their last arguments, and all other arguments
 * need to be bound using Function.prototype.bind
 */
const AsyncTaskQueue = new Lang.Class({
    Name: 'AsyncTaskQueue',
    
    _init: function() {
        this._taskList = [];
    },
    
    // shedule the async task for execution or execute right away if there's no current task
    add: function(task, callback, context) {
        this._taskList.push({task: task, callback: callback, context: context});
        if (this._taskList.length == 1) this._executeNext();
    },
    
    _executeNext: function() {
        this._taskList[0].task.call(null, (function() {
            if (this._taskList[0].callback) this._taskList[0].callback.apply(this._taskList[0].context, arguments);
            this._taskList.shift();
            if (this._taskList.length) this._executeNext();
        }).bind(this));
    }
});

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

const createActorFromPixmap = function(pixmap, icon_size) {
    if (!(pixmap && pixmap.length)) return null;
    // pixmap is actually an array of icons, so that hosts can pick the
    // best size (here considered as the area covered by the icon)
    // XXX: should we use sum of width and height instead? or consider
    // only one dimension?
    let best = 0;
    let bestHeight = pixmap[0][1];
    let goal = icon_size;
    for (let i = 1; i < pixmap.length; i++) {
        let height = pixmap[i][1];
        if (Math.abs(goal - height) < Math.abs(goal - bestHeight)) {
            best = i;
            bestHeight = height;
        }
    }
    let [width, height, imageData] = pixmap[best];
    // each image is ARGB32
    // XXX: we're not getting a rowstride! let's hope images are compressed enough
    let rowstride = width * 4;
    return St.TextureCache.get_default().load_from_raw(imageData, imageData.length,
                                                       true, width, height, rowstride,
                                                       icon_size);
};

//data: GBytes
const createActorFromMemoryImage = function(data) {
    var stream = Gio.MemoryInputStream.new_from_bytes(data);
    var pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
    return new St.Icon({ gicon: pixbuf, icon_size: pixbuf.get_width() });
}

//HACK: GLib.Variant.prototype.get_data_as_bytes only exists in recent gjs versions
const variantToGBytes = function(variant) {
    if (typeof(GLib.Variant.prototype.get_data_as_bytes) != "undefined") {
        return variant.get_data_as_bytes();
    } else {
        //FIXME: this is very very inefficient. we're sorry.
        var data = variant.deep_unpack(); //will create an array of doubles...
        var data_length = data.length;
        var array = new imports.byteArray.ByteArray(data_length);
        for (var i = 0; i < data_length; i++) {
            array[i] = data[i];
        }
        return GLib.ByteArray.free_to_bytes(array); //this can't be correct but it suprisingly works like a charm.
    }
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
