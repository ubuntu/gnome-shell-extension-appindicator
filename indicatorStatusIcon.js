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
const PanelMenu = imports.ui.panelMenu;
const St = imports.gi.St;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const IconCache = Extension.imports.iconCache;
const DBusMenu = Extension.imports.dbusMenu;
const Main = imports.ui.main;
const Panel = imports.ui.panel;

const IndicatorStatusIcon = new Lang.Class({
	Name: 'IndicatorStatusIcon',
	Extends: PanelMenu.SystemStatusButton,
	
	_init: function(indicator) {
		this.parent(null, 'FIXME'); //no name yet (?)
		
		this._indicator = indicator;
		
		this._iconBox = new St.BoxLayout();
		this._box.destroy_all_children();
		this._box.add_actor(this._iconBox);
		
		this._indicator.connect('icon', Lang.bind(this, this._updateIcon));
		this._indicator.connect('ready', Lang.bind(this, this._display));
		this._indicator.connect('reset', Lang.bind(this, this._reset));
		this._indicator.connect('label', Lang.bind(this, this._updateLabel));
		if (this._indicator.isReady) {
			//indicator already ready when adding? unheard of, but we still handle it.
			this._updateIcon();
			this._updateLabel();
			this._display();
		}
	},
	
	_updateIcon: function() {
		if (this._iconBox.firstChild && this._iconBox.firstChild.inUse) this._iconBox.firstChild.inUse = false;
		this._iconBox.remove_all_children();
		var icon = IconCache.IconCache.instance.get(this._indicator.iconName + "@" + Panel.PANEL_ICON_SIZE);
		if (!icon) {
			icon = this._indicator.createIcon(Panel.PANEL_ICON_SIZE);
			IconCache.IconCache.instance.add(this._indicator.iconName + "@" + Panel.PANEL_ICON_SIZE, icon);
		}
		icon.inUse = true;
		this._iconBox.add_actor(icon);
	},
	
	_updateLabel: function() {
		var label = this._indicator.label;
		if (label) {
			if (!this._label || !this._labelBin) {
				this._labelBin = new St.Bin({ y_align: St.Align.MIDDLE, y_fill: false });
				this._label = new St.Label();
				this._labelBin.add_actor(this._label);
				this._box.add_actor(this._labelBin);
			}
			this._label.set_text(label);
			if (!this._box.contains(this._labelBin)) this._box.add_actor(this._labelBin); //FIXME: why is it suddenly necessary?
		} else {
			if (this._label) {
				this._labelBin.destroy_all_children();
				this._box.remove_actor(this._labelBin);
				this._labelBin.destroy();
				delete this._labelBin;
				delete this._label;
			}
		}
	},
	
	_reset: function() {
		this._updateIcon();
		if (this.menu.reset) {
			this.menu.reset();
		}
	},
	
	destroy: function() {
		log('destroying '+this._indicator.id+'...');
		//remove from panel
		for (var i in Main.panel.statusArea) {
			if (Main.panel.statusArea[i] === this._reset) {
				delete Main.panel.statusArea[i];
			}
		}
		
		//destroy stuff owned by us
		if (this.menu.destroyDbusMenu) {
			this.menu.destroyDbusMenu();
		}
		this._iconBox.remove_all_children(); //save from destroying, icon cache will take care of that
		this._box.destroy_all_children();
		
		//call parent
		PanelMenu.SystemStatusButton.prototype.destroy.apply(this);
	},
	
	_display: function() {
		if (this._indicator.menuPath) {
			new DBusMenu.Menu(this._indicator.busName, this._indicator.menuPath).attach(this.menu);
		}
		Main.panel.addToStatusArea("appindicator-"+this._indicator.id, this, 1, 'right');
	}
});