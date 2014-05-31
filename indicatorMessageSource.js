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
const Util = Extension.imports.util;

/*
 * A MessageTray.Source subclass that implements an indicator icon in the message tray
 */
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
            
            if (this._indicator.isReady) {
                this._updateIcon();
                this._display();
            }
        }).bind(this));
    },
    
    _display: function() {
        if (!Main.messageTray.contains(this)) {
            Main.messageTray.add(this);
            this.pushNotification(this._notification);
            //HACK: disable menu scrolling //FIXME: menu might becom higher than screen
            if (typeof(Main.messageTray.getSummaryItems) != 'undefined') {
                var item = Main.messageTray.getSummaryItems()[Main.messageTray._getIndexOfSummaryItemForSource(this)];
            } else {
                var item = Main.messageTray._sources.get(this).summaryItem;
            }
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
    
    destroy: function(fromDispatcher) {
        //HACK: In 3.10, the message tray just destroys the source whenever someone clicks the close button
        //      even though the notification is resident. StatusNotificationDispatcher will signal us
        //      if we need to comply with the request. Ignoring it thankfully doesn't cause any problems.
        if (fromDispatcher) {
            Util.Logger.debug("Destroying "+this._indicator.id);
            this._indicatorHandlerIds.forEach(this._indicator.disconnect.bind(this._indicator));
            if (this._notification._menu) this._notification._menu.destroy();
            this._iconBox.remove_all_children();
            MessageTray.Source.prototype.destroy.apply(this);
        }
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

/*
 * Standard popup menus can't be embedded in other widgets, but DbusMenu needs an instance of 
 * PopupMenu.PopupMenu to work correctly. Instead of mocking the popup menu api, we subclass it
 * and apply some ugly hacks. This is extremely dependant of the internal implementation of PopupMenu.PopupMenu
 */
const PopupMenuEmbedded = new Lang.Class({
    Name: 'PopupMenuEmbedded',
    Extends: PopupMenu.PopupMenu,
    
    _init: function() {
        this.parent(null, 'popup-menu');
        
        var box;
        if (this._boxWrapper) { // GS 3.8
            box = this._boxWrapper;
        } else { // GS 3.10
            box = this.box;
        }
        
        box.get_parent().remove_child(box);
        
        this.actor = box;
        this.actor._delegate = this;
    },

    open: function() {
        // "light" variant that only sends the event
        if (this.isOpen)
            return;

        this.isOpen = true;

        this.emit('open-state-changed', true);
    },

    close: function() {
        if (!this.isOpen)
            return;

        this.isOpen = false;
        this.emit('open-state-changed', false);
    }
})

/*
 * we also need a custom notification widget which carries the menu
 */
const IndicatorNotification = new Lang.Class({
    Name: 'IndicatorNotification',
    Extends: MessageTray.Notification,

    _init: function(source, cb) {
        this.parent(source, source.title, null, { customContent: true });
        
        this._box = new St.BoxLayout({ vertical: true });
        this.setResident(true);
        this.enableScrolling(false);
        this.actor.destroy();
        this.actor = this._box; //HACK: force the whole bubble to be our menu

        source._indicator.getMenuClient((function(client) {
            if (client) {
                this._menu = new PopupMenuEmbedded();
                this._box.add_actor(this._menu.actor);
                client.attachToMenu(this._menu, cb);
            } else {
                cb();
            }
        }).bind(this));
    },
});
