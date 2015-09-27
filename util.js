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
const GdkPixbuf = imports.gi.GdkPixbuf
const Gio = imports.gi.Gio
const GLib = imports.gi.GLib
const St = imports.gi.St

const Lang = imports.lang
const Signals = imports.signals

//data: GBytes
const createPixbufFromMemoryImage = function(data) {
    var stream = Gio.MemoryInputStream.new_from_bytes(data);
    return GdkPixbuf.Pixbuf.new_from_stream(stream, null);
}

/**
 * This proxy works completely without an interface xml, making it both flexible
 * and mistake-prone. It will cache properties and emit events, and provides
 * shortcuts for calling methods.
 */
const XmlLessDBusProxy = new Lang.Class({
    Name: 'XmlLessDBusProxy',

    _init: function(params) {
        if (!params.connection || !params.name || !params.path || !params.interface)
            throw new Error("XmlLessDBusProxy: please provide connection, name, path and interface")

        this.connection = params.connection
        this.name = params.name
        this.path = params.path
        this.interface = params.interface
        this.propertyWhitelist = params.propertyWhitelist || []
        this.cachedProperties = {}

        this.invalidateAllProperties(params.onReady)
        this._signalId = this.connection.signal_subscribe(this.name,
                                                          this.interface,
                                                          null,
                                                          this.path,
                                                          null,
                                                          Gio.DBusSignalFlags.NONE,
                                                          this._onSignal.bind(this))
        this._propChangedId = this.connection.signal_subscribe(this.name,
                                                               'org.freedesktop.DBus.Properties',
                                                               'PropertiesChanged',
                                                               this.path,
                                                               null,
                                                               Gio.DBusSignalFlags.NONE,
                                                               this._onPropertyChanged.bind(this))
    },

    setProperty: function(propertyName, valueVariant) {
        //TODO: implement
    },

    /**
     * Initiates recaching the given property.
     *
     * This is useful if the interface notifies the consumer of changed properties
     * in unorthodox ways or if you changed the whitelist
     */
    invalidateProperty: function(propertyName, callback) {
        this.connection.call(this.name,
                             this.path,
                             'org.freedesktop.DBus.Properties',
                             'Get',
                             GLib.Variant.new('(ss)', [ this.interface, propertyName ]),
                             GLib.VariantType.new('(v)'),
                             Gio.DBusCallFlags.NONE,
                             -1,
                             null,
                             this._getPropertyCallback.bind(this, propertyName, callback))
    },

    _getPropertyCallback: function(propertyName, callback, conn, result) {
        try {
            let newValue = conn.call_finish(result).deep_unpack()[0].deep_unpack()

            if (this.propertyWhitelist.indexOf(propertyName) > -1) {
                this.cachedProperties[propertyName] = newValue
                this.emit("-property-changed", propertyName, newValue)
                this.emit("-property-changed::"+propertyName, newValue)
            }
        } catch (e) {
            // this can mean two things:
            //  - the interface is gone (or doesn't conform or whatever)
            //  - the property doesn't exist
            // we do not care and we don't even log it.
            //Logger.debug("XmlLessDBusProxy: while getting property: "+e)
        }

        if (callback) callback()
    },

    invalidateAllProperties: function(callback) {
        let waitFor = 0

        this.propertyWhitelist.forEach(function(prop) {
            waitFor += 1
            this.invalidateProperty(prop, maybeFinished)
        }, this)

        function maybeFinished() {
            waitFor -= 1
            if (waitFor == 0 && callback)
                callback()
        }
    },

    _onPropertyChanged: function(conn, sender, path, iface, signal, params) {
        let [ , changed, invalidated ] = params.deep_unpack()

        for (let i in changed) {
            if (this.propertyWhitelist.indexOf(i) > -1) {
                this.cachedProperties[i] = changed[i].deep_unpack()
                this.emit("-property-changed", i, this.cachedProperties[i])
                this.emit("-property-changed::"+i, this.cachedProperties[i])
            }
        }

        for (let i = 0; i < invalidated.length; ++i) {
            if (this.propertyWhitelist.indexOf(invalidated[i]) > -1)
                this.invalidateProperty(invalidated[i])
        }
    },

    _onSignal: function(conn, sender, path, iface, signal, params) {
        this.emit("-signal", signal, params)
        this.emit(signal, params.deep_unpack())
    },

    call: function(params) {
        if (!params)
            throw new Error("XmlLessDBusProxy::call: need params argument")

        if (!params.name)
            throw new Error("XmlLessDBusProxy::call: missing name")

        if (params.params instanceof GLib.Variant) {
            // good!
        } else if (params.paramTypes && params.paramValues) {
            params.params = GLib.Variant.new('(' + params.paramTypes + ')', params.paramValues)
        } else {
            throw new Error("XmlLessDBusProxy::call: provide either paramType (string) and paramValues (array) or params (GLib.Variant)")
        }

        if (!params.returnTypes)
            params.returnTypes = ''

        if (!params.onSuccess)
            params.onSuccess = function() {}

        if (!params.onError)
            params.onError = function(error) {
                Logger.warn("XmlLessDBusProxy::call: DBus error: "+error)
            }

        this.connection.call(this.name,
                             this.path,
                             this.interface,
                             params.name,
                             params.params,
                             GLib.VariantType.new('(' + params.returnTypes + ')'),
                             Gio.DBusCallFlags.NONE,
                             -1,
                             null,
                             function(conn, result) {
                                 try {
                                     let returnVariant = conn.call_finish(result)
                                     params.onSuccess(returnVariant.deep_unpack())
                                 } catch (e) {
                                     params.onError(e)
                                 }
                             })

    },

    destroy: function() {
        this.emit('-destroy')

        this.disconnectAll()

        this.connection.signal_unsubscribe(this._signalId)
        this.connection.signal_unsubscribe(this._propChangedId)
    }
})
Signals.addSignalMethods(XmlLessDBusProxy.prototype)


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
