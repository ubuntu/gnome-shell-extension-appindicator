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

const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const DBusMenu = Extension.imports.dbusMenu;
const IconCache = Extension.imports.iconCache;
const DBusInterfaces = Extension.imports.interfaces;
const Util = Extension.imports.util;

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

const StatusNotifierItem = Gio.DBusProxy.makeProxyWrapper(DBusInterfaces.StatusNotifierItem);
const PropertiesProxy = Gio.DBusProxy.makeProxyWrapper(DBusInterfaces.Properties);

/**
 * the AppIndicator class serves as a generic container for indicator information and functions common
 * for every displaying implementation (IndicatorMessageSource and IndicatorStatusIcon)
 */
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

                // Whenever the status changes, we might also have a changed icon.
                // So we emit an event for that, too, whenever we have a new status.
                this.connect("status", function() {
                    this.emit("icon", this.icon);
                }.bind(this));

                // workaround for us not being able to set G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES
                this._proxy.connect("g-properties-changed", Util.refreshInvalidatedProperties);

                this.isConstructed = true;
                this.emit("constructed");

                this.reset(true);
            }).bind(this));
        }).bind(this));
    },

    // returns a function that emits the signal `signal` with the argument `this[prop]`
    _getChangedEmitter: function(signal, prop) {
        return Lang.bind(this, function() {
            this.emit(signal, this[prop]);
        });
    },

    // returns a function that updates the cached property for `propertyName`.
    // (RANT) This only needs to be done because the author of the spec deemed it necessary to use special events
    // to signal property changes instead of using the standard org.freedesktop.DBus.Properties interface. I still
    // wonder why.
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

    //async because we may need to check the presence of a menubar object as well as the creation is async.
    getMenuClient: function(clb) {
        var path = this._proxy.Menu || "/MenuBar"
        this._validateMenu(this.busName, path, function(r, name, path) {
            if (r) {
                Util.Logger.debug("creating menu on "+[name, path])
                clb(new DBusMenu.Client(name, path))
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
                    Util.Logger.warn("Invalid menu: "+e);
                    return callback(false);
                }
                var version = val.deep_unpack()[0].deep_unpack();
                //fixme: what do we implement?
                if (version >= 2) {
                    return callback(true, bus, path);
                } else {
                    Util.Logger.warn("Incompatible dbusmenu version: "+version);
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
                Util.Logger.fatal("invalid image format: "+icon_name);
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

            // we try to avoid messing with the default icon theme, so we'll create a new one if needed
            if (this._proxy.IconThemePath) {
                var icon_theme = new Gtk.IconTheme();
                Gtk.IconTheme.get_default().get_search_path().forEach(function(path) {
                    icon_theme.append_search_path(path)
                });
                icon_theme.append_search_path(this._proxy.IconThemePath);
                icon_theme.set_screen(imports.gi.Gdk.Screen.get_default());
            } else {
                var icon_theme = Gtk.IconTheme.get_default();
            }

            // try to look up the icon in the icon theme
            icon_info = icon_theme.lookup_icon(icon_name, icon_size,
                Gtk.IconLookupFlags.GENERIC_FALLBACK);

            // no icon? that's bad!
            if (icon_info === null) {
                Util.Logger.fatal("unable to lookup icon for "+icon_name);
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

        let icon = new St.Icon({ gicon: gicon, icon_size: real_icon_size });

        // make sure to return an actor that has the appropriate size, even if
        // the icon we found is smaller.
        if (real_icon_size < icon_size) {
            Util.Logger.debug("small icon adjustment");
            return new St.Bin({
                width: icon_size,
                height: icon_size,
                child: icon,
                x_fill: false,
                y_fill: false
            });
        } else {
            return icon;
        }
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
