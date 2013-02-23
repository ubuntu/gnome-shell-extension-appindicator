/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Copyright (C) 2011 Giovanni Campagna
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

const DBus = imports.dbus;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const Panel = imports.ui.panel;
const Util = imports.misc.util;

const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const DBusMenu = Extension.imports.dbusMenu;
const IconCache = Extension.imports.iconCache;

// TODO: replace with org.freedesktop and /org/freedesktop when approved
const KDE_PREFIX = 'org.kde';
const AYATANA_PREFIX = 'org.ayatana';
const AYATANA_PATH_PREFIX = '/org/ayatana';

const ITEM_INTERFACE = KDE_PREFIX + '.StatusNotifierItem';
const ITEM_OBJECT = '/StatusNotifierItem';

const SNICategory = {
    APPLICATION: 'ApplicationStatus',
    COMMUNICATIONS: 'Communications',
    SYSTEM: 'SystemServices',
    HARDWARE: 'Hardware'
};

const SNIStatus = {
    PASSIVE: 'Passive',
    ACTIVE: 'Active',
    NEEDS_ATTENTION: 'NeedsAttention'
};

const StatusNotifierItemIface = {
    name: ITEM_INTERFACE,
    methods: [
        // these are all unimplemented (except for Activate)
        { name : 'ContextMenu', inSignature : 'ii', outSignature : '' }, // not part of libappindicator
        { name : 'Activate', inSignature : 'ii', outSignature : '' }, // not part of libappindicator
        { name : 'SecondaryActivate', inSignature : 'ii', outSignature : '' }, // not part of libappindicator
        { name : 'Scroll', inSignature : 'is', outSignature : '' } // not part of libappindicator
    ],
    signals: [
        { name : 'NewTitle', inSignature : '' }, // not part of libappindicator
        { name : 'NewIcon', inSignature : '' },
        { name : 'NewOverlayIcon', inSignature : '' }, // not part of libappindicator
        { name : 'NewAttentionIcon', inSignature : '' },
        { name : 'NewToolTip', inSignature : '' }, // not part of libappindicator
        { name : 'NewStatus', inSignature : 's' },
        { name : 'XAyatanaNewLabel', inSignature : 'ss' }
    ],
    properties: [
        { name : 'Category', signature : 's', access : 'read' },
        { name : 'Id', signature : 's', access : 'read' },
        { name : 'Title', signature : 's', access : 'read' }, // not part of libappindicator
        { name : 'Status', signature : 's', access : 'read' },
        { name : 'WindowId', signature : 'u', access : 'read' }, // not part of libappindicator
        { name : 'IconName', signature : 's', access : 'read' },
        { name : 'IconPixmap', signature : 'a(iiay)', access : 'read' }, // not part of libappindicator
        { name : 'OverlayIconName', signature : 's', access : 'read' }, // not part of libappindicator, unimplemented in some cases
        { name : 'OverlayIconPixmap', signature : 'a(iiay)', access : 'read' }, // not part of libappindicator, unimplemented
        { name : 'AttentionIconName', signature : 's', access : 'read' },
        { name : 'AttentionIconPixmap', signature : 'a(iiay)', access : 'read' }, // not part of libappindicator
        { name : 'AttentionMovieName', signature : 's', access : 'read' }, // not part of libappindicator, unimplemented
        { name : 'IconThemePath', signature : 's', access : 'read' }, // unimplemented
        { name : 'ToolTip', signature : 'sa(iiay)ss', access : 'read' }, // not part of libappindicator
        { name : 'Menu', signature : 'o', access : 'read' },
        { name : 'XAyatanaLabel', siganture : 's', access : 'read' } //ayatana specific
    ]
};
const StatusNotifierItem = DBus.makeProxyClass(StatusNotifierItemIface);

const AppIndicator = new Lang.Class({
    Name: 'AppIndicator',
    
    _init: function(bus_name, object) {
        this.ICON_SIZE = Panel.PANEL_ICON_SIZE;
        
        this.busName = bus_name;
        this._proxy = new StatusNotifierItem(DBus.session, bus_name, object);
        
        this.reset(true);
    },
    
    //load all properties again and recreate the menu
    reset: function(triggerReady) {
        this._proxy.GetAllRemote(Lang.bind(this, function(properties) {
            this._category = properties['Category'];
            if (this._category == SNICategory.COMMUNICATIONS)
                this.isChat = true;

            this.status = properties['Status'];
            this.id = properties['Id'];
            if (!this.id) {
                log('Id property in StatusNotifierItem is undefined');
                this.id = 'unknown-application-' + Math.random() * 1000;
            }
            this.title = properties['Title'] || this.id;
            this._relatedWindow = properties['WindowId'];
            this._findApp();

            this._normalIconName = properties['IconName'];
            this._normalIconPixmap = properties['IconPixmap'];
            this._attentionIconName = properties['AttentionIconName'];
            this._attentionIconPixmap = properties['AttentionIconPixmap'];
            this._overlayIconName = properties['OverlayIconName'];
            if (this.status == SNIStatus.NEEDS_ATTENTION) {
                this.iconName = this._attentionIconName;
                this._iconPixmap = this._attentionIconPixmap;
            } else {
                this.iconName = this._normalIconName;
                this._iconPixmap = this._normalIconPixmap;
            }
            
            this._iconThemePath = properties['IconThemePath'];

            this.menuPath = properties['Menu'] || null;
            this.tooltip = properties['ToolTip'] || null;
            this.label = properties['XAyatanaLabel'] || null;

            this._proxy.connect('NewStatus', Lang.bind(this, this._onNewStatus));
            this._proxy.connect('NewIcon', Lang.bind(this, this._onNewIcon, 'normal'));
            this._proxy.connect('NewAttentionIcon', Lang.bind(this, this._onNewIcon, 'attention'));
            this._proxy.connect('NewOverlayIcon', Lang.bind(this, this._onNewIcon, 'overlay'));
            this._proxy.connect('NewTitle', Lang.bind(this, this._onNewTitle));
            this._proxy.connect('NewToolTip', Lang.bind(this, this._onNewTooltip));
            this._proxy.connect('XAyatanaNewLabel', Lang.bind(this, this._onNewLabel));
            
            this.emit('status', this.status);
            this.emit('title', this.title);
            this.emit('tooltip', this.tooltip);
            this.emit('icon', this.iconName);
            this.emit('label', this.label);
            if (triggerReady) {
            	this.isReady = true;
            	this.emit('ready');
            } else {
            	this.emit('reset');
            }
            
        }));
    },

    destroy: function() {
        this.emit('destroy', this);
        this.disconnectAll();
    },

    createIcon: function(icon_size) {
        // we can only overlay themed icons over themed icons
        // (ok, actually with better GJS we could use a GdkPixbuf as a GIcon
        // but it doesn't work yet)
        if (this._overlayIconName && this.iconName) {
            let overlayIcon = new Gio.ThemedIcon({ name: this._overlayIconName });
            let emblem = new Gio.Emblem({ icon: overlayIcon });
            let icon = new Gio.EmblemedIcon({ gicon: new Gio.ThemedIcon({ name: this.iconName }) });
            icon.add_emblem(emblem);
            return new St.Icon({ gicon: icon, icon_size: icon_size });
        } else {
            return this._makeIconTexture(this.iconName, this._iconPixmap, icon_size);
        }
    },
    
    _makeIconTexture: function(name, pixmap, icon_size) {
        if (name) {
            var iconname, real_icon_size;
            if (this._iconThemePath) {
                //if there's a theme path, we'll look up the icon there.
                var icon_theme = new Gtk.IconTheme();
                icon_theme.append_search_path(this._iconThemePath);
                var iconinfo = icon_theme.lookup_icon(name, icon_size, icon_size, 4);
	            iconname = iconinfo.get_filename();
	            //icon size can mismatch with custom theme
	            real_icon_size = iconinfo.get_base_size();
            } else {
                //let gicon do the work for us. we just assume that icons without custom theme fit everytime.
                iconname = name;
                real_icon_size = icon_size;
            }
            
            return new St.Icon({ gicon: Gio.icon_new_for_string(iconname),
                                 //icon_type: St.IconType.FULLCOLOR,
                                 icon_size: real_icon_size
                               });
        } else if (pixmap && pixmap.length) {
            return Util.createActorFromPixmap(pixmap, icon_size);
        } else
            // fallback to a generic icon
            return new St.Icon({ icon_name: 'gtk-dialog-info',
                                 icon_size: icon_size
                               });
    },
	
    _onNewStatus: function(proxy) {
        this._proxy.GetRemote('Status', Lang.bind(this, function(status) {
            this.status = status;
            if (this.status == SNIStatus.NEEDS_ATTENTION)
                this.iconName = this._attentionIconName;
            else
                this.iconName = this._normalIconName;
            this.emit('status', status);
        }));
    },
    
    _onNewLabel: function(proxy) {
    	this._proxy.GetRemote('XAyatanaLabel', Lang.bind(this, function(label) {
            this.label = label;
            this.emit('label', label);
        }));
    },

    _onNewIcon: function(proxy, iconType) {
        //log("new icon requested for "+this.id);
        let localProperty, dbusProperty;
        switch(iconType) {
        case 'attention':
            localProperty = '_attentionIconName';
            dbusProperty = 'AttentionIconName';
            break;
        case 'overlay':
            localProperty = '_overlayIconName';
            dbusProperty = 'OverlayIconName';
            break;
        case 'normal':
            localProperty = '_normalIconName';
            dbusProperty = 'IconName';
            break;
        default:
            log ('Invalid iconType in callback for signal NewIcon');
            return;
        }

        this._proxy.GetRemote(dbusProperty, Lang.bind(this, function(icon) {
            this[localProperty] = icon;
            if (this.status == SNIStatus.NEEDS_ATTENTION)
                this.iconName = this._attentionIconName;
            else
                this.iconName = this._normalIconName;
            this.emit('icon', icon);
        }));
    },

    _onNewTitle: function(proxy) {
        this._proxy.GetRemote('Title', Lang.bind(this, function(title) {
            this.title = title || null;
            this.emit("title", title);
        }));
    },

    _onNewTooltip: function(proxy) {
        this._proxy.GetRemote('ToolTip', Lang.bind(this, function(tooltip) {
            this.tooltip = tooltip;
            this.emit("tooltip", tooltip);
        }));
    },

    _findApp: function() {
        /* FIXME: meta_window_get_xwindow is not introspectable
        let found = null;
        let windows = global.get_window_actors();
        for (let i = 0; i < windows.length; i++) {
            let metaWindow = windows[i].meta_window;
            if (metaWindow.get_xwindow() == this._relatedWindow) {
                found = metaWindow;
                break;
            }
        }
        if (found)
            this.app = Shell.WindowTracker.get_default().get_window_app(found);
        else
            this.app = null;
            */
    },

    open: function() {
        if (this.app) {
            let windows = this.app.get_windows();
            if (windows.length > 0)
                Main.activateWindow(windows[0]);
        } else {
            // failback to older Activate method
            // parameters are "an hint to the item where to show eventual windows" [sic]
            let primary = global.get_primary_monitor();
            this._proxy.ActivateRemote(primary.x, primary.y);
        }
    },
    
    on: function(event, handler) {
    	return this.connect(event, handler);
    }
});
Signals.addSignalMethods(AppIndicator.prototype);