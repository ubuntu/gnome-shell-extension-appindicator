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

const GLib = imports.gi.GLib
const GObject = imports.gi.GObject

const Mainloop = imports.mainloop

const Util = imports.misc.extensionUtils.getCurrentExtension().imports.util;

// The icon cache caches icon objects in case they're reused shortly aftwerwards.
// This is necessary for some indicators like skype which rapidly switch between serveral icons.
// Without caching, the garbage collection would never be able to handle the amount of new icon data.
// If the lifetime of an icon is over, the cache will destroy the icon. (!)
// The presence of an inUse property set to true on the icon will extend the lifetime.

const LIFETIME_TIMESPAN = 5000; // milli-seconds
const GC_INTERVAL = 10; // seconds

// how to use: see IconCache.add, IconCache.get
var IconCache = class AppIndicators_IconCache {
    constructor() {
        this._cache = {};
        this._lifetime = {}; //we don't want to attach lifetime to the object
        this._destroyNotify = {};
    }

    add(id, o) {
        if (!(o && id))
            return null;

        if (!(id in this._cache) || this._cache[id] !== o) {
            this._remove(id);

            //Util.Logger.debug("IconCache: adding "+id,o);
            this._cache[id] = o;

            if ((o instanceof GObject.Object) && GObject.signal_lookup('destroy', o)) {
                this._destroyNotify[id] = o.connect('destroy', () => {
                    this._remove(id);
                });
            }
        }

        this._renewLifetime(id);
        this._checkGC();

        return o;
    }

    _remove(id) {
        if (!(id in this._cache))
            return;

        //Util.Logger.debug('IconCache: removing '+id);

        let object = this._cache[id];

        if ((object instanceof GObject.Object) && GObject.signal_lookup('destroy', object))
            object.disconnect(this._destroyNotify[id]);

        if (typeof object.destroy === 'function')
            object.destroy();

        delete this._cache[id];
        delete this._lifetime[id];
        delete this._destroyNotify[id];

        this._checkGC();
    }

    _renewLifetime(id) {
        if (id in this._cache)
            this._lifetime[id] = new Date().getTime() + LIFETIME_TIMESPAN;
    }

    forceDestroy(id) {
        this._remove(id);
    }

    // removes everything from the cache
    clear() {
        for (let id in this._cache)
            this._remove(id)

        this._checkGC();
    }

    // returns an object from the cache, or null if it can't be found.
    get(id) {
        if (id in this._cache) {
            //Util.Logger.debug('IconCache: retrieving '+id);
            this._renewLifetime(id);
            return this._cache[id];
        }

        return null;
    }

    _checkGC() {
        let cacheIsEmpty = (Object.keys(this._cache).length === 0);

        if (!cacheIsEmpty && !this._gcTimeout) {
            //Util.Logger.debug("IconCache: garbage collector started");
            this._gcTimeout = Mainloop.timeout_add_seconds(GC_INTERVAL,
                                                           this._gc.bind(this));
        } else if (cacheIsEmpty && this._gcTimeout) {
            //Util.Logger.debug("IconCache: garbage collector stopped");
            GLib.Source.remove(this._gcTimeout);
            delete this._gcTimeout;
        }
    }

    _gc() {
        var time = new Date().getTime();
        for (var id in this._cache) {
            if (this._cache[id].inUse) {
                //Util.Logger.debug("IconCache: " + id + " is in use.");
                continue;
            } else if (this._lifetime[id] < time) {
                this._remove(id);
            } else {
                //Util.Logger.debug("IconCache: " + id + " survived this round.");
            }
        }

        return true;
    }

    destroy() {
        this.clear();
    }
};
