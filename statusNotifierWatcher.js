// Copyright (C) 2011 Giovanni Campagna
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
const Gtk = imports.gi.Gtk

const Lang = imports.lang
const Mainloop = imports.mainloop
const ShellConfig = imports.misc.config
const Signals = imports.signals

const Extension = imports.misc.extensionUtils.getCurrentExtension()

const AppIndicator = Extension.imports.appIndicator
const Config = Extension.imports.config
const Interfaces = Extension.imports.interfaces
const StatusNotifierDispatcher = Extension.imports.statusNotifierDispatcher
const Util = Extension.imports.util


// TODO: replace with org.freedesktop and /org/freedesktop when approved
const KDE_PREFIX = 'org.kde';
const AYATANA_PREFIX = 'org.ayatana';
const AYATANA_PATH_PREFIX = '/org/ayatana';

const WATCHER_BUS_NAME = KDE_PREFIX + '.StatusNotifierWatcher';
const WATCHER_INTERFACE = WATCHER_BUS_NAME;
const WATCHER_OBJECT = '/StatusNotifierWatcher';

const ITEM_OBJECT = '/StatusNotifierItem';

/*
 * The StatusNotifierWatcher class implements the StatusNotifierWatcher dbus object
 */
const StatusNotifierWatcher = new Lang.Class({
    Name: 'StatusNotifierWatcher',

    _init: function() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(Interfaces.StatusNotifierWatcher, this);
        this._dbusImpl.export(Gio.DBus.session, WATCHER_OBJECT);
        this._everAcquiredName = false;
        this._ownName = Gio.DBus.session.own_name(WATCHER_BUS_NAME,
                                  Gio.BusNameOwnerFlags.NONE,
                                  Lang.bind(this, this._acquiredName),
                                  Lang.bind(this, this._lostName));
        this._items = { };
        this._nameWatcher = { };
    },

    _acquiredName: function() {
        this._everAcquiredName = true;
    },

    _lostName: function() {
        if (this._everAcquiredName)
            Util.Logger.debug('Lost name' + WATCHER_BUS_NAME);
        else
            Util.Logger.warn('Failed to acquire ' + WATCHER_BUS_NAME);
    },


    // create a unique index for the _items dictionary
    _getItemId: function(bus_name, obj_path) {
        return bus_name + obj_path;
    },

    RegisterStatusNotifierItemAsync: function(params, invocation) {
        // it would be too easy if all application behaved the same
        // instead, ayatana patched gnome apps to send a path
        // while kde apps send a bus name
        let service = params[0];
        let bus_name, obj_path;
        if (service.charAt(0) == '/') { // looks like a path
            bus_name = invocation.get_sender();
            obj_path = service;
        } else { // we hope it is a bus name
            bus_name = service;
            obj_path = ITEM_OBJECT;
        }

        let id = this._getItemId(bus_name, obj_path);

        if(this._items[id]) {
            //delete the old one and add the new indicator
            Util.Logger.warn("Attempting to re-register "+id+"; resetting instead");
            this._items[id].reset();
        } else {
            Util.Logger.debug("registering "+id+" for the first time.");
            this._items[id] = new AppIndicator.AppIndicator(bus_name, obj_path);
            this._dbusImpl.emit_signal('ServiceRegistered', GLib.Variant.new('(s)', service));
            this._nameWatcher[id] = Gio.DBus.session.watch_name(bus_name, Gio.BusNameWatcherFlags.NONE, null,
                                        Lang.bind(this, this._itemVanished));
            StatusNotifierDispatcher.IndicatorDispatcher.instance.dispatch(this._items[id]);
            this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems', GLib.Variant.new('as', this.RegisteredStatusNotifierItems));
            Util.Logger.debug("done registering");
        }
        invocation.return_value(null);
    },

    _itemVanished: function(proxy, bus_name) {
        // FIXME: this is useless if the path name disappears while the bus stays alive (not unheard of)
        for (var i in this._items) {
            if (i.indexOf(bus_name) == 0) {
                this._remove(i);
            }
        }
    },

    _remove: function(id) {
        this._items[id].destroy();
        delete this._items[id];
        Gio.DBus.session.unwatch_name(this._nameWatcher[id]);
        delete this._nameWatcher[id];
        this._dbusImpl.emit_signal('ServiceUnregistered', GLib.Variant.new('(s)', id));
        this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems', GLib.Variant.new('as', this.RegisteredStatusNotifierItems));
    },

    RegisterNotificationHost: function(service) {
        throw new Gio.DBusError('org.gnome.Shell.UnsupportedMethod',
                        'Registering additional notification hosts is not supported');
    },

    IsNotificationHostRegistered: function() {
        return true;
    },

    ProtocolVersion: function() {
        // "The version of the protocol the StatusNotifierWatcher instance implements." [sic]
        // in what syntax?
        return "%s/%s (KDE; compatible; mostly) GNOME Shell/%s".format(Config.id, Config.version, ShellConfig.PACKAGE_VERSION);
    },

    get RegisteredStatusNotifierItems() {
        return Object.keys(this._items);
    },

    get IsStatusNotifierHostRegistered() {
        return true;
    },

    destroy: function() {
        if (!this._isDestroyed) {
            // this doesn't do any sync operation and doesn't allow us to hook up the event of being finished
            // which results in our unholy debounce hack (see extension.js)
            Gio.DBus.session.unown_name(this._ownName);
            this._dbusImpl.unexport();
            for (var i in this._nameWatcher) {
                Gio.DBus.session.unwatch_name(this._nameWatcher[i]);
            }
            delete this._nameWatcher;
            for (var i in this._items) {
                this._items[i].destroy();
            }
            delete this._items;
            this._isDestroyed = true;
        }
    }
});
