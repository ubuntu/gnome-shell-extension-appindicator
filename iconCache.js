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

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as PromiseUtils from './promiseUtils.js';
import * as Util from './util.js';

// The icon cache caches icon objects in case they're reused shortly aftwerwards.
// This is necessary for some indicators like skype which rapidly switch between serveral icons.
// Without caching, the garbage collection would never be able to handle the amount of new icon data.
// If the lifetime of an icon is over, the cache will destroy the icon. (!)
// The presence of active icons will extend the lifetime.

const GC_INTERVAL = 100; // seconds
const LIFETIME_TIMESPAN = 120; // seconds

// how to use: see IconCache.add, IconCache.get
export class IconCache {
    constructor() {
        this._cache = new Map();
        this._activeIcons = Object.create(null);
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

        const oldIcon = this._cache.get(id);
        if (!oldIcon || !oldIcon.equal(icon)) {
            Util.Logger.debug(`IconCache: adding ${id}: ${icon}`);
            this._cache.set(id, icon);
        } else {
            icon = oldIcon;
        }

        this._renewLifetime(id);
        this._checkGC();

        return icon;
    }

    updateActive(iconType, gicon, isActive) {
        if (!gicon)
            return;

        const previousActive = this._activeIcons[iconType];

        if (isActive && [...this._cache.values()].some(icon => icon === gicon))
            this._activeIcons[iconType] = gicon;
        else if (previousActive === gicon)
            delete this._activeIcons[iconType];
        else
            return;

        if (previousActive) {
            this._cache.forEach((icon, id) => {
                if (icon === previousActive)
                    this._renewLifetime(id);
            });
        }
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
        const gicon = this._cache.has(id);
        if (gicon) {
            Object.keys(this._activeIcons).forEach(iconType =>
                this.updateActive(iconType, gicon, false));
            this._remove(id);
            this._checkGC();
        }
    }

    // marks all the icons as removable, if something doesn't claim them before
    weakClear() {
        this._activeIcons = Object.create(null);
        this._checkGC();
    }

    // removes everything from the cache
    clear() {
        this._activeIcons = Object.create(null);
        this._cache.forEach((_icon, id) => this._remove(id));
        this._checkGC();
    }

    // returns an object from the cache, or null if it can't be found.
    get(id) {
        const icon = this._cache.get(id);
        if (icon) {
            Util.Logger.debug(`IconCache: retrieving ${id}: ${icon}`);
            this._renewLifetime(id);
            return icon;
        }

        return null;
    }

    async _checkGC() {
        const cacheIsEmpty = this._cache.size === 0;

        if (!cacheIsEmpty && !this._gcTimeout) {
            Util.Logger.debug('IconCache: garbage collector started');
            let anyUnusedInCache = false;
            this._gcTimeout = new PromiseUtils.TimeoutSecondsPromise(GC_INTERVAL,
                GLib.PRIORITY_LOW);
            try {
                await this._gcTimeout;
                anyUnusedInCache = this._gc();
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, 'IconCache: garbage collector');
            } finally {
                delete this._gcTimeout;
            }

            if (anyUnusedInCache)
                this._checkGC();
        } else if (cacheIsEmpty && this._gcTimeout) {
            Util.Logger.debug('IconCache: garbage collector stopped');
            this._gcTimeout.cancel();
        }
    }

    _gc() {
        const time = new Date().getTime();
        let anyUnused = false;

        this._cache.forEach((icon, id) => {
            if (Object.values(this._activeIcons).includes(icon)) {
                Util.Logger.debug(`IconCache: ${id} is in use.`);
            } else if (this._lifetime.get(id) < time) {
                this._remove(id);
            } else {
                anyUnused = true;
                Util.Logger.debug(`IconCache: ${id} survived this round.`);
            }
        });

        return anyUnused;
    }

    destroy() {
        this.clear();
    }
}
