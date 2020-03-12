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
const GObject = imports.gi.GObject
const Gtk = imports.gi.Gtk
const St = imports.gi.St
const Shell = imports.gi.Shell
const Mainloop = imports.mainloop

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Signals = imports.signals

const DBusMenu = Extension.imports.dbusMenu;
var IconCache = Extension.imports.iconCache;
const Util = Extension.imports.util;
const Interfaces = Extension.imports.interfaces;

const SNICategory = {
    APPLICATION: 'ApplicationStatus',
    COMMUNICATIONS: 'Communications',
    SYSTEM: 'SystemServices',
    HARDWARE: 'Hardware'
};

var SNIStatus = {
    PASSIVE: 'Passive',
    ACTIVE: 'Active',
    NEEDS_ATTENTION: 'NeedsAttention'
};

const SNIconType = {
    NORMAL: 0,
    ATTENTION: 1,
    OVERLAY: 2,
};

/**
 * the AppIndicator class serves as a generic container for indicator information and functions common
 * for every displaying implementation (IndicatorMessageSource and IndicatorStatusIcon)
 */
var AppIndicator = class AppIndicators_AppIndicator {

    constructor(bus_name, object) {
        this.busName = bus_name
        this._uniqueId = bus_name + object

        let interface_info = Gio.DBusInterfaceInfo.new_for_xml(Interfaces.StatusNotifierItem)

        //HACK: we cannot use Gio.DBusProxy.makeProxyWrapper because we need
        //      to specify G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES
        this._cancellable = new Gio.Cancellable();
        this._proxy = new Gio.DBusProxy({ g_connection: Gio.DBus.session,
                                          g_interface_name: interface_info.name,
                                          g_interface_info: interface_info,
                                          g_name: bus_name,
                                          g_object_path: object,
                                          g_flags: Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES })
        this._proxy.init_async(GLib.PRIORITY_DEFAULT, this._cancellable, ((initable, result) => {
                try {
                    initable.init_finish(result);
                    this._checkIfReady();

                    if (!this.isReady && !this.menuPath) {
                        let checks = 0;
                        this._delayCheck = Mainloop.timeout_add_seconds(1, () => {
                            Util.refreshPropertyOnProxy(this._proxy, 'Menu');
                            return !this.isReady && ++checks < 3;
                        });
                    }
                } catch(e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        Util.Logger.warn(`While intializing proxy for ${bus_name} ${object}: ${e}`);
                }
            }))

        this._proxyPropertyList = interface_info.properties.map((propinfo) => { return propinfo.name })
        this._addExtraProperty('XAyatanaLabel');
        this._addExtraProperty('XAyatanaLabelGuide');
        this._addExtraProperty('XAyatanaOrderingIndex');

        Util.connectSmart(this._proxy, 'g-properties-changed', this, '_onPropertiesChanged')
        Util.connectSmart(this._proxy, 'g-signal', this, '_translateNewSignals')
        Util.connectSmart(this._proxy, 'notify::g-name-owner', this, '_nameOwnerChanged')
    }

    _checkIfReady() {
        let wasReady = this.isReady;
        let isReady = false;

        if (this._proxy.g_name_owner && this.menuPath)
            isReady = true;

        this.isReady = isReady;

        if (this.isReady && !wasReady) {
            if (this._delayCheck) {
                GLib.Source.remove(this._delayCheck);
                delete this._delayCheck;
            }

            this.emit('ready');
            return true;
        }

        return false;
    }

    _nameOwnerChanged() {
        if (!this._proxy.g_name_owner)
            this._checkIfReady();
    }

    _addExtraProperty(name) {
        let propertyProps = { configurable: false, enumerable: true };

        propertyProps.get = () => {
            let v = this._proxy.get_cached_property(name);
            return v ? v.deep_unpack() : null
        };

        Object.defineProperty(this._proxy, name, propertyProps);
        this._proxyPropertyList.push(name);
    }

    // The Author of the spec didn't like the PropertiesChanged signal, so he invented his own
    _translateNewSignals(proxy, sender, signal, params) {
        let prop = null;

        if (signal.substr(0, 3) == 'New')
            prop = signal.substr(3)
        else if (signal.substr(0, 11) == 'XAyatanaNew')
            prop = 'XAyatana' + signal.substr(11)

        if (prop) {
            if (this._proxyPropertyList.indexOf(prop) > -1)
                Util.refreshPropertyOnProxy(this._proxy, prop)

            if (this._proxyPropertyList.indexOf(prop + 'Pixmap') > -1)
                Util.refreshPropertyOnProxy(this._proxy, prop + 'Pixmap')

            if (this._proxyPropertyList.indexOf(prop + 'Name') > -1)
                Util.refreshPropertyOnProxy(this._proxy, prop + 'Name')
        }
    }

    //public property getters
    get title() {
        return this._proxy.Title;
    }
    get id() {
        return this._proxy.Id;
    }
    get uniqueId() {
        return this._uniqueId;
    }
    get status() {
        return this._proxy.Status;
    }
    get label() {
        return this._proxy.XAyatanaLabel;
    }
    get menuPath() {
        if (this._proxy.Menu == '/NO_DBUSMENU')
            return null;

        return this._proxy.Menu || '/MenuBar';
    }

    get attentionIcon() {
        return [
            this._proxy.AttentionIconName,
            this._proxy.AttentionIconPixmap,
            this._proxy.IconThemePath
        ]
    }

    get icon() {
        return [
            this._proxy.IconName,
            this._proxy.IconPixmap,
            this._proxy.IconThemePath
        ]
    }

    get overlayIcon() {
        return [
            this._proxy.OverlayIconName,
            this._proxy.OverlayIconPixmap,
            this._proxy.IconThemePath
        ]
    }

    _onPropertiesChanged(proxy, changed, invalidated) {
        let props = Object.keys(changed.deep_unpack())

        props.forEach((property) => {
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

            if (property == 'Menu') {
                if (!this._checkIfReady() && this.isReady)
                    this.emit('menu')
            }

            // status updates may cause the indicator to be hidden
            if (property == 'Status')
                this.emit('status')
        }, this);
    }

    reset() {
        this.emit('reset');
    }

    destroy() {
        this.emit('destroy')

        this.disconnectAll()
        this._cancellable.cancel();
        Util.cancelRefreshPropertyOnProxy(this._proxy);
        delete this._cancellable;
        delete this._proxy

        if (this._delayCheck) {
            GLib.Source.remove(this._delayCheck);
            delete this._delayCheck;
        }
    }

    open() {
        // we can't use WindowID because we're not able to get the x11 window id from a MetaWindow
        // nor can we call any X11 functions. Luckily, the Activate method usually works fine.
        // parameters are "an hint to the item where to show eventual windows" [sic]
        // ... and don't seem to have any effect.
        this._proxy.ActivateRemote(0, 0)
    }

    secondaryActivate() {
        this._proxy.SecondaryActivateRemote(0, 0)
    }

    scroll(dx, dy) {
        if (dx != 0)
            this._proxy.ScrollRemote(Math.floor(dx), 'horizontal')

        if (dy != 0)
            this._proxy.ScrollRemote(Math.floor(dy), 'vertical')
    }
};
Signals.addSignalMethods(AppIndicator.prototype);

var IconActor = GObject.registerClass(
class AppIndicators_IconActor extends St.Icon {

    _init(indicator, icon_size) {
        super._init({
            reactive: true,
            style_class: 'system-status-icon',
            fallback_icon_name: 'image-loading-symbolic',
        });

        this.name = this.constructor.name;
        this.add_style_class_name('appindicator-icon');

        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        this.height = icon_size * themeContext.scale_factor;

        this._indicator     = indicator
        this._iconSize      = icon_size
        this._iconCache     = new IconCache.IconCache()
        this._cancellable   = new Gio.Cancellable();
        this._loadingIcons  = new Set();

        Util.connectSmart(this._indicator, 'icon',         this, '_updateIcon')
        Util.connectSmart(this._indicator, 'overlay-icon', this, '_updateOverlayIcon')
        Util.connectSmart(this._indicator, 'reset',        this, '_invalidateIcon')
        Util.connectSmart(this, 'scroll-event',            this, '_handleScrollEvent')

        Util.connectSmart(themeContext, 'notify::scale-factor', this, (tc) => {
            this.height = icon_size * tc.scale_factor;
            this._invalidateIcon();
        });

        Util.connectSmart(this._indicator, 'ready', this, () => {
            this._updateIconClass();
            this._invalidateIcon();
        })

        Util.connectSmart(Gtk.IconTheme.get_default(), 'changed', this, '_invalidateIcon')

        if (indicator.isReady)
            this._invalidateIcon()

        this.connect('destroy', () => {
            this._iconCache.destroy();
            this._cancellable.cancel();
        });
    }

    _updateIconClass() {
        this.add_style_class_name(
            `appindicator-icon-${this._indicator.id.toLowerCase().replace(/_|\s/g, '-')}`);
    }

    // Will look the icon up in the cache, if it's found
    // it will return it. Otherwise, it will create it and cache it.
    // The .inUse flag will be set to true. So when you don't need
    // the returned icon anymore, make sure to check the .inUse property
    // and set it to false if needed so that it can be picked up by the garbage
    // collector.
    _cacheOrCreateIconByName(iconSize, iconName, themePath, callback) {
        let {scale_factor} = St.ThemeContext.get_for_stage(global.stage);
        let id = `${iconName}@${iconSize * scale_factor}${themePath || ''}`;
        let gicon = this._iconCache.get(id);

        if (gicon) {
            callback(gicon);
            return;
        }

        if (this._loadingIcons.has(id)) {
            Util.Logger.debug(`${this._indicator.id}, Icon ${id} Is still loading, ignoring the request`);
            return;
        } else if (this._loadingIcons.size > 0) {
            this._cancellable.cancel();
            this._cancellable = new Gio.Cancellable();
            this._loadingIcons.clear();
        }

        this._loadingIcons.add(id);
        let path = this._getIconInfo(iconName, themePath, iconSize, scale_factor);
        this._createIconByName(path, (gicon) => {
            this._loadingIcons.delete(id);
            if (gicon) {
                gicon.inUse = true;
                this._iconCache.add(id, gicon);
            }
            callback(gicon);
        });
    }

    _createIconByPath(path, width, height, callback) {
        let file = Gio.File.new_for_path(path);
        file.read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (file, res) => {
            try {
                let inputStream = file.read_finish(res);

                GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                    inputStream, height, width, true, this._cancellable, (_p, res) => {
                        try {
                            callback(GdkPixbuf.Pixbuf.new_from_stream_finish(res));
                            this.icon_size = width > 0 ? width : this._iconSize;
                        } catch (e) {
                            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                                Util.Logger.warn(`${this._indicator.id}, Impossible to create image from path '${path}': ${e}`);
                                callback(null);
                            }
                        }
                    });
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    Util.Logger.warn(`${this._indicator.id}, Impossible to read image from path '${path}': ${e}`);
                    callback(null);
                }
            }
        });
    }

    _createIconByName(path, callback) {
        GdkPixbuf.Pixbuf.get_file_info_async(path, this._cancellable, (_p, res) => {
            try {
                let [format, width, height] = GdkPixbuf.Pixbuf.get_file_info_finish(res);

                if (!format) {
                    Util.Logger.critical(`${this._indicator.id}, Invalid image format: ${path}`);
                    callback(null);
                    return;
                }

                if (width >= height * 1.5) {
                    /* Hello indicator-multiload! */
                    this._createIconByPath(path, width, -1, callback);
                } else {
                    callback(new Gio.FileIcon({
                        file: Gio.File.new_for_path(path)
                    }));
                    this.icon_size = this._iconSize;
                }
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    Util.Logger.warn(`${this._indicator.id}, Impossible to read image info from path '${path}': ${e}`);
                    callback(null);
                }
            }
        });
    }

    _getIconInfo(name, themePath, size, scale) {
        let path = null;
        if (name && name[0] == "/") {
            //HACK: icon is a path name. This is not specified by the api but at least inidcator-sensors uses it.
            path = name;
        } else if (name) {
            // we manually look up the icon instead of letting st.icon do it for us
            // this allows us to sneak in an indicator provided search path and to avoid ugly upscaled icons

            // indicator-application looks up a special "panel" variant, we just replicate that here
            name = name + "-panel";

            // icon info as returned by the lookup
            let iconInfo = null;

            // we try to avoid messing with the default icon theme, so we'll create a new one if needed
            let icon_theme = null;
            if (themePath) {
                icon_theme = new Gtk.IconTheme();
                Gtk.IconTheme.get_default().get_search_path().forEach((path) => {
                    icon_theme.append_search_path(path);
                });
                icon_theme.append_search_path(themePath);
                icon_theme.set_screen(imports.gi.Gdk.Screen.get_default());
            } else {
                icon_theme = Gtk.IconTheme.get_default();
            }
            if (icon_theme) {
                // try to look up the icon in the icon theme
                iconInfo = icon_theme.lookup_icon_for_scale(name, size, scale,
                    Gtk.IconLookupFlags.GENERIC_FALLBACK);
                // no icon? that's bad!
                if (iconInfo === null) {
                    Util.Logger.warn(`${this._indicator.id}, Impossible to lookup icon for '${name}'`);
                } else { // we have an icon
                    // get the icon path
                    path = iconInfo.get_filename();
                }
            }
        }
        return path;
    }

    argbToRgba(src) {
        let dest = new Uint8Array(src.length);

        for (let i = 0; i < src.length; i += 4) {
            let srcAlpha = src[i]

            dest[i]     = src[i + 1]; /* red */
            dest[i + 1] = src[i + 2]; /* green */
            dest[i + 2] = src[i + 3]; /* blue */
            dest[i + 3] = srcAlpha; /* alpha */
        }

        return dest;
    }

    _createIconFromPixmap(iconSize, iconPixmapArray, snIconType) {
        let {scale_factor} = St.ThemeContext.get_for_stage(global.stage);
        iconSize = iconSize * scale_factor
        // the pixmap actually is an array of pixmaps with different sizes
        // we use the one that is smaller or equal the iconSize

        // maybe it's empty? that's bad.
        if (!iconPixmapArray || iconPixmapArray.length < 1)
            return null

            let sortedIconPixmapArray = iconPixmapArray.sort((pixmapA, pixmapB) => {
                // we sort smallest to biggest
                let areaA = pixmapA[0] * pixmapA[1]
                let areaB = pixmapB[0] * pixmapB[1]

                return areaA - areaB
            })

            let qualifiedIconPixmapArray = sortedIconPixmapArray.filter((pixmap) => {
                // we prefer any pixmap that is equal or bigger than our requested size
                return pixmap[0] >= iconSize && pixmap[1] >= iconSize;
            })

            let iconPixmap = qualifiedIconPixmapArray.length > 0 ? qualifiedIconPixmapArray[0] : sortedIconPixmapArray.pop()

            let [ width, height, bytes ] = iconPixmap
            let rowstride = width * 4 // hopefully this is correct

            try {
                return GdkPixbuf.Pixbuf.new_from_bytes(
                    this.argbToRgba(bytes),
                    GdkPixbuf.Colorspace.RGB, true,
                    8, width, height, rowstride);
            } catch (e) {
                // the image data was probably bogus. We don't really know why, but it _does_ happen.
                Util.Logger.warn(`${this._indicator.id}, Impossible to create image from data: ${e}`)
                return null
            }
    }

    _setGicon(iconType, gicon) {
        if (iconType != SNIconType.OVERLAY) {
            if (gicon) {
                this.gicon = new Gio.EmblemedIcon({ gicon });
            } else {
                this.gicon = null;
                Util.Logger.critical(`unable to update icon for ${this._indicator.id}`);
            }
        } else {
            if (gicon) {
                this._emblem = new Gio.Emblem({ icon: gicon });
            } else {
                this._emblem = null;
                Util.Logger.debug(`unable to update icon emblem for ${this._indicator.id}`);
            }
        }

        if (this.gicon) {
            if (!this._emblem || !this.gicon.get_emblems().includes(this._emblem)) {
                this.gicon.clear_emblems();
                if (this._emblem)
                    this.gicon.add_emblem(this._emblem);
            }
        }
    }

    _updateIconByType(iconType, iconSize) {
        let icon;
        switch (iconType) {
            case SNIconType.ATTENTION:
                icon = this._indicator.attentionIcon;
                break;
            case SNIconType.NORMAL:
                icon = this._indicator.icon;
                break;
            case SNIconType.OVERLAY:
                icon = this._indicator.overlayIcon;
                break;
        }

        let [name, pixmap, theme] = icon;
        if (name && name.length) {
            this._cacheOrCreateIconByName(iconSize, name, theme, (gicon) => {
                if (!gicon && pixmap) {
                    gicon = this._createIconFromPixmap(iconSize,
                        pixmap, iconType);
                }
                this._setGicon(iconType, gicon);
            });
        } else if (pixmap) {
            let gicon = this._createIconFromPixmap(iconSize,
                pixmap, iconType);
            this._setGicon(iconType, gicon);
        }
    }

    // updates the base icon
    _updateIcon() {
        if (this.gicon) {
            let { gicon } = this;

            if (gicon.inUse)
                gicon.inUse = false
        }

        // we might need to use the AttentionIcon*, which have precedence over the normal icons
        let iconType = this._indicator.status == SNIStatus.NEEDS_ATTENTION ?
            SNIconType.ATTENTION : SNIconType.NORMAL;

        this._updateIconByType(iconType, this._iconSize);
    }

    _updateOverlayIcon() {
        // remove old icon
        if (this.gicon && this.gicon.get_emblems().length) {
            let [emblem] = this.gicon.get_emblems();

            if (emblem.inUse)
                emblem.inUse = false
        }

        // KDE hardcodes the overlay icon size to 10px (normal icon size 16px)
        // we approximate that ratio for other sizes, too.
        // our algorithms will always pick a smaller one instead of stretching it.
        let iconSize = Math.floor(this._iconSize / 1.6)

        this._updateIconByType(SNIconType.OVERLAY, iconSize);
    }

    _handleScrollEvent(actor, event) {
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
    }

    // called when the icon theme changes
    _invalidateIcon() {
        this._iconCache.clear()

        this._updateIcon()
        this._updateOverlayIcon()
    }
});
