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

/* exported StatusNotifierWatcher */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const Extension = imports.misc.extensionUtils.getCurrentExtension();

const AppIndicator = Extension.imports.appIndicator;
const IndicatorStatusIcon = Extension.imports.indicatorStatusIcon;
const Interfaces = Extension.imports.interfaces;
const PromiseUtils = Extension.imports.promiseUtils;
const Util = Extension.imports.util;


// TODO: replace with org.freedesktop and /org/freedesktop when approved
const KDE_PREFIX = 'org.kde';

var WATCHER_BUS_NAME = `${KDE_PREFIX}.StatusNotifierWatcher`;
const WATCHER_OBJECT = '/StatusNotifierWatcher';

const DEFAULT_ITEM_OBJECT_PATH = '/StatusNotifierItem';

/*
 * The StatusNotifierWatcher class implements the StatusNotifierWatcher dbus object
 */
var StatusNotifierWatcher = class AppIndicatorsStatusNotifierWatcher {

    constructor(watchDog) {
        this._watchDog = watchDog;
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(Interfaces.StatusNotifierWatcher, this);
        this._dbusImpl.export(Gio.DBus.session, WATCHER_OBJECT);
        this._cancellable = new Gio.Cancellable();
        this._everAcquiredName = false;
        this._ownName = Gio.DBus.session.own_name(WATCHER_BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            this._acquiredName.bind(this),
            this._lostName.bind(this));
        this._items = new Map();

        this._dbusImpl.emit_signal('StatusNotifierHostRegistered', null);
        this._seekStatusNotifierItems().catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'Looking for StatusNotifierItem\'s');
        });
    }

    _acquiredName() {
        this._everAcquiredName = true;
        this._watchDog.nameAcquired = true;
    }

    _lostName() {
        if (this._everAcquiredName)
            Util.Logger.debug(`Lost name${WATCHER_BUS_NAME}`);
        else
            Util.Logger.warn(`Failed to acquire ${WATCHER_BUS_NAME}`);
        this._watchDog.nameAcquired = false;
    }


    // create a unique index for the _items dictionary
    _getItemId(busName, objPath) {
        return busName + objPath;
    }

    async _registerItem(service, busName, objPath) {
        let id = this._getItemId(busName, objPath);

        if (this._items.has(id)) {
            Util.Logger.warn(`Item ${id} is already registered`);
            return;
        }

        Util.Logger.debug(`Registering StatusNotifierItem ${id}`);

        try {
            const indicator = new AppIndicator.AppIndicator(service, busName, objPath);
            this._items.set(id, indicator);

            indicator.connect('name-owner-changed', async () => {
                if (!indicator.hasNameOwner) {
                    await new PromiseUtils.TimeoutPromise(500,
                        GLib.PRIORITY_DEFAULT, this._cancellable);
                    if (!indicator.hasNameOwner)
                        this._itemVanished(id);
                }
            });

            // if the desktop is not ready delay the icon creation and signal emissions
            await Util.waitForStartupCompletion(indicator.cancellable);
            const statusIcon = new IndicatorStatusIcon.IndicatorStatusIcon(indicator);
            indicator.connect('destroy', () => statusIcon.destroy());

            this._dbusImpl.emit_signal('StatusNotifierItemRegistered',
                GLib.Variant.new('(s)', [indicator.uniqueId]));
            this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems',
                GLib.Variant.new('as', this.RegisteredStatusNotifierItems));
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
            throw e;
        }
    }

    _ensureItemRegistered(service, busName, objPath) {
        let id = this._getItemId(busName, objPath);
        let item = this._items.get(id);

        if (item) {
            // delete the old one and add the new indicator
            Util.Logger.debug(`Attempting to re-register ${id}; resetting instead`);
            item.reset();
            return;
        }

        this._registerItem(service, busName, objPath);
    }

    async _seekStatusNotifierItems() {
        // Some indicators (*coff*, dropbox, *coff*) do not re-register again
        // when the plugin is enabled/disabled, thus we need to manually look
        // for the objects in the session bus that implements the
        // StatusNotifierItem interface... However let's do it after a low
        // priority idle, so that it won't affect startup.
        const cancellable = this._cancellable;
        await new PromiseUtils.IdlePromise(GLib.PRIORITY_LOW, cancellable);
        const bus = Gio.DBus.session;
        const uniqueNames = await Util.getBusNames(bus, cancellable);
        const introspectName = async name => {
            const nodes = await Util.introspectBusObject(bus, name, cancellable);
            nodes.forEach(({ nodeInfo, path }) => {
                if (Util.dbusNodeImplementsInterfaces(nodeInfo, ['org.kde.StatusNotifierItem'])) {
                    Util.Logger.debug(`Found ${name} at ${path} implementing StatusNotifierItem iface`);
                    const id = this._getItemId(name, path);
                    if (!this._items.has(id)) {
                        Util.Logger.warn(`Using Brute-force mode for StatusNotifierItem ${id}`);
                        this._registerItem(path, name, path);
                    }
                }
            });
        };
        await Promise.allSettled([...uniqueNames].map(n => introspectName(n)));
    }

    async RegisterStatusNotifierItemAsync(params, invocation) {
        // it would be too easy if all application behaved the same
        // instead, ayatana patched gnome apps to send a path
        // while kde apps send a bus name
        let [service] = params;
        let busName, objPath;

        if (service.charAt(0) === '/') { // looks like a path
            busName = invocation.get_sender();
            objPath = service;
        } else if (service.match(Util.BUS_ADDRESS_REGEX)) {
            try {
                busName = await Util.getUniqueBusName(invocation.get_connection(),
                    service, this._cancellable);
            } catch (e) {
                logError(e);
            }
            objPath = DEFAULT_ITEM_OBJECT_PATH;
        }

        if (!busName || !objPath) {
            let error = `Impossible to register an indicator for parameters '${
                service.toString()}'`;
            Util.Logger.warn(error);

            invocation.return_dbus_error('org.gnome.gjs.JSError.ValueError',
                error);
            return;
        }

        this._ensureItemRegistered(service, busName, objPath);

        invocation.return_value(null);
    }

    _itemVanished(id) {
        // FIXME: this is useless if the path name disappears while the bus stays alive (not unheard of)
        if (this._items.has(id))
            this._remove(id);
    }

    _remove(id) {
        const indicator = this._items.get(id);
        const { uniqueId } = indicator;
        indicator.destroy();
        this._items.delete(id);

        this._dbusImpl.emit_signal('StatusNotifierItemUnregistered',
            GLib.Variant.new('(s)', [uniqueId]));
        this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems',
            GLib.Variant.new('as', this.RegisteredStatusNotifierItems));
    }

    RegisterStatusNotifierHostAsync(_service, invocation) {
        invocation.return_error_literal(
            Gio.DBusError,
            Gio.DBusError.NOT_SUPPORTED,
            'Registering additional notification hosts is not supported');
    }

    IsNotificationHostRegistered() {
        return true;
    }

    get RegisteredStatusNotifierItems() {
        return Array.from(this._items.values()).map(i => i.uniqueId);
    }

    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return 0;
    }

    destroy() {
        if (!this._isDestroyed) {
            // this doesn't do any sync operation and doesn't allow us to hook up the event of being finished
            // which results in our unholy debounce hack (see extension.js)
            Array.from(this._items.keys()).forEach(i => this._remove(i));
            this._dbusImpl.emit_signal('StatusNotifierHostUnregistered', null);
            Gio.DBus.session.unown_name(this._ownName);
            this._cancellable.cancel();
            this._dbusImpl.unexport();
            delete this._items;
            this._isDestroyed = true;
        }
    }
};
