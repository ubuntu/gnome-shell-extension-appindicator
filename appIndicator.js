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
const GdkPixbuf = imports.gi.GdkPixbuf;

const Panel = imports.ui.panel;
const Util = imports.misc.util;

const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const DBusMenu = Extension.imports.dbusMenu;
const IconCache = Extension.imports.iconCache;

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
        this._iconThemeChangedHandle = Gtk.IconTheme.get_default().connect('changed', this._invalidateIcon.bind(this));
        
        //construct async because the remote object may be busy and irresponsive (example: quassel irc)
        this._props = new PropertiesProxy(Gio.DBus.session, bus_name, object, (function(resutl, error) {
            this._proxy = new StatusNotifierItem(Gio.DBus.session, bus_name, object, (function(result, error) {
                this._propChangedEmitters = {
                    "Status": this._getChangedEmitter("status", "status"),
                    "IconName": this._getChangedEmitter("icon", "iconName"),
                    "AttentionIconName": this._getChangedEmitter("icon", "iconName"),
                    "Title": this._getChangedEmitter("title", "title"),
                    "Tooltip": this._getChangedEmitter("tooltip", "tooltip"),
                    "XAyatanaLabel": this._getChangedEmitter("label", "label")
                };
                
                //this is really just Signals._connect, so we can disconnect them all at once
                this._proxy.connectSignal('NewStatus', this._propertyUpdater("Status"));
                this._proxy.connectSignal('NewIcon', this._propertyUpdater("IconName"));
                this._proxy.connectSignal('NewAttentionIcon', this._propertyUpdater("AttentionIconName"));
                this._proxy.connectSignal('NewTitle', this._propertyUpdater("Title"));
                this._proxy.connectSignal('NewToolTip', this._propertyUpdater("Tooltip"));
                this._proxy.connectSignal('XAyatanaNewLabel', this._propertyUpdater("XAyatanaLabel"));
                
                this._propChangedHandle = this._proxy.connect("g-properties-changed", this._propertiesChanged.bind(this));
                
                this.isConstructed = true;
                this.emit("constructed");
                
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
    get label() {
        return this._proxy.XAyatanaLabel;
    },
    
    //common menu handling
    //async because we may need to check the presence of a menubar object as well as the creation is async.
    getMenu: function(clb) {
        var path = this._proxy.Menu || "/MenuBar";
        this._validateMenu(this.busName, path, function(r, name, path) {
            if (r) {
                log("creating menu on "+[name, path]);
                clb(new DBusMenu.Menu(name, path));
            } else {
                clb(null);
            }
        });
    },
    
    _validateMenu: function(bus, path, callback) {
        Gio.DBus.session.call(
            bus, path, "org.freedesktop.DBus.Properties", "Get", 
            GLib.Variant.new("(ss)", ["com.canonical.dbusmenu", "Version"]), 
            GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, function(conn, result) {
                try {
                    var val = conn.call_finish(result);
                } catch (e) {
                    log("Invalid menu: "+e);
                    return callback(false);
                }
                var version = val.deep_unpack()[0].deep_unpack();
                //fixme: what do we implement?
                if (version >= 2) {
                    return callback(true, bus, path);
                } else {
                    log("Incompatible dbusmenu version: "+version);
                    return callback(false);
                }
            }, null
        );
    },
    
    _propertiesChanged: function(proxy, changed, invalidated) {
        var props = invalidated.concat(Object.keys(changed.deep_unpack()));
        props.forEach(function(e) {
            if (e in this._propChangedEmitters) this._propChangedEmitters[e]();
        }, this);
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
        if (this.isConstructed) {
            Signals._disconnectAll.apply(this._proxy);
            this._proxy.disconnect(this._propChangedHandle);
            Gtk.IconTheme.get_default().disconnect(this._iconThemeChangedHandle);
            this.emit('destroy', this);
            this.disconnectAll();
            this._proxy = null; //in case we still have circular references...
        } else {
            this.connect("constructed", this.destroy.bind(this));
        }
    },

    createIcon: function(icon_size) {
        // shortcut variable
        var icon_name = this.iconName;
        // fallback icon
        var gicon = Gio.icon_new_for_string("dialog-info");
        // real_icon_size will contain the actual icon size in contrast to the requested icon size
        var real_icon_size = icon_size;
        
        if (icon_name && icon_name[0] == "/") {
            //HACK: icon is a path name. This is not specified by the api but at least inidcator-sensors uses it.
            var [ format, width, height ] = GdkPixbuf.Pixbuf.get_file_info(icon_name);
            if (!format) {
                log("FATAL: invalid image format: "+icon_name);
            } else {
                // if the actual icon size is smaller, save that for later.
                // scaled icons look ugly.
                if (Math.max(width, height) < icon_size) real_icon_size = Math.max(width, height);
                gicon = Gio.icon_new_for_string(icon_name);
            }
        } else if (icon_name) {
            // we manually look up the icon instead of letting st.icon do it for us
            // this allows us to sneak in an indicator provided search path and to avoid ugly upscaled icons
            
            // indicator-application looks up a special "panel" variant, we just replicate that here
            icon_name = icon_name + "-panel";
            
            // icon info as returned by the lookup
            var icon_info = null;
            
            // first, try to look up the icon in the default icon theme
            icon_info = Gtk.IconTheme.get_default().lookup_icon(icon_name, icon_size,
                Gtk.IconLookupFlags.GENERIC_FALLBACK);
            
            // if that failed, search in the theme path
            if (icon_info === null && this._proxy.IconThemePath) {
                // construct GtkIconTheme
                let icon_theme = new Gtk.IconTheme();
                icon_theme.icon_theme.append_search_path(this._proxy.IconThemePath);
                
                // lookup icon
                icon_info = icon_theme.lookup_icon(icon_name, icon_size, Gtk.IconLookupFlags.GENERIC_FALLBACK);
            }
            
            // still no icon? that's bad!
            if (icon_info === null) {
                log("FATAL: unable to lookup icon for "+icon_name);
            } else { // we have an icon
                // the icon size may not match the requested size, especially with custom themes
                if (icon_info.get_base_size() < icon_size) {
                    // stretched icons look very ugly, we avoid that and just show the smaller icon
                    real_icon_size = icon_info.get_base_size();
                }
                
               // create a gicon for the icon
               gicon = Gio.icon_new_for_string(icon_info.get_filename());
            }
        }
        
        return new St.Icon({ gicon: gicon, icon_size: real_icon_size });
    },
    
    //in contrast to createIcon, this function manages caching.
    //if you don't use the icon anymore, set .inUse to false.
    getIcon: function(icon_size) {
        var icon_id = this.iconName + "@" + icon_size;
        var icon = IconCache.IconCache.instance.get(icon_id);
        if (icon && this._forceIconRedraw) {
            IconCache.IconCache.instance.forceDestroy(icon_id);
            this._forceIconRedraw = false;
            icon = null;
        }
        if (!icon) {
            icon = this.createIcon(icon_size);
            IconCache.IconCache.instance.add(icon_id, icon);
        }
        icon.inUse = true;
        return icon;
    },
    
    //called when the icon theme changes
    _invalidateIcon: function() {
        this._forceIconRedraw = true;
        this._onNewIcon();
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
        // we can't use WindowID because we're not able to get the x11 window id from a MetaWindow
        // nor can we call any X11 functions. Luckily, the Activate method usually works fine.
        // parameters are "an hint to the item where to show eventual windows" [sic]
        // ... and don't seem to have any effect.
        this._proxy.ActivateRemote(0, 0);
    }
});
Signals.addSignalMethods(AppIndicator.prototype);
