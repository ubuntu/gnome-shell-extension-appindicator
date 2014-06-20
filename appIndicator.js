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

/**
 * the AppIndicator class serves as a generic container for indicator information and functions common
 * for every displaying implementation (IndicatorMessageSource and IndicatorStatusIcon)
 */
const AppIndicator = new Lang.Class({
    Name: 'AppIndicator',

    _init: function(bus_name, object) {
        this.busName = bus_name

        this._iconSize = 16 //arbitrary value

        this._proxy = new Util.XmlLessDBusProxy({
            connection: Gio.DBus.session,
            name: bus_name,
            path: object,
            interface: 'org.kde.StatusNotifierItem',
            propertyWhitelist: [
                'Title',
                'Id',
                'Category',
                'Status',
                'ToolTip',
                'XAyatanaLabel',
                'Menu',
                'IconName',
                'AttentionIconName',
                'OverlayIconName',
            ],
            onReady: (function() {
                this.isReady = true
                this.emit('ready')
            }).bind(this)
        })

        this._proxy.connect('-property-changed', this._onPropertyChanged.bind(this))
        this._proxy.connect('-signal', this._translateNewSignals.bind(this))

        this._iconThemeChangedHandle = Gtk.IconTheme.get_default().connect('changed', this._invalidateIcon.bind(this));
    },

    // The Author of the spec didn't like the PropertiesChanged signal, so he invented his own
    _translateNewSignals: function(proxy, signal, params) {
        if (signal.substr(0, 3) == 'New') {
            let prop = signal.substr(3)

            if (this._proxy.propertyWhitelist.indexOf(prop) > -1)
                this._proxy.invalidateProperty(prop)

            if (this._proxy.propertyWhitelist.indexOf(prop + 'Pixmap') > -1)
                this._proxy.invalidateProperty(prop + 'Pixmap')
        } else if (signal == 'XAyatanaNewLabel') {
            // and the ayatana guys made sure to invent yet another way of composing these signals...
            this._proxy.invalidateProperty('XAyatanaLabel')
        }
    },

    //public property getters
    get title() {
        return this._proxy.cachedProperties.Title;
    },
    get id() {
        return this._proxy.cachedProperties.Id;
    },
    get status() {
        return this._proxy.cachedProperties.Status;
    },
    get iconName() {
        if (this.status == SNIStatus.NEEDS_ATTENTION) {
            return this._proxy.cachedProperties.AttentionIconName;
        } else {
            return this._proxy.cachedProperties.IconName;
        }
    },
    get label() {
        return this._proxy.cachedProperties.XAyatanaLabel;
    },

    //async because we may need to check the presence of a menubar object as well as the creation is async.
    getMenuClient: function(clb) {
        var path = this._proxy.cachedProperties.Menu || "/MenuBar"
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

    _onPropertyChanged: function(proxy, property, newValue) {
        // some property changes require updates on our part,
        // a few need to be passed down to the displaying code

        // all these can mean that the icon has to be changed
        if (property == 'Status' || property == 'IconName' || property == 'AttentionIconName')
            this._updateIcon()

        // the label will be handled elsewhere
        if (property == 'XAyatanaLabel')
            this.emit('label')

        // status updates are important for the StatusNotifierDispatcher
        if (property == 'Status')
            this.emit('status')
    },

    // triggers a reload of all properties
    reset: function(triggerReady) {
        this._proxy.invalidateAllProperties(this.emit.bind(this, 'reset'))
    },

    destroy: function() {
        this.emit('destroy')

        Gtk.IconTheme.get_default().disconnect(this._iconThemeChangedHandle)

        this.disconnectAll()
        if (this._iconBin) this._iconBin.destroy()
        this._proxy.destroy()
    },

    _createIcon: function(icon_size) {
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

        return new St.Icon({ gicon: gicon, icon_size: real_icon_size });
    },

    // updates the icon in this._iconBin, managing caching
    _updateIcon: function(force_redraw) {
        // remove old icon
        if (this._iconBin && this._iconBin.get_child()) {
            this._iconBin.get_child().inUse = false
            this._iconBin.set_child(null)
        }

        let icon_id = this.iconName + "@" + this._iconSize
        let new_icon = IconCache.IconCache.instance.get(icon_id)

        if (new_icon && force_redraw) {
            IconCache.IconCache.instance.forceDestroy(icon_id)
            new_icon = null
        }

        if (!new_icon) {
            new_icon = this._createIcon(this._iconSize)
            IconCache.IconCache.instance.add(icon_id, new_icon)
        }

        new_icon.inUse = true

        if (this._iconBin)
            this._iconBin.set_child(new_icon)
    },

    // returns an icon actor in the right size that contains the icon.
    // the icon will be update automatically if it changes.
    getIconActor: function(icon_size) {
        this._iconSize = icon_size

        if (this._iconBin) {
            if (this._iconBin.get_child())
                this._iconBin.get_child().inUse = false

            this._iconBin.destroy()
        }

        this._iconBin = new St.Bin({
            width: icon_size,
            height: icon_size,
            x_fill: false,
            y_fill: false
        })

        if (this.isReady)
            this._updateIcon(true)
        else
            Util.connectOnce(this, 'ready', this._updateIcon.bind(this))

        return this._iconBin
    },

    // called when the icon theme changes
    _invalidateIcon: function() {
        this._updateIcon(true);
    },

    open: function() {
        // we can't use WindowID because we're not able to get the x11 window id from a MetaWindow
        // nor can we call any X11 functions. Luckily, the Activate method usually works fine.
        // parameters are "an hint to the item where to show eventual windows" [sic]
        // ... and don't seem to have any effect.
        this._proxy.call({
            name: 'Activate',
            paramTypes: 'ii',
            paramValues: [0, 0]
            // we don't care about the result
        })
    }
});
Signals.addSignalMethods(AppIndicator.prototype);
