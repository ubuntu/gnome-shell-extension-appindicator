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
const Clutter = imports.gi.Clutter;

/*
 * IndicatorStatusIcon implements an icon in the system status area
 */
const IndicatorStatusIcon = new Lang.Class({
    Name: 'IndicatorStatusIcon',
    Extends: PanelMenu.Button,
    
    _init: function(indicator) {
        this.parent(null, 'FIXME'); //no name yet (?)
        
        this._indicator = indicator;
        
        this._iconBox = new St.BoxLayout();
        if (!this._box) { // Gnome Shell 3.10
            this._box = new St.BoxLayout();
            this.actor.add_actor(this._box);
        }
        this._box.destroy_all_children();
        this._box.add_actor(this._iconBox);
        this._boxClickDisconnectHandler = this.actor.connect("button-press-event", this._boxClicked.bind(this));
        
        log("Adding indicator as status menu");
        
        //stuff would keep us alive forever if icon changes places
        var h = this._indicatorHandlerIds = []; 
        h.push(this._indicator.connect('icon', Lang.bind(this, this._updateIcon)));
        h.push(this._indicator.connect('ready', Lang.bind(this, this._display)));
        h.push(this._indicator.connect('reset', Lang.bind(this, this._reset)));
        h.push(this._indicator.connect('label', Lang.bind(this, this._updateLabel)));
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
        var icon = this._indicator.getIcon(Panel.PANEL_ICON_SIZE);
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
        this._indicatorHandlerIds.forEach(this._indicator.disconnect.bind(this._indicator));
        if (this.menu.destroyDbusMenu) {
            this.menu.destroyDbusMenu();
        }
        this._iconBox.remove_all_children(); //save from destroying, icon cache will take care of that
        this._box.destroy_all_children();
        this.actor.disconnect(this._boxClickDisconnectHandler);
        
        //call parent
        this.parent();
    },
    
    _display: function() {
        var display_finish = (function(){
            Main.panel.addToStatusArea("appindicator-"+this._indicator.id, this, 1, 'right');
        }).bind(this);
        
        this._indicator.getMenu((function(menu){
            if (menu != null) {
                menu.attach(this.menu, display_finish);
            } else {
                display_finish();
            }
        }).bind(this));
    },
    
    _boxClicked: function(actor, event) {
        //HACK: event should be a ClutterButtonEvent but we get only a ClutterEvent (why?)
        //      because we can't access click_count, we'll create our own double click detector.
        var treshold = Clutter.Settings.get_default().double_click_time;
        var now = new Date().getTime();
        if (this._lastClicked && (now - this._lastClicked) < treshold) {
            this._lastClicked = null; //reset double click detector
            this._indicator.open();
        } else {
            this._lastClicked = now;
        }
    }
});
