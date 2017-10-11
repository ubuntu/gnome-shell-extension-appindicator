// This file is part of the AppIndicator/KStatusNotifierItem GNOME Shell extension
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

const Clutter = imports.gi.Clutter
const Cogl = imports.gi.Cogl
const GdkPixbuf = imports.gi.GdkPixbuf
const Gio = imports.gi.Gio
const GLib = imports.gi.GLib
const Gtk = imports.gi.Gtk
const St = imports.gi.St
const Shell = imports.gi.Shell

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Lang = imports.lang
const Signals = imports.signals

const DBusMenu = Extension.imports.dbusMenu;
const IconCache = Extension.imports.iconCache;
const Util = Extension.imports.util;
const Interfaces = Extension.imports.interfaces;

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
        this._uniqueId = bus_name + object

        let interface_info = Gio.DBusInterfaceInfo.new_for_xml(Interfaces.StatusNotifierItem)

        //HACK: we cannot use Gio.DBusProxy.makeProxyWrapper because we need
        //      to specify G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES
        this._proxy = new Gio.DBusProxy({ g_connection: Gio.DBus.session,
                                          g_interface_name: interface_info.name,
                                          g_interface_info: interface_info,
                                          g_name: bus_name,
                                          g_object_path: object,
                                          g_flags: Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES })
        this._proxy.init_async(GLib.PRIORITY_DEFAULT, null, (function(initable, result) {
                try {
                    initable.init_finish(result);

                    this.isReady = true
                    this.emit('ready')
                } catch(e) {
                    Util.Logger.warn("While intializing proxy for "+bus_name+object+": "+e)
                }
            }).bind(this))

        this._proxyPropertyList = interface_info.properties.map(function(propinfo) { return propinfo.name })


        Util.connectSmart(this._proxy, 'g-properties-changed', this, '_onPropertiesChanged')
        Util.connectSmart(this._proxy, 'g-signal', this, '_translateNewSignals')
    },

    // The Author of the spec didn't like the PropertiesChanged signal, so he invented his own
    _translateNewSignals: function(proxy, sender, signal, params) {
        if (signal.substr(0, 3) == 'New') {
            let prop = signal.substr(3)

            if (this._proxyPropertyList.indexOf(prop) > -1)
                Util.refreshPropertyOnProxy(this._proxy, prop)

            if (this._proxyPropertyList.indexOf(prop + 'Pixmap') > -1)
                Util.refreshPropertyOnProxy(this._proxy, prop + 'Pixmap')

            if (this._proxyPropertyList.indexOf(prop + 'Name') > -1)
                Util.refreshPropertyOnProxy(this._proxy, prop + 'Name')
        } else if (signal == 'XAyatanaNewLabel') {
            // and the ayatana guys made sure to invent yet another way of composing these signals...
            Util.refreshPropertyOnProxy(this._proxy, 'XAyatanaLabel')
        }
    },

    //public property getters
    get title() {
        return this._proxy.Title;
    },
    get id() {
        return this._proxy.Id;
    },
    get uniqueId() {
        return this._uniqueId;
    },
    get status() {
        return this._proxy.Status;
    },
    get label() {
        let v = this._proxy.get_cached_property('XAyatanaLabel');

        if (v) return v.deep_unpack()
        else   return null
    },
    get menuPath() {
        return this._proxy.Menu || "/MenuBar"
    },

    get attentionIcon() {
        return [
            this._proxy.AttentionIconName,
            this._proxy.AttentionIconPixmap,
            this._proxy.IconThemePath
        ]
    },

    get icon() {
        return [
            this._proxy.IconName,
            this._proxy.IconPixmap,
            this._proxy.IconThemePath
        ]
    },

    get overlayIcon() {
        return [
            this._proxy.OverlayIconName,
            this._proxy.OverlayIconPixmap,
            this._proxy.IconThemePath
        ]
    },

    _onPropertiesChanged: function(proxy, changed, invalidated) {
        let props = Object.keys(changed.deep_unpack())

        props.forEach(function(property) {
            // some property changes require updates on our part,
            // a few need to be passed down to the displaying code

            // all these can mean that the icon has to be changed
            if (property == 'Status' || property.substr(0, 4) == 'Icon' || property.substr(0, 13) == 'AttentionIcon')
                this.emit('icon')

            // same for overlays
            if (property.substr(0, 11) == 'OverlayIcon')
                this.emit('overlay-icon')

            // this may make all of our icons invalid
            if (property == 'IconThemePath') {
                this.emit('icon')
                this.emit('overlay-icon')
            }

            // the label will be handled elsewhere
            if (property == 'XAyatanaLabel')
                this.emit('label')

            // status updates may cause the indicator to be hidden
            if (property == 'Status')
                this.emit('status')
        }, this);
    },

    reset: function() {
        //TODO: reload all properties, or do some other useful things
        this.emit('reset')
    },

    destroy: function() {
        this.emit('destroy')

        this.disconnectAll()
        delete this._proxy
    },

    open: function() {
        // we can't use WindowID because we're not able to get the x11 window id from a MetaWindow
        // nor can we call any X11 functions. Luckily, the Activate method usually works fine.
        // parameters are "an hint to the item where to show eventual windows" [sic]
        // ... and don't seem to have any effect.
        this._proxy.ActivateRemote(0, 0)
    },

    secondaryActivate: function () {
        this._proxy.SecondaryActivateRemote(0, 0)
    },

    scroll: function(dx, dy) {
        if (dx != 0)
            this._proxy.ScrollRemote(Math.floor(dx), 'horizontal')

        if (dy != 0)
            this._proxy.ScrollRemote(Math.floor(dy), 'vertical')
    }
});
Signals.addSignalMethods(AppIndicator.prototype);

const IconActor = new Lang.Class({
    Name: 'AppIndicatorIconActor',
    Extends: Shell.Stack,
    GTypeName: Util.WORKAROUND_RELOAD_TYPE_REGISTER('AppIndicatorIconActor'),

    _init: function(indicator, icon_size) {
        this.parent({ reactive: true })
        let scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.width  = icon_size * scale_factor
        this.height = icon_size * scale_factor

        this._indicator     = indicator
        this._iconSize      = icon_size * scale_factor
        this._iconCache     = new IconCache.IconCache()

        this._mainIcon    = new St.Bin()
        this._overlayIcon = new St.Bin({ 'x-align': St.Align.END, 'y-align': St.Align.END })

        this.add_actor(this._mainIcon)
        this.add_actor(this._overlayIcon)

        Util.connectSmart(this._indicator, 'icon',         this, '_updateIcon')
        Util.connectSmart(this._indicator, 'overlay-icon', this, '_updateOverlayIcon')
        Util.connectSmart(this._indicator, 'ready',        this, '_invalidateIcon')

        Util.connectSmart(this, 'scroll-event', this, '_handleScrollEvent')

        Util.connectSmart(Gtk.IconTheme.get_default(), 'changed', this, '_invalidateIcon')

        if (indicator.isReady)
            this._invalidateIcon()
    },

    // Will look the icon up in the cache, if it's found
    // it will return it. Otherwise, it will create it and cache it.
    // The .inUse flag will be set to true. So when you don't need
    // the returned icon anymore, make sure to check the .inUse property
    // and set it to false if needed so that it can be picked up by the garbage
    // collector.
    _cacheOrCreateIconByName: function(iconSize, iconName, themePath) {
        let id = iconName + '@' + iconSize + (themePath ? '##' + themePath : '')

        let icon = this._iconCache.get(id) || this._createIconByName(iconSize, iconName, themePath)

        if (icon) {
            icon.inUse = true
            this._iconCache.add(id, icon)
        }

        return icon
    },

    _createIconByName: function(icon_size, icon_name, themePath) {
        // real_icon_size will contain the actual icon size in contrast to the requested icon size
        var real_icon_size = icon_size
        var gicon = null

        if (icon_name && icon_name[0] == "/") {
            //HACK: icon is a path name. This is not specified by the api but at least inidcator-sensors uses it.
            var [ format, width, height ] = GdkPixbuf.Pixbuf.get_file_info(icon_name)
            if (!format) {
                Util.Logger.fatal("invalid image format: "+icon_name)
            } else {
                // if the actual icon size is smaller, save that for later.
                // scaled icons look ugly.
                if (Math.max(width, height) < icon_size)
                    real_icon_size = Math.max(width, height)

                gicon = Gio.icon_new_for_string(icon_name)
            }
        } else if (icon_name) {
            // we manually look up the icon instead of letting st.icon do it for us
            // this allows us to sneak in an indicator provided search path and to avoid ugly upscaled icons

            // icon info as returned by the lookup
            var icon_info = null

            // we try to avoid messing with the default icon theme, so we'll create a new one if needed
            if (themePath) {
                var icon_theme = new Gtk.IconTheme()
                Gtk.IconTheme.get_default().get_search_path().forEach(function(path) {
                    icon_theme.append_search_path(path)
                });
                icon_theme.append_search_path(themePath)
                icon_theme.set_screen(imports.gi.Gdk.Screen.get_default())
            } else {
                var icon_theme = Gtk.IconTheme.get_default()
            }

            // try to look up the icon in the icon theme
            // indicator-application looks up a special "panel" variant, we just replicate that here
            if (icon_theme.has_icon(icon_name + "-panel")) {
                icon_name = icon_name + "-panel"
            }

            icon_info = icon_theme.lookup_icon(icon_name, icon_size,
                                               Gtk.IconLookupFlags.GENERIC_FALLBACK)

            // no icon? that's bad!
            if (icon_info === null) {
                Util.Logger.fatal("unable to lookup icon for "+icon_name);
            } else { // we have an icon
                // the icon size may not match the requested size, especially with custom themes
                if (icon_info.get_base_size() < icon_size) {
                    // stretched icons look very ugly, we avoid that and just show the smaller icon
                    real_icon_size = icon_info.get_base_size()
                }

                // create a gicon for the icon
                gicon = Gio.icon_new_for_string(icon_info.get_filename())
            }
        }

        if (gicon)
            return new St.Icon({ gicon: gicon, icon_size: real_icon_size })
        else
            return null
    },

    _createIconFromPixmap: function(iconSize, iconPixmapArray) {
        // the pixmap actually is an array of pixmaps with different sizes
        // we use the one that is smaller or equal the iconSize

        // maybe it's empty? that's bad.
        if (!iconPixmapArray || iconPixmapArray.length < 1)
            return null

            let sortedIconPixmapArray = iconPixmapArray.sort(function(pixmapA, pixmapB) {
                // we sort biggest to smallest
                let areaA = pixmapA[0] * pixmapA[1]
                let areaB = pixmapB[0] * pixmapB[1]

                return areaB - areaA
            })

            let qualifiedIconPixmapArray = sortedIconPixmapArray.filter(function(pixmap) {
                // we disqualify any pixmap that is bigger than our requested size
                return pixmap[0] <= iconSize && pixmap[1] <= iconSize
            })

            // if no one got qualified, we use the smallest one available
            let iconPixmap = qualifiedIconPixmapArray.length > 0 ? qualifiedIconPixmapArray[0] : sortedIconPixmapArray.pop()

            let [ width, height, bytes ] = iconPixmap
            let rowstride = width * 4 // hopefully this is correct

            try {
                let image = new Clutter.Image()
                image.set_bytes(bytes,
                                Cogl.PixelFormat.ARGB_8888,
                                width,
                                height,
                                rowstride)

                let scale_factor = 1
                if (height != 0)
                    scale_factor = iconSize / height
                else
                    scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor

                return new Clutter.Actor({
                    width: Math.min(width, iconSize),
                    height: Math.min(height, iconSize),
                    content: image,
                    scale_x: scale_factor,
                    scale_y: scale_factor,
                    pivot_point: new Clutter.Point({ x: .5, y: .5 })
                })
            } catch (e) {
                // the image data was probably bogus. We don't really know why, but it _does_ happen.
                // we could log it here, but that doesn't really help in tracking it down.
                return null
            }
    },

    // updates the base icon
    _updateIcon: function() {
        // remove old icon
        if (this._mainIcon.get_child()) {
            let child = this._mainIcon.get_child()

            if (child.inUse)
                child.inUse = false
            else if (child.destroy)
                child.destroy()

            this._mainIcon.set_child(null)
        }

        // place to save the new icon
        let newIcon = null

        // we might need to use the AttentionIcon*, which have precedence over the normal icons
        if (this._indicator.status == SNIStatus.NEEDS_ATTENTION) {
            let [ name, pixmap, theme ] = this._indicator.attentionIcon

            if (name && name.length)
                newIcon = this._cacheOrCreateIconByName(this._iconSize, name, theme)

            if (!newIcon && pixmap)
                newIcon = this._createIconFromPixmap(this._iconSize, pixmap)
        }

        if (!newIcon) {
            let [ name, pixmap, theme ] = this._indicator.icon

            if (name && name.length)
                newIcon = this._cacheOrCreateIconByName(this._iconSize, name, theme)

            if (!newIcon && pixmap)
                newIcon = this._createIconFromPixmap(this._iconSize, pixmap)
        }

        this._mainIcon.set_child(newIcon)
    },

    _updateOverlayIcon: function() {
        // remove old icon
        if (this._overlayIcon.get_child()) {
            let child = this._overlayIcon.get_child()

            if (child.inUse)
                child.inUse = false
            else if (child.destroy)
                child.destroy()

            this._overlayIcon.set_child(null)
        }

        // KDE hardcodes the overlay icon size to 10px (normal icon size 16px)
        // we approximate that ratio for other sizes, too.
        // our algorithms will always pick a smaller one instead of stretching it.
        let iconSize = Math.floor(this._iconSize / 1.6)

        let newIcon = null

        // create new
        let [ name, pixmap, theme ] = this._indicator.overlayIcon

        if (name && name.length)
            newIcon = this._cacheOrCreateIconByName(iconSize, name, theme)

        if (!newIcon && pixmap)
            newIcon = this._createIconFromPixmap(iconSize, pixmap)

        this._overlayIcon.set_child(newIcon)
    },

    _handleScrollEvent: function(actor, event) {
        if (actor != this)
            return Clutter.EVENT_PROPAGATE

        if (event.get_source() != this)
            return Clutter.EVENT_PROPAGATE

        if (event.type() != Clutter.EventType.SCROLL)
            return Clutter.EVENT_PROPAGATE

        // Since Clutter 1.10, clutter will always send a smooth scrolling event
        // with explicit deltas, no matter what input device is used
        // In fact, for every scroll there will be a smooth and non-smooth scroll
        // event, and we can choose which one we interpret.
        if (event.get_scroll_direction() == Clutter.ScrollDirection.SMOOTH) {
            let [ dx, dy ] = event.get_scroll_delta()

            this._indicator.scroll(dx, dy)
        }

        return Clutter.EVENT_STOP
    },

    // called when the icon theme changes
    _invalidateIcon: function() {
        this._iconCache.clear()

        this._updateIcon()
        this._updateOverlayIcon()
    },

    destroy: function() {
        this._iconCache.destroy()

        this.parent()
    }
})
