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

const Extension = imports.misc.extensionUtils.getCurrentExtension()

const AppIndicator = Extension.imports.appIndicator
const DashIndicatorIcon = Extension.imports.dashIndicatorIcon
const IndicatorMessageSource = Extension.imports.indicatorMessageSource
const IndicatorStatusIcon = Extension.imports.indicatorStatusIcon
const Settings = Extension.imports.settings.Settings
const SNIStatus = AppIndicator.SNIStatus
const Util = Extension.imports.util

/*
 * The IndicatorDispatcher class will get all newly added or changed indicators
 * and delegate them to IndicatorStatusIcon or IndicatorMessageSource or discard them
 * depending on the settings and indicator state
 */
const IndicatorDispatcher = new Lang.Class({
    Name: 'IndicatorDispatcher',
    
    _init: function() {
        this._icons = {};
        this._settingsChangedId = Settings.instance.connect("changed", Lang.bind(this, this._settingsChanged));
    },
    
    dispatch: function(indicator) {
        if (indicator.isReady) this._doDispatch(indicator);
        else indicator.connect("ready", this._doDispatch.bind(this, indicator));
    },
    
    _doDispatch: function(indicator) {
        this._icons[indicator.id] = {
            statusChangedId:    indicator.connect('status', this._updatedStatus.bind(this, indicator)),
            destroyedId:        indicator.connect('destroy', this._freeContainer.bind(this, indicator)),
            currentVisual:      null,
            indicator:          indicator
        }

        this._updatedStatus(indicator);
    },
    
    _updatedStatus: function(indicator) {
        if (!indicator)
            return

        if (indicator.status == SNIStatus.PASSIVE && this._isVisible(indicator))
            this._hide(indicator)
        else if ((indicator.status == SNIStatus.ACTIVE || indicator.status == SNIStatus.NEEDS_ATTENTION)
                 && !this._isVisible(indicator))
            this._show(indicator)
    },

    _isVisible: function(indicator) {
        return (indicator.id in this._icons) && this._icons[indicator.id].currentVisual
    },

    _show: function(indicator) {
        if (Settings.instance.get(indicator.id) == "blacklist")
            this._icons[indicator.id].currentVisual = new NullIcon(indicator)
        else if (Settings.instance.get(indicator.id) == "panel")
            this._icons[indicator.id].currentVisual = new IndicatorStatusIcon.IndicatorStatusIcon(indicator)
        else if (Settings.instance.get(indicator.id) == "dash")
            this._icons[indicator.id].currentVisual = new DashIndicatorIcon.CustomDashIcon(indicator)
        else
            this._icons[indicator.id].currentVisual = new IndicatorMessageSource.IndicatorMessageSource(indicator)
    },
    
    _hide: function(indicator) {
        this._icons[indicator.id].currentVisual.destroy(true)
        this._icons[indicator.id].currentVisual = null
    },
    
    _redisplay: function(id) {
        if (!(id in this._icons))
            return

        let indicator = this._icons[id].indicator;

        if (this._isVisible(indicator)) {
            this._hide(indicator)
            this._show(indicator)
        }
    },

    _freeContainer: function(indicator) {
        if (!(indicator.id in this._icons))
            return

        indicator.disconnect(this._icons[indicator.id].statusChangedId)
        indicator.disconnect(this._icons[indicator.id].destroyedId)

        if (this._isVisible(indicator))
            this._hide(indicator)

        delete this._icons[indicator.id]
    },
    
    _settingsChanged: function(obj, name) {
        if (name) {
            this._redisplay(name);
        } else {
            // readd every item
            for (var i in this._icons) {
                this._redisplay(i);
            }
        }
    },
    
    getIconIds: function() {
        return Object.keys(this._icons);
    },
    
    destroy: function() {
        //FIXME: this is actually never called because the only global instance is never freed
        Settings.instance.disconnect(this._settingsChangedId);
    }
});
IndicatorDispatcher.instance = new IndicatorDispatcher();

// used by IndicatorDispatcher for blacklisted indicators
const NullIcon = new Lang.Class({
    Name: 'IndicatorNullIcon',
    
    _init: function(indicator) {
        this._indicator = indicator;
    },
    destroy: function() {}
});
