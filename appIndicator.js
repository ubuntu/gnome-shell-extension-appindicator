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

/* exported AppIndicator, IconActor */

const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Signals = imports.signals;

const IconCache = Extension.imports.iconCache;
const Util = Extension.imports.util;
const Interfaces = Extension.imports.interfaces;
const PromiseUtils = Extension.imports.promiseUtils;
const SettingsManager = Extension.imports.settingsManager;

PromiseUtils._promisify(Gio.File.prototype, 'read_async', 'read_finish');
PromiseUtils._promisify(Gio._LocalFilePrototype, 'read_async', 'read_finish');
PromiseUtils._promisify(GdkPixbuf.Pixbuf, 'get_file_info_async', 'get_file_info_finish');
PromiseUtils._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');
PromiseUtils._promisify(Gio.DBusProxy.prototype, 'init_async', 'init_finish');

const MAX_UPDATE_FREQUENCY = 100; // In ms

// eslint-disable-next-line no-unused-vars
const SNICategory = {
    APPLICATION: 'ApplicationStatus',
    COMMUNICATIONS: 'Communications',
    SYSTEM: 'SystemServices',
    HARDWARE: 'Hardware',
};

var SNIStatus = {
    PASSIVE: 'Passive',
    ACTIVE: 'Active',
    NEEDS_ATTENTION: 'NeedsAttention',
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
var AppIndicator = class AppIndicatorsAppIndicator {

    constructor(service, busName, object) {
        this.busName = busName;
        this._uniqueId = busName + object;
        this._accumulatedSignals = new Set();

        const interfaceInfo = Gio.DBusInterfaceInfo.new_for_xml(Interfaces.StatusNotifierItem);

        // HACK: we cannot use Gio.DBusProxy.makeProxyWrapper because we need
        //      to specify G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES
        this._cancellable = new Gio.Cancellable();
        this._proxy = new Gio.DBusProxy({ g_connection: Gio.DBus.session,
            g_interface_name: interfaceInfo.name,
            g_interface_info: interfaceInfo,
            g_name: busName,
            g_object_path: object,
            g_flags: Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES });

        this._setupProxy();
        Util.connectSmart(this._proxy, 'g-properties-changed', this, this._onPropertiesChanged);
        Util.connectSmart(this._proxy, 'g-signal', this, this._onProxySignal);
        Util.connectSmart(this._proxy, 'notify::g-name-owner', this, this._nameOwnerChanged);

        if (service !== busName && service.match(Util.BUS_ADDRESS_REGEX)) {
            this._uniqueId = service;
            this._nameWatcher = new Util.NameWatcher(service);
            Util.connectSmart(this._nameWatcher, 'changed', this, this._nameOwnerChanged);
        }
    }

    async _setupProxy() {
        try {
            await this._proxy.init_async(GLib.PRIORITY_DEFAULT, this._cancellable);
            this._checkIfReady();
            this._checkNeededProperties();
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`While initalizing proxy for ${this._uniqueId}: ${e}`);
        }
    }

    _checkIfReady() {
        let wasReady = this.isReady;
        let isReady = false;

        if (this.hasNameOwner && this.id && this.menuPath)
            isReady = true;

        this.isReady = isReady;
        this._setupProxyPropertyList();

        if (this.isReady && !wasReady) {
            if (this._delayCheck) {
                this._delayCheck.cancel();
                delete this._delayCheck;
            }

            this.emit('ready');
            return true;
        }

        return false;
    }

    async _checkNeededProperties() {
        if (this.id && this.menuPath)
            return true;

        const cancellable = this._cancellable;
        for (let checks = 0; checks < 3 && !this.isReady; ++checks) {
            this._delayCheck = new PromiseUtils.TimeoutSecondsPromise(1,
                GLib.PRIORITY_DEFAULT_IDLE, cancellable);
            // eslint-disable-next-line no-await-in-loop
            await this._delayCheck;
            Util.refreshPropertyOnProxy(this._proxy, 'Id');
            Util.refreshPropertyOnProxy(this._proxy, 'Menu');
        }

        return this.id && this.menuPath;
    }

    _nameOwnerChanged() {
        if (!this.hasNameOwner)
            this._checkIfReady();
        else
            this._checkNeededProperties();

        this.emit('name-owner-changed');
    }

    _addExtraProperty(name) {
        if (this._proxyPropertyList.includes(name))
            return;

        if (!(name in this._proxy)) {
            Object.defineProperty(this._proxy, name, {
                configurable: false,
                enumerable: true,
                get: () => {
                    const v = this._proxy.get_cached_property(name);
                    return v ? v.deep_unpack() : null;
                },
            });
        }

        this._proxyPropertyList.push(name);
    }

    _setupProxyPropertyList() {
        let interfaceProps = this._proxy.g_interface_info.properties;
        this._proxyPropertyList =
            (this._proxy.get_cached_property_names() || []).filter(p =>
                interfaceProps.some(propinfo => propinfo.name === p));

        if (this._proxyPropertyList.length) {
            this._addExtraProperty('XAyatanaLabel');
            this._addExtraProperty('XAyatanaLabelGuide');
            this._addExtraProperty('XAyatanaOrderingIndex');
            this._addExtraProperty('IconAccessibleDesc');
            this._addExtraProperty('AttentionAccessibleDesc');
        }
    }

    // The Author of the spec didn't like the PropertiesChanged signal, so he invented his own
    _translateNewSignals(signal) {
        let prop = null;

        if (signal.startsWith('New'))
            prop = signal.substr(3);
        else if (signal.startsWith('XAyatanaNew'))
            prop = `XAyatana${signal.substr(11)}`;

        if (!prop)
            return;

        [prop, `${prop}Name`, `${prop}Pixmap`, `${prop}AccessibleDesc`].filter(p =>
            this._proxyPropertyList.includes(p)).forEach(p =>
            Util.refreshPropertyOnProxy(this._proxy, p, {
                skipEqualityCheck: p.endsWith('Pixmap'),
            }),
        );
    }

    async _onProxySignal(_proxy, _sender, signal, _params) {
        this._accumulatedSignals.add(signal);

        if (this._signalsAccumulator)
            return;

        this._signalsAccumulator = new PromiseUtils.TimeoutPromise(
            GLib.PRIORITY_DEFAULT_IDLE, MAX_UPDATE_FREQUENCY, this._cancellable);
        try {
            await this._signalsAccumulator;
            this._accumulatedSignals.forEach(s => this._translateNewSignals(s));
            this._accumulatedSignals.clear();
        } finally {
            delete this._signalsAccumulator;
        }
    }

    // public property getters
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

    get accessibleName() {
        const accessibleDesc = this.status === SNIStatus.NEEDS_ATTENTION
            ? this._proxy.AccessibleDesc : this._proxy.IconAccessibleDesc;

        return accessibleDesc || this.title;
    }

    get menuPath() {
        if (this._proxy.Menu === '/NO_DBUSMENU')
            return null;

        return this._proxy.Menu || '/MenuBar';
    }

    get attentionIcon() {
        return [
            this._proxy.AttentionIconName,
            this._proxy.AttentionIconPixmap,
            this._proxy.IconThemePath,
        ];
    }

    get icon() {
        return [
            this._proxy.IconName,
            this._proxy.IconPixmap,
            this._proxy.IconThemePath,
        ];
    }

    get overlayIcon() {
        return [
            this._proxy.OverlayIconName,
            this._proxy.OverlayIconPixmap,
            this._proxy.IconThemePath,
        ];
    }

    get hasNameOwner() {
        return !!this._proxy.g_name_owner ||
            this._nameWatcher && this._nameWatcher.nameOnBus;
    }

    get cancellable() {
        return this._cancellable;
    }

    _onPropertiesChanged(_proxy, changed, _invalidated) {
        let props = Object.keys(changed.unpack());
        let signalsToEmit = new Set();
        const checkIfReadyChanged = () => {
            if (checkIfReadyChanged.value === undefined)
                checkIfReadyChanged.value = this._checkIfReady();
            return checkIfReadyChanged.value;
        };

        props.forEach(property => {
            // some property changes require updates on our part,
            // a few need to be passed down to the displaying code
            if (property === 'Id')
                checkIfReadyChanged();

            // all these can mean that the icon has to be changed
            if (property.startsWith('Icon') ||
                property.startsWith('AttentionIcon'))
                signalsToEmit.add('icon');

            // same for overlays
            if (property.startsWith('OverlayIcon'))
                signalsToEmit.add('overlay-icon');

            // this may make all of our icons invalid
            if (property === 'IconThemePath') {
                signalsToEmit.add('icon');
                signalsToEmit.add('overlay-icon');
            }

            // the label will be handled elsewhere
            if (property === 'XAyatanaLabel')
                signalsToEmit.add('label');

            if (property === 'Menu') {
                if (!checkIfReadyChanged() && this.isReady)
                    signalsToEmit.add('menu');
            }

            if (property === 'IconAccessibleDesc' ||
                property === 'AttentionAccessibleDesc' ||
                property === 'Title')
                signalsToEmit.add('accessible-name');

            // status updates may cause the indicator to be hidden
            if (property === 'Status') {
                signalsToEmit.add('icon');
                signalsToEmit.add('status');
                signalsToEmit.add('accessible-name');
            }
        });

        signalsToEmit.forEach(s => this.emit(s));
    }

    reset() {
        this.emit('reset');
    }

    destroy() {
        this.emit('destroy');

        this.disconnectAll();
        this._cancellable.cancel();
        Util.cancelRefreshPropertyOnProxy(this._proxy);
        if (this._nameWatcher)
            this._nameWatcher.destroy();
        delete this._cancellable;
        delete this._proxy;
        delete this._nameWatcher;
    }

    open(x, y) {
        // we can't use WindowID because we're not able to get the x11 window id from a MetaWindow
        // nor can we call any X11 functions. Luckily, the Activate method usually works fine.
        // parameters are "an hint to the item where to show eventual windows" [sic]
        // ... and don't seem to have any effect.
        this._proxy.ActivateRemote(x, y, this._cancellable, (_, e) => {
            if (e && !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.critical(`${this._indicator.id}, failed to activate: ${e.message}`);
        });
    }

    secondaryActivate(timestamp, x, y) {
        const cancellable = this._cancellable;

        this._proxy.XAyatanaSecondaryActivateRemote(timestamp, cancellable, (_, e) => {
            if (e && e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD)) {
                this._proxy.SecondaryActivateRemote(x, y, cancellable, (_r, error) => {
                    if (error && !error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        Util.Logger.critical(`${this._indicator.id}, failed to secondary activate: ${e.message}`);
                });
            } else if (e && !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                Util.Logger.critical(`${this._indicator.id}, failed to secondary activate: ${e.message}`);
            }
        });
    }

    scroll(dx, dy) {
        const cancellable = this._cancellable;

        if (dx !== 0) {
            this._proxy.ScrollRemote(Math.floor(dx), 'horizontal', cancellable, (_, e) => {
                if (e && !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    Util.Logger.critical(`${this._indicator.id}, failed to scroll horizontally: ${e.message}`);
            });
        }

        if (dy !== 0) {
            this._proxy.ScrollRemote(Math.floor(dy), 'vertical', cancellable, (_, e) => {
                if (e && !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    Util.Logger.critical(`${this._indicator.id}, failed to scroll vertically: ${e.message}`);
            });
        }
    }
};
Signals.addSignalMethods(AppIndicator.prototype);

var IconActor = GObject.registerClass(
class AppIndicatorsIconActor extends St.Icon {

    _init(indicator, iconSize) {
        super._init({
            reactive: true,
            style_class: 'system-status-icon',
            fallback_icon_name: 'image-loading-symbolic',
        });

        this.name = this.constructor.name;
        this.add_style_class_name('appindicator-icon');
        this.add_style_class_name('status-notifier-icon');
        this.set_style('padding:0');

        // eslint-disable-next-line no-undef
        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        this.height = iconSize * themeContext.scale_factor;

        this._indicator     = indicator;
        this._customIcons   = new Map();
        this._iconSize      = iconSize;
        this._iconCache     = new IconCache.IconCache();
        this._cancellable   = new Gio.Cancellable();
        this._loadingIcons  = new Set();

        Util.connectSmart(this._indicator, 'icon', this, this._updateIcon);
        Util.connectSmart(this._indicator, 'overlay-icon', this, this._updateOverlayIcon);
        Util.connectSmart(this._indicator, 'reset', this, this._invalidateIcon);

        const settings = SettingsManager.getDefaultGSettings();
        Util.connectSmart(settings, 'changed::icon-size', this, this._invalidateIcon);
        Util.connectSmart(settings, 'changed::custom-icons', this, () => {
            this._updateCustomIcons();
            this._invalidateIcon();
        });

        Util.connectSmart(themeContext, 'notify::scale-factor', this, tc => {
            this.height = iconSize * tc.scale_factor;
            this._invalidateIcon();
        });

        Util.connectSmart(this._indicator, 'ready', this, () => {
            this._updateIconClass();
            this._updateCustomIcons();
            this._invalidateIcon();
        });

        Util.connectSmart(Util.getDefaultTheme(), 'changed', this, this._invalidateIcon);

        if (indicator.isReady) {
            this._updateCustomIcons();
            this._invalidateIcon();
        }

        this.connect('destroy', () => {
            this._iconCache.destroy();
            this._cancellable.cancel();
        });
    }

    _updateIconClass() {
        this.add_style_class_name(
            `appindicator-icon-${this._indicator.id.toLowerCase().replace(/_|\s/g, '-')}`);
    }

    _cancelLoading() {
        if (this._loadingIcons.size > 0) {
            this._cancellable.cancel();
            this._cancellable = new Gio.Cancellable();
            this._loadingIcons.clear();
        }
    }

    // Will look the icon up in the cache, if it's found
    // it will return it. Otherwise, it will create it and cache it.
    async _cacheOrCreateIconByName(iconSize, iconName, themePath) {
        // eslint-disable-next-line no-undef
        let { scale_factor: scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
        let id = `${iconName}@${iconSize * scaleFactor}${themePath || ''}`;
        let gicon = this._iconCache.get(id);

        if (gicon)
            return gicon;

        if (this._loadingIcons.has(id)) {
            Util.Logger.debug(`${this._indicator.id}, Icon ${id} Is still loading, ignoring the request`);
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING,
                'Already in progress');
        } else {
            this._cancelLoading();
        }

        this._loadingIcons.add(id);
        let path = this._getIconInfo(iconName, themePath, iconSize, scaleFactor);
        gicon = await this._createIconByName(path);
        this._loadingIcons.delete(id);
        if (gicon)
            gicon = this._iconCache.add(id, gicon);
        return gicon;
    }

    async _createIconByPath(path, width, height) {
        let file = Gio.File.new_for_path(path);
        try {
            const inputStream = await file.read_async(GLib.PRIORITY_DEFAULT, this._cancellable);
            const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(inputStream,
                height, width, true, this._cancellable);
            this.icon_size = width > 0 ? width : this._iconSize;
            return pixbuf;
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`${this._indicator.id}, Impossible to read image from path '${path}': ${e}`);
            throw e;
        }
    }

    async _createIconByName(path) {
        if (!path) {
            if (this._createIconIdle) {
                throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING,
                    'Already in progress');
            }

            try {
                this._createIconIdle = new PromiseUtils.IdlePromise(GLib.PRIORITY_DEFAULT_IDLE,
                    this._cancellable);
                await this._createIconIdle;
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e);
                throw e;
            } finally {
                delete this._createIconIdle;
            }
            return null;
        } else if (this._createIconIdle) {
            this._createIconIdle.cancel();
            delete this._createIconIdle;
        }

        try {
            const [format, width, height] = await GdkPixbuf.Pixbuf.get_file_info_async(
                path, this._cancellable);

            if (!format) {
                Util.Logger.critical(`${this._indicator.id}, Invalid image format: ${path}`);
                return null;
            }

            if (width >= height * 1.5) {
                /* Hello indicator-multiload! */
                return this._createIconByPath(path, width, -1);
            } else {
                this.icon_size = this._iconSize;
                return new Gio.FileIcon({
                    file: Gio.File.new_for_path(path),
                });
            }
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`${this._indicator.id}, Impossible to read image info from path '${path}': ${e}`);
            throw e;
        }
    }

    _getIconInfo(name, themePath, size, scale) {
        let path = null;
        if (name && name[0] === '/') {
            // HACK: icon is a path name. This is not specified by the api but at least inidcator-sensors uses it.
            path = name;
        } else if (name) {
            // we manually look up the icon instead of letting st.icon do it for us
            // this allows us to sneak in an indicator provided search path and to avoid ugly upscaled icons

            // indicator-application looks up a special "panel" variant, we just replicate that here
            name += '-panel';

            // icon info as returned by the lookup
            let iconInfo = null;

            // we try to avoid messing with the default icon theme, so we'll create a new one if needed
            let iconTheme = null;
            const defaultTheme = Util.getDefaultTheme();
            if (themePath) {
                iconTheme = new Gtk.IconTheme();
                defaultTheme.get_search_path().forEach(p =>
                    iconTheme.append_search_path(p));
                iconTheme.append_search_path(themePath);

                if (!Meta.is_wayland_compositor()) {
                    const defaultScreen = imports.gi.Gdk.Screen.get_default();
                    if (defaultScreen)
                        iconTheme.set_screen(defaultScreen);
                }
            } else {
                iconTheme = defaultTheme;
            }
            if (iconTheme) {
                // try to look up the icon in the icon theme
                iconInfo = iconTheme.lookup_icon_for_scale(name, size, scale,
                    Gtk.IconLookupFlags.GENERIC_FALLBACK);
                // no icon? that's bad!
                if (iconInfo === null) {
                    let msg = `${this._indicator.id}, Impossible to lookup icon for '${name}' in`;
                    Util.Logger.warn(`${msg} ${themePath ? `path ${themePath}` : 'default theme'}`);
                } else { // we have an icon
                    // get the icon path
                    path = iconInfo.get_filename();
                }
            }
        }
        return path;
    }

    async argbToRgba(src, cancellable) {
        const CHUNK_SIZE = 1024;
        const ops = [];
        const dest = new Uint8Array(src.length);

        for (let i = 0; i < src.length;) {
            const chunkSize = Math.min(CHUNK_SIZE, src.length - i);

            ops.push(new PromiseUtils.CancellablePromise(async resolve => {
                const start = i;
                const end = i + chunkSize;
                await new PromiseUtils.IdlePromise(GLib.PRIORITY_LOW, cancellable);

                for (let j = start; j < end; j += 4) {
                    let srcAlpha = src[j];

                    dest[j] = src[j + 1]; /* red */
                    dest[j + 1] = src[j + 2]; /* green */
                    dest[j + 2] = src[j + 3]; /* blue */
                    dest[j + 3] = srcAlpha; /* alpha */
                }
                resolve();
            }, cancellable));

            i += chunkSize;
        }

        await Promise.all(ops);
        return dest;
    }

    async _createIconFromPixmap(iconSize, iconPixmapArray) {
        // eslint-disable-next-line no-undef
        const { scale_factor: scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
        iconSize *= scaleFactor;
        // the pixmap actually is an array of pixmaps with different sizes
        // we use the one that is smaller or equal the iconSize

        // maybe it's empty? that's bad.
        if (!iconPixmapArray || iconPixmapArray.length < 1)
            throw TypeError('Empty Icon found');

        const sortedIconPixmapArray = iconPixmapArray.sort((pixmapA, pixmapB) => {
            // we sort smallest to biggest
            const areaA = pixmapA[0] * pixmapA[1];
            const areaB = pixmapB[0] * pixmapB[1];

            return areaA - areaB;
        });

        const qualifiedIconPixmapArray = sortedIconPixmapArray.filter(pixmap =>
            // we prefer any pixmap that is equal or bigger than our requested size
            pixmap[0] >= iconSize && pixmap[1] >= iconSize);

        const iconPixmap = qualifiedIconPixmapArray.length > 0
            ? qualifiedIconPixmapArray[0] : sortedIconPixmapArray.pop();

        const [width, height, bytes] = iconPixmap;
        const rowStride = width * 4; // hopefully this is correct

        const id = `__PIXMAP_ICON_${width}x${height}`;
        if (this._loadingIcons.has(id)) {
            Util.Logger.debug(`${this._indicator.id}, Pixmap ${width}x${height} ` +
                'Is still loading, ignoring the request');
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING,
                'Already in progress');
        } else {
            this._cancelLoading();
        }

        this._loadingIcons.add(id);

        try {
            return GdkPixbuf.Pixbuf.new_from_bytes(
                await this.argbToRgba(bytes, this._cancellable),
                GdkPixbuf.Colorspace.RGB, true,
                8, width, height, rowStride);
        } catch (e) {
            // the image data was probably bogus. We don't really know why, but it _does_ happen.
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`${this._indicator.id}, Impossible to create image from data: ${e}`);
            throw e;
        } finally {
            this._loadingIcons.delete(id);
        }
    }

    // The .inUse flag will be set to true if the used gicon matches the cached
    // one (as in some cases it may be equal, but not the same object).
    // So when it's not need anymore we make sure to check the .inUse property
    // and set it to false so that it can be picked up by the garbage collector.
    _setGicon(iconType, gicon, iconSize) {
        if (iconType !== SNIconType.OVERLAY) {
            if (gicon) {
                this.gicon = new Gio.EmblemedIcon({ gicon });

                if (!(gicon instanceof GdkPixbuf.Pixbuf))
                    gicon.inUse = this.gicon.get_icon() === gicon;

                this.set_icon_size(iconSize);
            } else {
                this.gicon = null;
                Util.Logger.critical(`unable to update icon for ${this._indicator.id}`);
            }
        } else if (gicon) {
            this._emblem = new Gio.Emblem({ icon: gicon });

            if (!(gicon instanceof GdkPixbuf.Pixbuf))
                gicon.inUse = true;
        } else {
            this._emblem = null;
            Util.Logger.debug(`unable to update icon emblem for ${this._indicator.id}`);
        }

        if (this.gicon) {
            if (!this.gicon.get_emblems().some(e => e.equal(this._emblem))) {
                this.gicon.clear_emblems();
                if (this._emblem)
                    this.gicon.add_emblem(this._emblem);
            }
        }
    }

    async _updateIconByType(iconType, iconSize) {
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

        const [name, pixmap, theme] = icon;
        let gicon = null;
        const commonArgs = [theme, iconType, iconSize];

        if (this._customIcons.size) {
            let customIcon = this._customIcons.get(iconType);
            gicon = await this._createIcon(customIcon, null, ...commonArgs);

            if (!gicon) {
                customIcon = this._customIcons.get(SNIconType.NORMAL);
                gicon = await this._createIcon(customIcon, null, ...commonArgs);
            }
        } else {
            gicon = await this._createIcon(name, pixmap, ...commonArgs);
        }

        try {
            this._setGicon(iconType, gicon, iconSize);
        } catch (e) {
            logError(e, 'Setting GIcon failed');
        }
    }

    // updates the base icon
    async _createIcon(name, pixmap, theme, iconType, iconSize) {
        try {
            if (name) {
                const gicon = await this._cacheOrCreateIconByName(iconSize, name, theme);
                if (gicon)
                    return gicon;
            }

            if (pixmap && pixmap.length)
                return this._createIconFromPixmap(iconSize, pixmap, iconType);
        } catch (e) {
            /* We handle the error messages already */
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING))
                Util.Logger.debug(`${this._indicator.id}, Impossible to load icon: ${e}`);
        }

        return null;
    }

    // updates the base icon
    async _updateIcon() {
        if (this.gicon instanceof Gio.EmblemedIcon) {
            let { gicon } = this.gicon;

            if (gicon.inUse)
                gicon.inUse = false;
        }

        // we might need to use the AttentionIcon*, which have precedence over the normal icons
        let iconType = this._indicator.status === SNIStatus.NEEDS_ATTENTION
            ? SNIconType.ATTENTION : SNIconType.NORMAL;

        this._updateIconSize();

        try {
            await this._updateIconByType(iconType, this._iconSize);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING))
                logError(e, `${this._indicator.id}: Updating icon type ${iconType} failed`);
        }
    }

    async _updateOverlayIcon() {
        if (this._emblem) {
            let { icon } = this._emblem;

            if (icon.inUse)
                icon.inUse = false;
        }

        // KDE hardcodes the overlay icon size to 10px (normal icon size 16px)
        // we approximate that ratio for other sizes, too.
        // our algorithms will always pick a smaller one instead of stretching it.
        let iconSize = Math.floor(this._iconSize / 1.6);

        try {
            await this._updateIconByType(SNIconType.OVERLAY, iconSize);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING))
                logError(e, `${this._indicator.id}: Updating overlay icon failed`);
        }
    }

    // called when the icon theme changes
    _invalidateIcon() {
        this._iconCache.clear();
        this._cancelLoading();

        this._updateIcon();
        this._updateOverlayIcon();
    }

    _updateIconSize() {
        const settings = SettingsManager.getDefaultGSettings();
        const sizeValue = settings.get_int('icon-size');
        if (sizeValue > 0) {
            if (!this._defaultIconSize)
                this._defaultIconSize = this._iconSize;

            this._iconSize = sizeValue;
        } else if (this._defaultIconSize) {
            this._iconSize = this._defaultIconSize;
            delete this._defaultIconSize;
        }
    }

    _updateCustomIcons() {
        const settings = SettingsManager.getDefaultGSettings();
        this._customIcons.clear();

        settings.get_value('custom-icons').deep_unpack().forEach(customIcons => {
            const [indicatorId, normalIcon, attentionIcon] = customIcons;
            if (this._indicator.id === indicatorId) {
                this._customIcons.set(SNIconType.NORMAL, normalIcon);
                this._customIcons.set(SNIconType.ATTENTION, attentionIcon);
            }
        });
    }
});
