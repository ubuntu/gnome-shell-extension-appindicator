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
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const AppIndicator = Extension.imports.appIndicator;
const IconCache = Extension.imports.iconCache;
const DBusMenu = Extension.imports.dbusMenu;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gtk = imports.gi.Gtk;
const Clutter = imports.gi.Clutter;

const IndicatorMessageSource = new Lang.Class({
    Name: 'IndicatorMessageSource',
    Extends: MessageTray.Source,
    
    _init: function(indicator) {
        this.parent("FIXME", null);
        
        this._indicator = indicator;
        this.keepTrayOnSummaryClick = true;
        this.showInLockScreen = false;
        this.isChat = indicator.isChat;
        
        //notification is async because it carries the menu
        this._notification = new IndicatorNotification(this, (function() {
            this._iconBox = new St.BoxLayout();
            
            var h = this._indicatorHandlerIds = [];
            h.push(this._indicator.connect('icon', Lang.bind(this, this._updateIcon)));
            h.push(this._indicator.connect('ready', Lang.bind(this, this._display)));
            h.push(this._indicator.connect('reset', Lang.bind(this, this._reset)));
            this.connect('clicked', Lang.bind(this, this._handleClicked));
            if (this._indicator.isReady) {
                this._updateIcon();
                this._display();
            }
        }).bind(this));
    },
    
    _handleClicked: function() {
        if (this._notification._menu) {
            this._notification._menu.preOpen();
        }
    },
    
    _display: function() {
        if (!Main.messageTray.contains(this)) {
            Main.messageTray.add(this);
            this.pushNotification(this._notification);
            //HACK: disable menu scrolling //FIXME: menu might becom higher than screen
            var item = Main.messageTray.getSummaryItems()[Main.messageTray._getIndexOfSummaryItemForSource(this)];
            item.notificationStackView.vscrollbar_policy = Gtk.PolicyType.NEVER;
        }
    },
    
    get title() {
        return this._indicator.title;
    },
    
    set title(val) {
        //ignore
    }, 
    
    _reset: function() {
    
    },
    
    buildRightClickMenu: function() {
        return null;
    },
    
    getSummaryIcon: function() {
        return this._iconBox;
    },
    
    _updateIcon: function() {
        if (this._iconBox.firstChild && this._iconBox.firstChild.inUse) this._iconBox.firstChild.inUse = false;
        this._iconBox.remove_all_children();
        var icon = this._indicator.getIcon(this.SOURCE_ICON_SIZE);
        this._iconBox.add_actor(icon);
    },
    
    destroy: function() {
        //if (Main.messageTray.contains(this)) Main.messageTray.remove(this);
        log("Destroying "+this._indicator.id);
        this._indicatorHandlerIds.forEach(this._indicator.disconnect.bind(this._indicator));
        if (this._notification._menu) this._notification._menu.destroyDbusMenu();
        this._iconBox.remove_all_children();
        MessageTray.Source.prototype.destroy.apply(this);
    },
    
    handleSummaryClick: function() {
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
        return false;
    }
});

const PopupMenuEmbedded = new Lang.Class({
    Name: 'PopupMenuEmbedded',
    Extends: PopupMenu.PopupMenu,
    
    _init: function() {
        //HACK: we subclass PopupMenu but call the constructor of PopupMenuBase only. PopupMenu does too much for us.
        PopupMenu.PopupMenuBase.prototype._init.apply(this, null, 'popup-menu');
        this._boxWrapper = new Shell.GenericContainer();
        //looking at popupMenu.js from gnome shell, it seems like we don't need to disconnect them
        this._boxWrapper.connect('get-preferred-width', Lang.bind(this, this._boxGetPreferredWidth));
        this._boxWrapper.connect('get-preferred-height', Lang.bind(this, this._boxGetPreferredHeight));
        this._boxWrapper.connect('allocate', Lang.bind(this, this._boxAllocate));
        this._boxWrapper.add_actor(this.box);
        
        this.actor = this._boxWrapper;
        this.actor._delegate = this;
        this.isOpen = true;
    },
    
    //ignore.
    open: function() { },
    close: function() { }
})

const IndicatorNotification = new Lang.Class({
    Name: 'IndicatorNotification',
    Extends: MessageTray.Notification,

    _init: function(source, cb) {
        this.parent(source, source.title, null, { customContent: true });
        
        var init_finish = (function(menu) {
            this._box = new St.BoxLayout({ vertical: true });
        
            // set the notification as resident
            this.setResident(true);
            
            if (menu) {
                this._menu = new PopupMenuEmbedded();
                menu.attach(this._menu);
                this._box.add_actor(this._menu.actor);
                this._menu.preOpen(); //menu will always be opened
            }
            
            this.actor.destroy();
            this.actor = this._box; //HACK: force the whole bubble to be our menu
            this.enableScrolling(false);
            
            cb();
        }).bind(this);
        
        source._indicator.getMenu(init_finish);
    },
});