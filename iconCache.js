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

const Lang = imports.lang
const Mainloop = imports.mainloop

const Util = imports.misc.extensionUtils.getCurrentExtension().imports.util;

// The icon cache caches icon objects in case they're reused shortly aftwerwards.
// This is necessary for some indicators like skype which rapidly switch between serveral icons.
// Without caching, the garbage collection would never be able to handle the amount of new icon data.
// If the lifetime of an icon is over, the cache will destroy the icon. (!)
// The presence of an inUse property set to true on the icon will extend the lifetime.

// how to use: see IconCache.add, IconCache.get
const IconCache = new Lang.Class({
    Name: 'IconCache',

    LIFETIME_TIMESPAN: 5000, //5s
    GC_INTERVAL: 10000, //10s

    _init: function() {
        this._cache = {};
        this._lifetime = {}; //we don't want to attach lifetime to the object
        this._gc();
    },

    add: function(id, o) {
        //Util.Logger.debug("IconCache: adding "+id);
        if (!(o && id)) return null;
        if (id in this._cache && this._cache[id] !== o)
            this._remove(id);
        this._cache[id] = o;
        this._lifetime[id] = new Date().getTime() + this.LIFETIME_TIMESPAN;
        return o;
    },

    _remove: function(id) {
        //Util.Logger.debug('IconCache: removing '+id);
        if ('destroy' in this._cache[id]) this._cache[id].destroy();
        delete this._cache[id];
        delete this._lifetime[id];
    },

    forceDestroy: function(id) {
        this._remove(id);
    },

    // removes everything from the cache
    clear: function() {
        for (let id in this._cache)
            this._remove(id)
    },

    // returns an object from the cache, or null if it can't be found.
    get: function(id) {
        if (id in this._cache) {
            //Util.Logger.debug('IconCache: retrieving '+id);
            this._lifetime[id] = new Date().getTime() + this.LIFETIME_TIMESPAN; //renew lifetime
            return this._cache[id];
        }
        else return null;
    },

    _gc: function() {
        var time = new Date().getTime();
        for (var id in this._cache) {
            if (this._cache[id].inUse) {
                //Util.Logger.debug ("IconCache: " + id + " is in use.");
                continue;
            } else if (this._lifetime[id] < time) {
                this._remove(id);
            } else {
                //Util.Logger.debug("IconCache: " + id + " survived this round.");
            }
        }
        if (!this._stopGc) Mainloop.timeout_add(this.GC_INTERVAL, Lang.bind(this, this._gc));
        return false; //we just added our timeout again.
    },

    destroy: function() {
        this._stopGc = true;
        this.clear();
    }
});
