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

const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
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

//partially taken from the quassel irc sources, partly from libappindicator
//there seem to be _huge_ inconsistencies between the numerous implementations
const StatusNotifierItemIface = <interface name="org.kde.StatusNotifierItem">
	<property name="Category" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="WindowId" type="i" access="read"/>
    <property name="Menu" type="o" access="read" />

    <!-- main icon -->
    <!-- names are preferred over pixmaps -->
    <property name="IconName" type="s" access="read" />
    <property name="IconThemePath" type="s" access="read" />

    <!-- struct containing width, height and image data-->
    <!-- implementation has been dropped as of now -->
    <property name="IconPixmap" type="a(iiay)" access="read" />
    
    <!-- not used in ayatana code, no test case so far -->
    <property name="OverlayIconName" type="s" access="read"/>
    <property name="OverlayIconPixmap" type="a(iiay)" access="read" />

    <!-- Requesting attention icon -->
    <property name="AttentionIconName" type="s" access="read"/>

    <!--same definition as image-->
    <property name="AttentionIconPixmap" type="a(iiay)" access="read" />

    <!-- tooltip data -->
	<!-- unimplemented as of now -->
    <!--(iiay) is an image-->
    <property name="ToolTip" type="(sa(iiay)ss)" access="read" />


    <!-- interaction: actually, we do not use them. -->
    <method name="Activate">
        <arg name="x" type="i" direction="in"/>
        <arg name="y" type="i" direction="in"/>
    </method>
	
	<!-- Signals: the client wants to change something in the status-->
    <signal name="NewTitle"></signal>
	<signal name="NewIcon"></signal>
	<signal name="NewIconThemePath">
		<arg type="s" name="icon_theme_path" direction="out" />
	</signal>
	<signal name="NewAttentionIcon"></signal>
	<signal name="NewOverlayIcon"></signal>
    <signal name="NewToolTip"></signal>
    <signal name="NewStatus">
        <arg name="status" type="s" />
    </signal>
    
    <!-- ayatana labels -->
    <signal name="XAyatanaNewLabel">
		<arg type="s" name="label" direction="out" />
		<arg type="s" name="guide" direction="out" />
	</signal>
	<property name="XAyatanaLabel" type="s" access="read" />
	<property name="XAyatanaLabelGuide" type="s" access="read" /> <!-- unimplemented -->
		

  </interface>;
const StatusNotifierItem = Gio.DBusProxy.makeProxyWrapper(StatusNotifierItemIface);

const PropertiesIface = <interface name="org.freedesktop.DBus.Properties">
<method name="Get">
    <arg type="s" direction="in" />
    <arg type="s" direction="in" />
    <arg type="v" direction="out" />
</method>
<method name="GetAll">
    <arg type="s" direction="in" />
    <arg type="a{sv}" direction="out" />
</method>
<signal name="PropertiesChanged">
    <arg type="s" direction="out" />
    <arg type="a{sv}" direction="out" />
    <arg type="as" direction="out" />
</signal>
</interface>;
const PropertiesProxy = Gio.DBusProxy.makeProxyWrapper(PropertiesIface);

const AppIndicator = new Lang.Class({
    Name: 'AppIndicator',
    
    _init: function(bus_name, object) {
        this.ICON_SIZE = Panel.PANEL_ICON_SIZE;
        
        this.busName = bus_name;
        
        //construct async because the remote object may be busy and irresponsive (example: quassel irc)
        this._props = new PropertiesProxy(Gio.DBus.session, bus_name, object, (function(resutl, error) {
	        this._proxy = new StatusNotifierItem(Gio.DBus.session, bus_name, object, (function(result, error) {
	        	this.isConstructed = true;
	        	this.emit("constructed");
	        	
	        	this._propChangedEmitters = {
		        	"Status": this._getChangedEmitter("status", "status"),
		        	"IconName": this._getChangedEmitter("icon", "iconName"),
		        	"AttentionIconName": this._getChangedEmitter("icon", "iconName"),
		        	"Title": this._getChangedEmitter("title", "title"),
		        	"Tooltip": this._getChangedEmitter("tooltip", "tooltip"),
		        	"XAyatanaLabel": this._getChangedEmitter("label", "label")
		        };
		        
		        this._proxy.connectSignal('NewStatus', this._propertyUpdater("Status"));
		        this._proxy.connectSignal('NewIcon', this._propertyUpdater("IconName"));
		        this._proxy.connectSignal('NewAttentionIcon', this._propertyUpdater("AttentionIconName"));
		        this._proxy.connectSignal('NewTitle', this._propertyUpdater("Title"));
		        this._proxy.connectSignal('NewToolTip', this._propertyUpdater("Tooltip"));
		        this._proxy.connectSignal('XAyatanaNewLabel', this._propertyUpdater("XAyatanaLabel"));
		        
		        this._props.connectSignal("PropertiesChanged", this._propertiesChanged.bind(this));
		        
		        this.reset(true);
	        }).bind(this));
        }).bind(this));
    },
    
    //helper function
    _getChangedEmitter: function(signal, prop) {
    	return Lang.bind(this, function() {
    		this.emit(signal, this[prop]);
    	});
    },
    
    _propertyUpdater: function(propertyName) {
    	return Lang.bind(this, function() {
    		this._props.GetRemote("org.kde.StatusNotifierItem", propertyName, (function(variant, error) {
    				if (error) return;
    				this._proxy.set_cached_property(propertyName, variant[0]);
    				if (propertyName in this._propChangedEmitters) this._propChangedEmitters[propertyName]();
    			}).bind(this)
    		);
    	});
    },
    
    //public property getters
    get title() {
    	return this._proxy.Title;
    },
    get id() {
    	return this._proxy.Id;
    },
    get category() {
    	return this._proxy.Category;
    },
    get status() {
    	return this._proxy.Status;
    },
    get iconName() {
    	if (this.status == SNIStatus.NEEDS_ATTENTION) {
    		return this._proxy.AttentionIconName;
    	} else {
    		return this._proxy.IconName;
    	}
    },
    get tooltip() {
    	return this._proxy.Tooltip;
    },
    get menuPath() {
    	return this._proxy.Menu;
    },
    get label() {
    	return this._proxy.XAyatanaLabel;
    },
    
    _propertiesChanged: function(proxy, sender, params) {
    	log(params);
    	var [ iface, changed, invalidated ] = params;
    	if (iface == "org.kde.StatusNotifierItem") {
    		var props = invalidated.concat(Object.keys(changed));
    		props.forEach(function(e) {
    			if (e in this._propChangedEmitters) this._propChangedEmitter[e]();
    		}, this);
    	}
    },
    
    //only triggers actions
    reset: function(triggerReady) {
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
    },

    destroy: function() {
        this.emit('destroy', this);
        this.disconnectAll();
    },

    createIcon: function(icon_size) {
        var icon_name = this.iconName;
        if (icon_name) {
            var iconname, real_icon_size;
            var theme_path = this._proxy.IconThemePath;
            if (theme_path) {
                //if there's a theme path, we'll look up the icon there.
                var icon_theme = new Gtk.IconTheme();
                icon_theme.append_search_path(theme_path);
                var iconinfo = icon_theme.lookup_icon(icon_name, icon_size, icon_size, 4);
	            iconname = iconinfo.get_filename();
	            //icon size can mismatch with custom theme
	            real_icon_size = iconinfo.get_base_size();
	            if (real_icon_size > icon_size) real_icon_size = icon_size; //we don't want bigger icons
            } else {
                //let gicon do the work for us. we just assume that icons without custom theme always fit.
                iconname = icon_name;
                real_icon_size = icon_size;
            }
            
            return new St.Icon({ gicon: Gio.icon_new_for_string(iconname),
                                 //icon_type: St.IconType.FULLCOLOR,
                                 icon_size: real_icon_size
                               });
        }  else {
            // fallback to a generic icon
            return new St.Icon({ icon_name: 'gtk-dialog-info',
                                 icon_size: icon_size
                               });
        }
        
    },
    
    _onNewStatus: function() {
        this.emit('status', this.status);
    },
    
    _onNewLabel: function(proxy) {
    	this.emit('label', this.label);
    },

    _onNewIcon: function(proxy, iconType) {
        this.emit('icon', this.iconName);
    },

    _onNewTitle: function(proxy) {
        this.emit("title", this.title);
    },

    _onNewTooltip: function(proxy) {
        this.emit("tooltip", this.tooltip);
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
            this._proxy.Activate(primary.x, primary.y);
        }
    }
});
Signals.addSignalMethods(AppIndicator.prototype);