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

const Lang = imports.lang
const Signals = imports.signals

const Extension = imports.misc.extensionUtils.getCurrentExtension()

const Convenience = Extension.imports.convenience

/*
 * The Settings class manages the settings requested for each indicator.
 * It listens to gsettings changes and emits changed events for each single changed override
 */
const Settings = new Lang.Class({
    Name: 'Settings',
    
    _init: function() {
        this._default = "message-tray";
        this._overrides = {};
        this._gsettings = Convenience.getSettings();
        this._gsettings.connect("changed", Lang.bind(this, this._gsettingsChanged));
        this._gsettingsChanged(); // initial read
    },
    
    get: function(id) {
        if (id in this._overrides) return this._overrides[id];
        else return this._default;
    },
    
    set: function(id, override) {
        if (override == "auto") {
            delete this._overrides[id];
        } else {
            this._overrides[id] = override;
        }
        this._gsettings.set_string("overrides", JSON.stringify(this._overrides));
        this.emit("changed", id);
    },
    
    getDefault: function() {
        return this._default;
    },
    
    setDefault: function(val) {
        this._default = val;
        this._gsettings.set_string("default", this._default);
        this.emit("changed", null);
    },
    
    getOverrides: function() {
        return this._overrides;
    },
    
    _gsettingsChanged: function() {
        var def = this._gsettings.get_string("default");
        if (def != this._default) {
            this._default = def;
            this.emit("changed", null); // null should tell the listeners to revalidate every item
        }
        // sync overrides with local copy
        var overrides = JSON.parse(this._gsettings.get_string("overrides"));
        var changed = [];
        for (var i in overrides) {
            if (overrides[i] != this._overrides[i]) {
                changed.push(i);
            }
            delete this._overrides[i];
        }
        // any old overrides left?
        for (var i in this._overrides) {
            changed.push(i);
        }
        // save new overrides
        this._overrides = overrides;
        // emit events
        changed.forEach(this.emit.bind(this, 'changed'));
    }
});
Signals.addSignalMethods(Settings.prototype);
// lazy singleton implementation
Settings.instance = new Settings();
