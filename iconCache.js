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

/* exported IconCache */

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const PromiseUtils = Extension.imports.promiseUtils;
const Util = Extension.imports.util;

// The icon cache caches icon objects in case they're reused shortly aftwerwards.
// This is necessary for some indicators like skype which rapidly switch between serveral icons.
// Without caching, the garbage collection would never be able to handle the amount of new icon data.
// If the lifetime of an icon is over, the cache will destroy the icon. (!)
// The presence of an inUse property set to true on the icon will extend the lifetime.

const GC_INTERVAL = 60; // seconds
const LIFETIME_TIMESPAN = 10; // seconds

// how to use: see IconCache.add, IconCache.get
var IconCache = class AppIndicatorsIconCache {
    constructor() {
        this._cache = new Map();
        this._lifetime = new Map(); // we don't want to attach lifetime to the object
    }

    add(id, icon) {
        if (!(icon instanceof Gio.Icon)) {
            Util.Logger.critical('IconCache: Only Gio.Icons are supported');
            return null;
        }

        if (!id) {
            Util.Logger.critical('IconCache: Invalid ID provided');
            return null;
        }

        let oldIcon = this._cache.get(id);
        if (!oldIcon || !oldIcon.equals(icon)) {
            Util.Logger.debug(`IconCache: adding ${id}: ${icon}`);
            this._cache.set(id, icon);
        } else {
            icon = oldIcon;
        }

        this._renewLifetime(id);
        this._checkGC();

        return icon;
    }

    _remove(id) {
        Util.Logger.debug(`IconCache: removing ${id}`);

        this._cache.delete(id);
        this._lifetime.delete(id);
    }

    _renewLifetime(id) {
        this._lifetime.set(id, new Date().getTime() + LIFETIME_TIMESPAN * 1000);
    }

    forceDestroy(id) {
        if (this._cache.has(id)) {
            this._remove(id);
            this._checkGC();
        }
    }

    // marks all the icons as removable, if something doesn't claim them before
    weakClear() {
        this._cache.forEach(icon => (icon.inUse = false));
        this._checkGC();
    }

    // removes everything from the cache
    clear() {
        this._cache.forEach((_icon, id) => this._remove(id));
        this._checkGC();
    }

    // returns an object from the cache, or null if it can't be found.
    get(id) {
        let icon = this._cache.get(id);
        if (icon) {
            Util.Logger.debug(`IconCache: retrieving ${id}: ${icon}`);
            this._renewLifetime(id);
            return icon;
        }

        return null;
    }

    async _checkGC() {
        let cacheIsEmpty = this._cache.size === 0;

        if (!cacheIsEmpty && !this._gcTimeout) {
            Util.Logger.debug('IconCache: garbage collector started');
            this._gcTimeout = new PromiseUtils.TimeoutSecondsPromise(GC_INTERVAL,
                GLib.PRIORITY_LOW);
            try {
                await this._gcTimeout;
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, 'IconCache: garbage collector');
            }
        } else if (cacheIsEmpty && this._gcTimeout) {
            Util.Logger.debug('IconCache: garbage collector stopped');
            this._gcTimeout.cancel();
            delete this._gcTimeout;
        }
    }

    _gc() {
        let time = new Date().getTime();
        this._cache.forEach((icon, id) => {
            if (icon.inUse)
                Util.Logger.debug(`IconCache: ${id} is in use.`);
            else if (this._lifetime.get(id) < time)
                this._remove(id);
            else
                Util.Logger.debug(`IconCache: ${id} survived this round.`);
        });

        return true;
    }

    destroy() {
        this.clear();
    }
};
