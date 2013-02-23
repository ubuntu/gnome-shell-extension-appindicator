/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Copyright (C) 2013 Jonas Kuemmerlin <rgcjonas@gmail.com>
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

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const AppIndicator = Extension.imports.appIndicator;
const SNIStatus = AppIndicator.SNIStatus;
const IndicatorStatusIcon = Extension.imports.indicatorStatusIcon;
const IndicatorMessageSource = Extension.imports.indicatorMessageSource;
const Settings = Extension.imports.settings;

const IndicatorDispatcher = new Lang.Class({
	Name: 'IndicatorDispatcher',
	
	_init: function() {
		this._icons = {};
		Settings.Settings.instance.connect("changed", Lang.bind(this, this._settingsChanged));
	},
	
	dispatch: function(indicator) {
		indicator.on('status', Lang.bind(this, this._updatedStatus, indicator));
		this._updatedStatus(indicator);
	},
	
	_updatedStatus: function(indicator) {
	 	if (!indicator) return;
	 	var status = indicator.status;
	 	if (status == SNIStatus.PASSIVE) {
	 		//remove it 
	 		if (indicator.id in this._icons) {
	 			this._remove(indicator);
	 		}
	 	} else if (status == SNIStatus.ACTIVE || status == SNIStatus.NEEDS_ATTENTION) {
	 		if (!(indicator.id in this._icons)) {
	 			this._add(indicator);
	 		}
	 	} else {
	 		log("unknown status on "+indicator.id+": "+status)
	 	}
	 },
	 
	_add: function(indicator) {
		var obj;
		if (Settings.Settings.instance.get(indicator.id) == "blacklist") {
			obj = new NullIcon(indicator);
		} else if (Settings.Settings.instance.get(indicator.id) == "panel") {
			obj = new IndicatorStatusIcon.IndicatorStatusIcon(indicator);
		} else {
			obj = new IndicatorMessageSource.IndicatorMessageSource(indicator);	
		}
		this._icons[indicator.id] = obj;
		indicator.connect('destroy', this._remove.bind(this, indicator));
	},
	
	_remove: function(indicator) {
		this._icons[indicator.id].destroy();
	 	delete this._icons[indicator.id];
	},
	
	_readd: function(id) {
		if (!(id in this._icons)) return;
		var indicator = this._icons[id]._indicator;
		this._remove(indicator);
		this.dispatch(indicator)
	},
	
	_settingsChanged: function(obj, name) {
		if (name) {
			this._readd(name);
		} else {
			//readd every item
			for (var i in this._icons) {
				this._readd(i);
			}
		}
	},
	
	getIconIds: function() {
		return Object.keys(this._icons);
	}
});
IndicatorDispatcher.instance = new IndicatorDispatcher();

//used by IndicatorDispatcher for blacklisted indicators
const NullIcon = new Lang.Class({
	Name: 'IndicatorNullIcon',
	
	_init: function(indicator) {
		this._indicator = indicator;
	},
	destroy: function() {}
});
