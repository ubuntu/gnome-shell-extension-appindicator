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

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Params from 'resource:///org/gnome/shell/misc/params.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import * as IconCache from './iconCache.js';
import * as Util from './util.js';
import * as Interfaces from './interfaces.js';
import * as PixmapsUtils from './pixmapsUtils.js';
import * as PromiseUtils from './promiseUtils.js';
import * as SettingsManager from './settingsManager.js';
import {DBusProxy} from './dbusProxy.js';

Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(GdkPixbuf.Pixbuf, 'get_file_info_async');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async',
    'new_from_stream_finish');
Gio._promisify(St.IconInfo.prototype, 'load_symbolic_async');
Gio._promisify(Gio.DBusConnection.prototype, 'call');

const MAX_UPDATE_FREQUENCY = 30; // In ms
const FALLBACK_ICON_NAME = 'image-loading-symbolic';
const PIXMAPS_FORMAT = imports.gi.Cogl.PixelFormat.ARGB_8888;
const GNOME_48_PLUS = Number(Config.PACKAGE_VERSION.split(".")[0]) >= 48;

export const SNICategory = Object.freeze({
    APPLICATION: 'ApplicationStatus',
    COMMUNICATIONS: 'Communications',
    SYSTEM: 'SystemServices',
    HARDWARE: 'Hardware',
});

export const SNIStatus = Object.freeze({
    PASSIVE: 'Passive',
    ACTIVE: 'Active',
    NEEDS_ATTENTION: 'NeedsAttention',
});

const SNIconType = Object.freeze({
    NORMAL: 0,
    ATTENTION: 1,
    OVERLAY: 2,

    toPropertyName: (iconType, params = {isPixbuf: false}) => {
        let propertyName = 'Icon';

        if (iconType === SNIconType.OVERLAY)
            propertyName = 'OverlayIcon';
        else if (iconType === SNIconType.ATTENTION)
            propertyName = 'AttentionIcon';

        return `${propertyName}${params.isPixbuf ? 'Pixmap' : 'Name'}`;
    },
});

export const AppIndicatorProxy = GObject.registerClass(
class AppIndicatorProxy extends DBusProxy {
    static get interfaceInfo() {
        if (!this._interfaceInfo) {
            this._interfaceInfo = Gio.DBusInterfaceInfo.new_for_xml(
                Interfaces.StatusNotifierItem);
        }
        return this._interfaceInfo;
    }

    static get OPTIONAL_PROPERTIES() {
        return [
            'XAyatanaLabel',
            'XAyatanaLabelGuide',
            'XAyatanaOrderingIndex',
            'IconAccessibleDesc',
            'AttentionAccessibleDesc',
        ];
    }

    static get TUPLE_TYPE() {
        if (!this._tupleType)
            this._tupleType = new GLib.VariantType('()');

        return this._tupleType;
    }

    static destroy() {
        delete this._interfaceInfo;
        delete this._tupleType;
    }

    _init(busName, objectPath) {
        const {interfaceInfo} = AppIndicatorProxy;

        super._init(busName, objectPath, interfaceInfo,
            Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES);

        this.set_cached_property('Status',
            new GLib.Variant('s', SNIStatus.PASSIVE));


        this._accumulatedProperties = new Set();
        this._cancellables = new Map();
        this._changedProperties = Object.create(null);
    }

    async initAsync(cancellable) {
        await super.initAsync(cancellable);

        this._setupProxyPropertyList();
    }

    destroy() {
        const cachedProperties = this.get_cached_property_names();
        if (cachedProperties) {
            cachedProperties.forEach(propertyName =>
                this.set_cached_property(propertyName, null));
        }

        super.destroy();
    }

    _onNameOwnerChanged() {
        this._resetNeededProperties();

        if (!this.gNameOwner)
            this._cancelRefreshProperties();
        else
            this._setupProxyPropertyList();
    }

    _setupProxyPropertyList() {
        this._propertiesList =
            (this.get_cached_property_names() || []).filter(p =>
                this.gInterfaceInfo.properties.some(pInfo => pInfo.name === p));

        if (this._propertiesList.length) {
            AppIndicatorProxy.OPTIONAL_PROPERTIES.forEach(
                p => this._addExtraProperty(p));
        }
    }

    _addExtraProperty(name) {
        if (this._propertiesList.includes(name))
            return;

        if (!(name in this)) {
            Object.defineProperty(this, name, {
                configurable: false,
                enumerable: true,
                get: () => {
                    const v = this.get_cached_property(name);
                    return v ? v.deep_unpack() : null;
                },
            });
        }

        this._propertiesList.push(name);
    }

    _signalToPropertyName(signal) {
        if (signal.startsWith('New'))
            return signal.substr(3);
        else if (signal.startsWith('XAyatanaNew'))
            return `XAyatana${signal.substr(11)}`;

        return null;
    }

    // The Author of the spec didn't like the PropertiesChanged signal, so he invented his own
    async _refreshOwnProperties(prop) {
        await Promise.all(
            [prop, `${prop}Name`, `${prop}Pixmap`, `${prop}AccessibleDesc`].filter(p =>
                this._propertiesList.includes(p)).map(async p => {
                try {
                    await this.refreshProperty(p, {
                        skipEqualityCheck: p.endsWith('Pixmap'),
                    });
                } catch (e) {
                    if (!AppIndicatorProxy.OPTIONAL_PROPERTIES.includes(p) ||
                        !(e instanceof Gio.DBusError))
                        logError(e);
                }
            }));
    }

    _onSignal(sender, signal, ...args) {
        this._onSignalAsync(sender, signal, ...args).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, `Error while processing signal '${signal}'`);
        });
    }

    async _onSignalAsync(_sender, signal, params) {
        const property = this._signalToPropertyName(signal);
        if (!property)
            return;

        if (this.status === SNIStatus.PASSIVE &&
            ![...AppIndicator.NEEDED_PROPERTIES, 'Status'].includes(property)) {
            this._accumulatedProperties.add(property);
            return;
        }

        if (!params.get_type().equal(AppIndicatorProxy.TUPLE_TYPE)) {
            // If the property includes arguments, we can just queue the signal emission
            const [value] = params.unpack();
            try {
                await this._queuePropertyUpdate(property, value);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    throw e;
            }

            if (!this._accumulatedProperties.size)
                return;
        } else {
            this._accumulatedProperties.add(property);
        }

        if (this._signalsAccumulator)
            return;

        this._signalsAccumulator = new PromiseUtils.TimeoutPromise(
            MAX_UPDATE_FREQUENCY, GLib.PRIORITY_DEFAULT_IDLE, this._cancellable);
        try {
            await this._signalsAccumulator;
            const refreshPropertiesPromises =
                [...this._accumulatedProperties].map(p =>
                    this._refreshOwnProperties(p));
            this._accumulatedProperties.clear();
            await Promise.all(refreshPropertiesPromises);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
        } finally {
            delete this._signalsAccumulator;
        }
    }

    _resetNeededProperties() {
        AppIndicator.NEEDED_PROPERTIES.forEach(p =>
            this.set_cached_property(p, null));
    }

    async refreshAllProperties() {
        const cancellableName = 'org.freedesktop.DBus.Properties.GetAll';
        const cancellable = this._cancelRefreshProperties({
            propertyName: cancellableName,
            addNew: true,
        });

        try {
            const [valuesVariant] = (await this.getProperties(
                cancellable)).deep_unpack();

            this._cancellables.delete(cancellableName);

            await Promise.all(
                Object.entries(valuesVariant).map(([propertyName, valueVariant]) =>
                    this._queuePropertyUpdate(propertyName, valueVariant, {
                        skipEqualityCheck: true,
                        cancellable,
                    })));
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                // the property may not even exist, silently ignore it
                Util.Logger.debug(`While refreshing all properties: ${e}`);

                this.get_cached_property_names().forEach(propertyName =>
                    this.set_cached_property(propertyName, null));

                this._cancellables.delete(cancellableName);
                throw e;
            }
        }
    }

    async refreshProperty(propertyName, params) {
        params = Params.parse(params, {
            skipEqualityCheck: false,
        });

        const cancellable = this._cancelRefreshProperties({
            propertyName,
            addNew: true,
        });

        try {
            const [valueVariant] = (await this.getProperty(
                propertyName, cancellable)).deep_unpack();

            this._cancellables.delete(propertyName);
            await this._queuePropertyUpdate(propertyName, valueVariant,
                Object.assign(params, {cancellable}));
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                // the property may not even exist, silently ignore it
                Util.Logger.debug(`Error when calling 'Get(${propertyName})' ` +
                    `in ${this.gName}, ${this.gObjectPath}, ` +
                    `org.freedesktop.DBus.Properties, ${this.gInterfaceName} ` +
                    `while refreshing property ${propertyName}: ${e}\n` +
                    `${e.stack}`);
                this.set_cached_property(propertyName, null);
                this._cancellables.delete(propertyName);
                delete this._changedProperties[propertyName];
                throw e;
            }
        }
    }

    async _queuePropertyUpdate(propertyName, value, params) {
        params = Params.parse(params, {
            skipEqualityCheck: false,
            cancellable: null,
        });

        if (!params.skipEqualityCheck) {
            const cachedProperty = this.get_cached_property(propertyName);

            if (value && cachedProperty &&
                value.equal(this.get_cached_property(propertyName)))
                return;
        }

        this.set_cached_property(propertyName, value);

        // synthesize a batched property changed event
        this._changedProperties[propertyName] = value;

        if (!this._propertiesEmitTimeout || !this._propertiesEmitTimeout.pending()) {
            if (!params.cancellable) {
                params.cancellable = this._cancelRefreshProperties({
                    propertyName,
                    addNew: true,
                });
            }
            this._propertiesEmitTimeout = new PromiseUtils.TimeoutPromise(
                MAX_UPDATE_FREQUENCY * 2, GLib.PRIORITY_DEFAULT_IDLE, params.cancellable);
            await this._propertiesEmitTimeout;

            if (Object.keys(this._changedProperties).length) {
                this.emit('g-properties-changed', GLib.Variant.new('a{sv}',
                    this._changedProperties), []);
                this._changedProperties = Object.create(null);
            }
        }
    }

    _cancelRefreshProperties(params) {
        params = Params.parse(params, {
            propertyName: undefined,
            addNew: false,
        });

        if (!this._cancellables.size && !params.addNew)
            return null;

        if (params.propertyName !== undefined) {
            let cancellable = this._cancellables.get(params.propertyName);
            if (cancellable) {
                cancellable.cancel();

                if (!params.addNew)
                    this._cancellables.delete(params.propertyName);
            }

            if (params.addNew) {
                cancellable = new Util.CancellableChild(this._cancellable);
                this._cancellables.set(params.propertyName, cancellable);
                return cancellable;
            }
        } else {
            this._cancellables.forEach(c => c.cancel());
            this._cancellables.clear();
            this._changedProperties = Object.create(null);
        }

        return null;
    }
});

/**
 * the AppIndicator class serves as a generic container for indicator information and functions common
 * for every displaying implementation (IndicatorMessageSource and IndicatorStatusIcon)
 */
export class AppIndicator extends Signals.EventEmitter {
    static get NEEDED_PROPERTIES() {
        return ['Id', 'Menu'];
    }

    constructor(service, busName, object) {
        super();

        this.isReady = false;
        this.busName = busName;
        this._uniqueId = Util.indicatorId(service, busName, object);

        this._cancellable = new Gio.Cancellable();
        this._proxy = new AppIndicatorProxy(busName, object);
        this._invalidatedPixmapsIcons = new Set();

        this._setupProxy().catch(logError);
        Util.connectSmart(this._proxy, 'g-properties-changed', this, this._onPropertiesChanged);
        Util.connectSmart(this._proxy, 'notify::g-name-owner', this, this._nameOwnerChanged);

        if (this.uniqueId === service) {
            this._nameWatcher = new Util.NameWatcher(service);
            Util.connectSmart(this._nameWatcher, 'changed', this, this._nameOwnerChanged);
        }
    }

    async _setupProxy() {
        const cancellable = this._cancellable;

        try {
            await this._proxy.initAsync(cancellable);
            this._checkIfReady();
            await this._checkNeededProperties();
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                logError(e, `While initalizing proxy for ${this._uniqueId}`);
                this.destroy();
            }
        }

        // We try to lookup the activate method to see if the app supports it
        try {
            const introspectionVariant = await this._proxy.gConnection.call(
                this._proxy.gNameOwner, this._proxy.gObjectPath,
                'org.freedesktop.DBus.Introspectable', 'Introspect', null, null,
                Gio.DBusCallFlags.NONE, -1, cancellable);
            const [introspectionXml] = introspectionVariant.deep_unpack();
            const nodeInfo = Gio.DBusNodeInfo.new_for_xml(introspectionXml);
            const interfaceInfo = nodeInfo.lookup_interface(this._proxy.gInterfaceName);
            this.supportsActivation = !!interfaceInfo.lookup_method('Activate');
            this._hasAyatanaSecondaryActivate =
                !!interfaceInfo.lookup_method('XAyatanaSecondaryActivate');
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                Util.Logger.debug(
                    `${this.uniqueId}, check for Activation support: ${e.message}`);
            }
        }

        try {
            this._commandLine = await Util.getProcessName(this.busName,
                cancellable, GLib.PRIORITY_LOW);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                Util.Logger.debug(
                    `${this.uniqueId}, failed getting command line: ${e.message}`);
            }
        }
    }

    _checkIfReady() {
        const wasReady = this.isReady;
        let isReady = false;

        if (this.hasNameOwner && this.id && this.menuPath)
            isReady = true;

        this.isReady = isReady;

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

        const MAX_RETRIES = 3;
        const cancellable = this._cancellable;
        for (let checks = 0; checks < MAX_RETRIES; ++checks) {
            this._delayCheck = new PromiseUtils.TimeoutSecondsPromise(1,
                GLib.PRIORITY_DEFAULT_IDLE, cancellable);
            // eslint-disable-next-line no-await-in-loop
            await this._delayCheck;

            try {
                // eslint-disable-next-line no-await-in-loop
                await Promise.all(AppIndicator.NEEDED_PROPERTIES.map(p =>
                    this._proxy.refreshProperty(p)));
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    throw e;

                if (checks < MAX_RETRIES - 1)
                    continue;

                throw e;
            }

            if (this.id && this.menuPath)
                break;
        }

        return this.id && this.menuPath;
    }

    async _nameOwnerChanged() {
        if (!this.hasNameOwner) {
            this._checkIfReady();
        } else {
            try {
                await this._checkNeededProperties();
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    Util.Logger.warn(`${this.uniqueId}, Impossible to get basic properties: ${e}`);
                    this.checkAlive();
                }
            }
        }

        this.emit('name-owner-changed');
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
        return this._proxy.XAyatanaLabel || null;
    }

    get accessibleName() {
        const accessibleDesc = this.status === SNIStatus.NEEDS_ATTENTION
            ? this._proxy.AccessibleDesc : this._proxy.IconAccessibleDesc;

        return accessibleDesc || this.title;
    }

    get menuPath() {
        if (this._proxy.Menu === '/NO_DBUSMENU')
            return null;

        return this._proxy.Menu;
    }

    get attentionIcon() {
        return {
            theme: this._proxy.IconThemePath,
            name: this._proxy.AttentionIconName,
            pixmap: this._getPixmapProperty(SNIconType.ATTENTION),
        };
    }

    get icon() {
        return {
            theme: this._proxy.IconThemePath,
            name: this._proxy.IconName,
            pixmap: this._getPixmapProperty(SNIconType.NORMAL),
        };
    }

    get overlayIcon() {
        return {
            theme: this._proxy.IconThemePath,
            name: this._proxy.OverlayIconName,
            pixmap: this._getPixmapProperty(SNIconType.OVERLAY),
        };
    }

    get hasOverlayIcon() {
        const {name, pixmap} = this.overlayIcon;

        return name || (pixmap && pixmap.n_children());
    }

    get hasNameOwner() {
        if (this._nameWatcher && !this._nameWatcher.nameOnBus)
            return false;
        return !!this._proxy.g_name_owner;
    }

    get cancellable() {
        return this._cancellable;
    }

    async checkAlive() {
        // Some applications (hey electron!) just remove the indicator object
        // from bus after hiding it, without closing its bus name, so we are
        // not able to understand whe they're gone.
        // Thus we just kill it when an expected well-known method is failing.
        if (this.status !== SNIStatus.PASSIVE && this._checkIfReady()) {
            if (this._checkAliveTimeout) {
                this._checkAliveTimeout.cancel();
                delete this._checkAliveTimeout;
            }
            return;
        }

        if (this._checkAliveTimeout)
            return;

        try {
            const cancellable = this._cancellable;
            this._checkAliveTimeout = new PromiseUtils.TimeoutSecondsPromise(10,
                GLib.PRIORITY_DEFAULT_IDLE, cancellable);
            Util.Logger.debug(`${this.uniqueId}: may not respond, checking...`);
            await this._checkAliveTimeout;

            // We should call the Ping method instead but in some containers
            // such as snaps that's not accessible, so let's just use our own
            await this._proxy.getProperty('Status', cancellable);
        } catch (e) {
            if (e.matches(Gio.DBusError, Gio.DBusError.NAME_HAS_NO_OWNER) ||
                e.matches(Gio.DBusError, Gio.DBusError.SERVICE_UNKNOWN) ||
                e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_OBJECT) ||
                e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_INTERFACE) ||
                e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD) ||
                e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_PROPERTY)) {
                Util.Logger.warn(`${this.uniqueId}: not on bus anymore, removing it`);
                this.destroy();
                return;
            }

            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        } finally {
            delete this._checkAliveTimeout;
        }
    }

    _onPropertiesChanged(_proxy, changed, _invalidated) {
        const props = Object.keys(changed.unpack());
        const signalsToEmit = new Set();
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
                signalsToEmit.add('overlay-icon');
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
        this._proxy.destroy();
        this._cancellable.cancel();
        this._invalidatedPixmapsIcons.clear();

        if (this._nameWatcher)
            this._nameWatcher.destroy();
        delete this._cancellable;
        delete this._proxy;
        delete this._nameWatcher;
    }

    _getPixmapProperty(iconType) {
        const propertyName = SNIconType.toPropertyName(iconType,
            {isPixbuf: true});
        const pixmap = this._proxy.get_cached_property(propertyName);
        const wasInvalidated = this._invalidatedPixmapsIcons.delete(iconType);

        if (!pixmap && wasInvalidated) {
            this._proxy.refreshProperty(propertyName, {
                skipEqualityCheck: true,
            }).catch(e => {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e);
            });
        }

        return pixmap;
    }

    invalidatePixmapProperty(iconType) {
        this._invalidatedPixmapsIcons.add(iconType);
        this._proxy.set_cached_property(
            SNIconType.toPropertyName(iconType, {isPixbuf: true}), null);
    }

    _getActivationToken(timestamp) {
        const launchContext = global.create_app_launch_context(timestamp, -1);
        const fakeAppInfo = Gio.AppInfo.create_from_commandline(
            this._commandLine || 'true', this.id,
            Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION);
        return [launchContext, launchContext.get_startup_notify_id(fakeAppInfo, [])];
    }

    async provideActivationToken(timestamp) {
        if (this._hasProvideXdgActivationToken === false)
            return;

        const [launchContext, activationToken] = this._getActivationToken(timestamp);
        try {
            await this._proxy.ProvideXdgActivationTokenAsync(activationToken,
                this._cancellable);
            this._hasProvideXdgActivationToken = true;
        } catch (e) {
            launchContext.launch_failed(activationToken);

            if (e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD))
                this._hasProvideXdgActivationToken = false;
            else
                Util.Logger.warn(`${this.id}, failed to provide activation token: ${e.message}`);
        }
    }

    async open(x, y, timestamp) {
        const cancellable = this._cancellable;
        // we can't use WindowID because we're not able to get the x11 window id from a MetaWindow
        // nor can we call any X11 functions. Luckily, the Activate method usually works fine.
        // parameters are "an hint to the item where to show eventual windows" [sic]
        // ... and don't seem to have any effect.

        try {
            await this.provideActivationToken(timestamp);
            await this._proxy.ActivateAsync(x, y, cancellable);
            this.supportsActivation = true;
        } catch (e) {
            if (e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD)) {
                this.supportsActivation = false;
                Util.Logger.warn(`${this.id}, does not support activation: ${e.message}`);
                return;
            }

            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.critical(`${this.id}, failed to activate: ${e.message}`);
        }
    }

    async secondaryActivate(timestamp, x, y) {
        const cancellable = this._cancellable;

        try {
            await this.provideActivationToken(timestamp);

            if (this._hasAyatanaSecondaryActivate !== false) {
                try {
                    await this._proxy.XAyatanaSecondaryActivateAsync(timestamp, cancellable);
                    this._hasAyatanaSecondaryActivate = true;
                } catch (e) {
                    if (e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD))
                        this._hasAyatanaSecondaryActivate = false;
                    else
                        throw e;
                }
            }

            if (!this._hasAyatanaSecondaryActivate)
                await this._proxy.SecondaryActivateAsync(x, y, cancellable);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.critical(`${this.id}, failed to secondary activate: ${e.message}`);
        }
    }

    async scroll(dx, dy) {
        const cancellable = this._cancellable;

        try {
            const actions = [];

            if (dx !== 0) {
                actions.push(this._proxy.ScrollAsync(Math.floor(dx),
                    'horizontal', cancellable));
            }

            if (dy !== 0) {
                actions.push(this._proxy.ScrollAsync(Math.floor(dy),
                    'vertical', cancellable));
            }

            await Promise.all(actions);
        } catch (e) {
            Util.Logger.critical(`${this.id}, failed to scroll: ${e.message}`);
        }
    }
}

const StTextureCacheSkippingFileIcon = GObject.registerClass({
    Implements: [Gio.Icon],
}, class StTextureCacheSkippingFileIconImpl extends Gio.EmblemedIcon {
    _init(params) {
        // FIXME: We can't just inherit from Gio.FileIcon for some reason
        super._init({gicon: new Gio.FileIcon(params)});
    }

    vfunc_to_tokens() {
        // Disables the to_tokens() vfunc so that the icon to_string()
        // method won't work and thus can't be kept forever around by
        // StTextureCache, see the awesome debugging session in this thread:
        //   https://twitter.com/mild_sunrise/status/1458739604098621443
        // upstream bug is at:
        //   https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/4944
        return [false, [], 0];
    }
});

export const IconActor = GObject.registerClass(
class AppIndicatorsIconActor extends St.Icon {
    static get DEFAULT_STYLE() {
        return 'padding: 0';
    }

    static get USER_WRITABLE_PATHS() {
        if (!this._userWritablePaths) {
            this._userWritablePaths = [
                GLib.get_user_cache_dir(),
                GLib.get_user_data_dir(),
                GLib.get_user_config_dir(),
                GLib.get_user_runtime_dir(),
                GLib.get_home_dir(),
                GLib.get_tmp_dir(),
            ];

            this._userWritablePaths.push(Object.values(GLib.UserDirectory).slice(
                0, -1).map(dirId => GLib.get_user_special_dir(dirId)));
        }

        return this._userWritablePaths;
    }

    _init(indicator, iconSize) {
        super._init({
            reactive: true,
            style_class: 'system-status-icon',
            fallbackIconName: FALLBACK_ICON_NAME,
        });

        this.name = this.constructor.name;
        this.add_style_class_name('appindicator-icon');
        this.add_style_class_name('status-notifier-icon');
        this.set_style(AppIndicatorsIconActor.DEFAULT_STYLE);

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this.height = iconSize * themeContext.scale_factor;

        this._indicator     = indicator;
        this._customIcons   = new Map();
        this._iconSize      = iconSize;
        this._iconCache     = new IconCache.IconCache();
        this._cancellable   = new Gio.Cancellable();
        this._loadingIcons  = Object.create(null);

        Object.values(SNIconType).forEach(t => (this._loadingIcons[t] = new Map()));

        Util.connectSmart(this._indicator, 'icon', this, () => {
            if (this.is_mapped())
                this._updateIcon();
        });
        Util.connectSmart(this._indicator, 'overlay-icon', this, () => {
            if (this.is_mapped())
                this._updateIcon();
        });
        Util.connectSmart(this._indicator, 'reset', this,
            () => this._invalidateIconWhenFullyReady());

        const settings = SettingsManager.getDefaultGSettings();
        Util.connectSmart(settings, 'changed::icon-size', this, () =>
            this._updateWhenFullyReady());
        Util.connectSmart(settings, 'changed::custom-icons', this, () => {
            this._updateCustomIcons();
            this._invalidateIconWhenFullyReady();
        });

        if (GObject.signal_lookup('resource-scale-changed', this))
            this.connect('resource-scale-changed', () => this._invalidateIcon());
        else
            this.connect('notify::resource-scale', () => this._invalidateIcon());

        Util.connectSmart(themeContext, 'notify::scale-factor', this, tc => {
            this._updateIconSize();
            this.height = this._iconSize * tc.scale_factor;
            this.width = -1;
            this._invalidateIcon();
        });

        Util.connectSmart(Util.getDefaultTheme(), 'changed', this,
            () => this._invalidateIconWhenFullyReady());

        this.connect('notify::mapped', () => {
            if (!this.is_mapped())
                this._updateWhenFullyReady();
        });

        this._updateWhenFullyReady();

        this.connect('destroy', () => {
            this._iconCache.destroy();
            this._cancellable.cancel();
            this._cancellable = null;
            this._indicator = null;
            this._loadingIcons = null;
            this._iconTheme = null;
        });
    }

    get debugId() {
        return this._indicator ? this._indicator.id : this.toString();
    }

    async _waitForFullyReady() {
        const waitConditions = [];

        if (!this.is_mapped()) {
            waitConditions.push(new PromiseUtils.SignalConnectionPromise(
                this, 'notify::mapped', this._cancellable));
        }

        if (!this._indicator.isReady) {
            waitConditions.push(new PromiseUtils.SignalConnectionPromise(
                this._indicator, 'ready', this._cancellable));
        }

        if (!waitConditions.length)
            return true;

        await Promise.all(waitConditions);
        return this._waitForFullyReady();
    }

    async _updateWhenFullyReady() {
        if (this._waitingReady)
            return;

        try {
            this._waitingReady = true;
            await this._waitForFullyReady();

            this._updateIconSize();
            this._updateIconClass();
            this._updateCustomIcons();
            this._invalidateIcon();
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        } finally {
            delete this._waitingReady;
        }
    }

    _updateIconClass() {
        if (!this._indicator)
            return;

        this.add_style_class_name(
            `appindicator-icon-${this._indicator.id.toLowerCase().replace(/_|\s/g, '-')}`);
    }

    _cancelLoadingByType(iconType) {
        this._loadingIcons[iconType].forEach(c => c.cancel());
        this._loadingIcons[iconType].clear();
    }

    _ensureNoIconIsLoading(iconType, id) {
        if (this._loadingIcons[iconType].has(id)) {
            Util.Logger.debug(`${this.debugId}, Icon ${id} Is still loading, ignoring the request`);
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING,
                'Already in progress');
        } else if (this._loadingIcons[iconType].size > 0) {
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS,
                'Another icon is already loading');
        }
    }

    _getIconLoadingCancellable(iconType, loadingId) {
        try {
            this._ensureNoIconIsLoading(iconType, loadingId);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
            this._cancelLoadingByType(iconType);
        }

        const cancellable = new Util.CancellableChild(this._cancellable);
        this._loadingIcons[iconType].set(loadingId, cancellable);

        return cancellable;
    }

    _cleanupIconLoadingCancellable(iconType, loadingId) {
        if (this._loadingIcons)
            this._loadingIcons[iconType].delete(loadingId);
    }

    _getResourceScale() {
        // Remove this when we remove support for versions earlier than 3.38
        const resourceScale = this.get_resource_scale();
        if (Array.isArray(resourceScale))
            return resourceScale[0] ? resourceScale[1] : 1.0;

        return resourceScale;
    }

    // Will look the icon up in the cache, if it's found
    // it will return it. Otherwise, it will create it and cache it.
    async _cacheOrCreateIconByName(iconType, iconSize, iconScaling, iconName, themePath) {
        const id = `${iconType}:${iconName}@${iconSize * iconScaling}:${themePath || ''}`;
        let gicon = this._iconCache.get(id);

        if (gicon)
            return gicon;

        const iconData = this._getIconData(iconName, themePath, iconSize, iconScaling);
        const loadingId = iconData.file ? iconData.file.get_path() : id;

        const cancellable = await this._getIconLoadingCancellable(iconType, id);
        try {
            gicon = await this._createIconByIconData(iconData, iconSize,
                iconScaling, cancellable);
        } finally {
            this._cleanupIconLoadingCancellable(iconType, loadingId);
        }
        if (gicon)
            gicon = this._iconCache.add(id, gicon);
        return gicon;
    }

    _getIconLookupFlags(themeNode) {
        let lookupFlags = 0;

        if (!themeNode)
            return lookupFlags;

        const lookupFlagsEnum = St.IconLookupFlags;
        const iconStyle = themeNode.get_icon_style();
        if (iconStyle === St.IconStyle.REGULAR)
            lookupFlags |= lookupFlagsEnum.FORCE_REGULAR;
        else if (iconStyle === St.IconStyle.SYMBOLIC)
            lookupFlags |= lookupFlagsEnum.FORCE_SYMBOLIC;

        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL)
            lookupFlags |= lookupFlagsEnum.DIR_RTL;
        else
            lookupFlags |= lookupFlagsEnum.DIR_LTR;

        return lookupFlags;
    }

    async _createIconByIconData(iconData, iconSize, iconScaling, cancellable) {
        const {file, name} = iconData;

        if (!file && !name) {
            if (this._createIconIdle) {
                throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING,
                    'Already in progress');
            }

            try {
                this._createIconIdle = new PromiseUtils.IdlePromise(GLib.PRIORITY_DEFAULT_IDLE,
                    cancellable);
                await this._createIconIdle;
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e);
                throw e;
            } finally {
                delete this._createIconIdle;
            }
            return this.gicon;
        } else if (this._createIconIdle) {
            this._createIconIdle.cancel();
            delete this._createIconIdle;
        }

        if (name)
            return new Gio.ThemedIcon({name});

        if (!file)
            throw new Error('Neither file or name are set');

        if (!this._isFileInWritableArea(file))
            return new Gio.FileIcon({file});

        try {
            const [format, width, height] = await GdkPixbuf.Pixbuf.get_file_info_async(
                file.get_path(), cancellable);

            if (!format) {
                Util.Logger.critical(`${this.debugId}, Invalid image format: ${file.get_path()}`);
                return null;
            }

            if (width >= height * 1.5) {
                /* Hello indicator-multiload! */
                await this._loadCustomImage(file,
                    width, height, iconSize, iconScaling, cancellable);
                return null;
            } else {
                /* We'll wrap the icon so that it won't be cached forever by the shell */
                return new StTextureCacheSkippingFileIcon({file});
            }
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                Util.Logger.warn(
                    `${this.debugId}, Impossible to read image info from ` +
                    `path '${file ? file.get_path() : null}' or name '${name}': ${e}`);
            }
            throw e;
        }
    }

    async _loadCustomImage(file, width, height, iconSize, iconScaling, cancellable) {
        const textureCache = St.TextureCache.get_default();
        const customImage = textureCache.load_file_async(file, -1,
            height, 1, iconScaling);

        const setCustomImageActor = imageActor => {
            const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
            const {content} = imageActor;
            imageActor.content = null;
            imageActor.destroy();

            this._setImageContent(content,
                width * scaleFactor, height * scaleFactor);
        };

        if (customImage.content) {
            setCustomImageActor(customImage);
            return;
        }

        const imageContentPromise = new PromiseUtils.SignalConnectionPromise(
            customImage, 'notify::content', cancellable);
        const waitPromise = new PromiseUtils.TimeoutSecondsPromise(
            1, GLib.PRIORITY_DEFAULT, cancellable);

        const racingPromises = [imageContentPromise, waitPromise];

        try {
            await Promise.race(racingPromises);
            if (!waitPromise.resolved())
                setCustomImageActor(customImage);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
        } finally {
            racingPromises.forEach(p => p.cancel());
        }
    }

    _isFileInWritableArea(file) {
        // No need to use IO here, we can just do some assumptions
        // print('Writable paths', IconActor.USER_WRITABLE_PATHS)
        const path = file.get_path();
        return IconActor.USER_WRITABLE_PATHS.some(writablePath =>
            path.startsWith(writablePath));
    }

    _createIconTheme(searchPath = []) {
        const iconTheme = new St.IconTheme();
        iconTheme.set_search_path(searchPath);

        return iconTheme;
    }

    _getIconData(name, themePath, size, scale) {
        const emptyIconData = {iconInfo: null, file: null, name: null};

        if (!name) {
            delete this._iconTheme;
            return emptyIconData;
        }

        // HACK: icon is a path name. This is not specified by the API,
        // but at least indicator-sensors uses it.
        if (name[0] === '/') {
            delete this._iconTheme;

            const file = Gio.File.new_for_path(name);
            return {file, iconInfo: null, name: null};
        }

        if (name.includes('.')) {
            const splits = name.split('.');

            if (['svg', 'png'].includes(splits[splits.length - 1]))
                name = splits.slice(0, -1).join('');
        }

        if (themePath && Util.getDefaultTheme().get_search_path().includes(themePath))
            themePath = null;

        if (themePath) {
            // If a theme path is provided, we need to lookup the icon ourself
            // as St won't be able to do it unless we mess with default theme
            // that is something we prefer not to do, as it would imply lots of
            // St.TextureCache cleanups.

            const newSearchPath = [themePath];
            if (!this._iconTheme) {
                this._iconTheme = this._createIconTheme(newSearchPath);
            } else {
                const currentSearchPath = this._iconTheme.get_search_path();

                if (!currentSearchPath.includes(newSearchPath))
                    this._iconTheme.set_search_path(newSearchPath);
            }

            // try to look up the icon in the icon theme
            const iconInfo = this._iconTheme.lookup_icon_for_scale(`${name}`,
                size, scale, this._getIconLookupFlags(this.get_theme_node()) |
                St.IconLookupFlags.GENERIC_FALLBACK);

            if (iconInfo) {
                return {
                    iconInfo,
                    file: Gio.File.new_for_path(iconInfo.get_filename()),
                    name: null,
                };
            }

            const logger = this.gicon ? Util.Logger.debug : Util.Logger.warn;
            logger(`${this.debugId}, Impossible to lookup icon ` +
                `for '${name}' in ${themePath}`);

            return emptyIconData;
        }

        delete this._iconTheme;
        return {name, iconInfo: null, file: null};
    }

    _setImageContent(content, width, height) {
        this.set({
            content,
            width,
            height,
            contentGravity: Clutter.ContentGravity.RESIZE_ASPECT,
            fallbackIconName: null,
        });
    }

    async _createIconFromPixmap(iconType, iconSize, iconScaling, scaleFactor, pixmapsVariant) {
        const {pixmapVariant, width, height, rowStride} =
            PixmapsUtils.getBestPixmap(pixmapsVariant, iconSize * iconScaling);

        const id = `__PIXMAP_ICON_${width}x${height}`;

        const imageContent = new St.ImageContent({
            preferredWidth: width,
            preferredHeight: height,
        });

        const setBytesArgs = [pixmapVariant.get_data_as_bytes(), PIXMAPS_FORMAT, width, height, rowStride];
        if (GNOME_48_PLUS) {
            setBytesArgs.unshift(global.stage.context.get_backend().get_cogl_context());
        }
        imageContent.set_bytes(...setBytesArgs);

        if (iconType !== SNIconType.OVERLAY && !this._indicator.hasOverlayIcon) {
            const scaledSize = iconSize * scaleFactor;
            this._setImageContent(imageContent, scaledSize, scaledSize);
            return null;
        }

        const cancellable = this._getIconLoadingCancellable(iconType, id);
        try {
            // FIXME: async API results in a gray icon for some reason
            const [inputStream] = imageContent.load(iconSize, cancellable);
            return await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                inputStream, -1, iconSize * iconScaling, true, cancellable);
        } catch (e) {
            // the image data was probably bogus. We don't really know why, but it _does_ happen.
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`${this.debugId}, Impossible to create image from data: ${e}`);
            throw e;
        } finally {
            this._cleanupIconLoadingCancellable(iconType, id);
        }
    }

    // The icon cache Active flag will be set to true if the used gicon matches
    // the cached one (as in some cases it may be equal, but not the same object).
    // So when it's not need anymore we make sure to check the active state
    // and set it to false so that it can be picked up by the garbage collector.
    _setGicon(iconType, gicon) {
        if (iconType !== SNIconType.OVERLAY) {
            if (gicon) {
                if (this.gicon === gicon ||
                    (this.gicon && this.gicon.get_icon() === gicon))
                    return;

                if (gicon instanceof Gio.EmblemedIcon)
                    this.gicon = gicon;
                else
                    this.gicon = new Gio.EmblemedIcon({gicon});

                this._iconCache.updateActive(SNIconType.NORMAL, gicon,
                    this.gicon.get_icon() === gicon);
            } else {
                this.gicon = null;
            }
        } else if (gicon) {
            this._emblem = new Gio.Emblem({icon: gicon});
            this._iconCache.updateActive(iconType, gicon, true);
        } else {
            this._emblem = null;
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
            ({icon} = this._indicator);
            break;
        case SNIconType.OVERLAY:
            icon = this._indicator.overlayIcon;
            break;
        }

        const {theme, name, pixmap} = icon;
        const commonArgs = [theme, iconType, iconSize];

        if (this._customIcons.size) {
            let customIcon = this._customIcons.get(iconType);
            if (!await this._createAndSetIcon(customIcon, null, ...commonArgs)) {
                if (iconType !== SNIconType.OVERLAY) {
                    customIcon = this._customIcons.get(SNIconType.NORMAL);
                    await this._createAndSetIcon(customIcon, null, ...commonArgs);
                }
            }
        } else {
            await this._createAndSetIcon(name, pixmap, ...commonArgs);
        }
    }

    async _createAndSetIcon(name, pixmap, theme, iconType, iconSize) {
        let gicon = null;

        try {
            gicon = await this._createIcon(name, pixmap, theme, iconType, iconSize);
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ||
                e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING))
                return null;

            if (iconType === SNIconType.OVERLAY) {
                logError(e, `${this.debugId} unable to update icon emblem`);
            } else {
                this.fallbackIconName = FALLBACK_ICON_NAME;
                logError(e, `${this.debugId} unable to update icon`);
            }
        }

        try {
            this._setGicon(iconType, gicon);

            if (pixmap && this.gicon) {
                // The pixmap has been saved, we can free the variants memory
                this._indicator.invalidatePixmapProperty(iconType);
            }

            return gicon;
        } catch (e) {
            logError(e, 'Setting GIcon failed');
            return null;
        }
    }

    // updates the base icon
    async _createIcon(name, pixmap, theme, iconType, iconSize) {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const resourceScale = this._getResourceScale();
        const iconScaling = Math.ceil(resourceScale * scaleFactor);

        // From now on we consider them the same thing, as one replaces the other
        if (iconType === SNIconType.ATTENTION)
            iconType = SNIconType.NORMAL;

        if (name) {
            const gicon = await this._cacheOrCreateIconByName(
                iconType, iconSize, iconScaling, name, theme);
            if (gicon)
                return gicon;
        }

        if (pixmap && pixmap.n_children()) {
            return this._createIconFromPixmap(iconType,
                iconSize, iconScaling, scaleFactor, pixmap);
        }

        return null;
    }

    // updates the base icon
    async _updateIcon() {
        if (this._indicator.status === SNIStatus.PASSIVE)
            return;

        if (this.gicon instanceof Gio.EmblemedIcon) {
            const {gicon} = this.gicon;
            this._iconCache.updateActive(SNIconType.NORMAL, gicon, false);
        }

        // we might need to use the AttentionIcon*, which have precedence over the normal icons
        const iconType = this._indicator.status === SNIStatus.NEEDS_ATTENTION
            ? SNIconType.ATTENTION : SNIconType.NORMAL;

        try {
            await this._updateIconByType(iconType, this._iconSize);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING))
                logError(e, `${this.debugId}: Updating icon type ${iconType} failed`);
        }
    }

    async _updateOverlayIcon() {
        if (this._indicator.status === SNIStatus.PASSIVE)
            return;

        if (this._emblem) {
            const {icon} = this._emblem;
            this._iconCache.updateActive(SNIconType.OVERLAY, icon, false);
        }

        // KDE hardcodes the overlay icon size to 10px (normal icon size 16px)
        // we approximate that ratio for other sizes, too.
        // our algorithms will always pick a smaller one instead of stretching it.
        const iconSize = Math.floor(this._iconSize / 1.6);

        try {
            await this._updateIconByType(SNIconType.OVERLAY, iconSize);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING))
                logError(e, `${this.debugId}: Updating overlay icon failed`);
        }
    }

    async _invalidateIconWhenFullyReady() {
        if (this._waitingInvalidation)
            return;

        try {
            this._waitingInvalidation = true;
            await this._waitForFullyReady();
            this._invalidateIcon();
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        } finally {
            delete this._waitingInvalidation;
        }
    }

    // called when the icon theme changes
    _invalidateIcon() {
        this._iconCache.clear();
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        Object.values(SNIconType).forEach(iconType =>
            this._loadingIcons[iconType].clear());

        this._updateIcon().catch(e => logError(e));
        this._updateOverlayIcon().catch(e => logError(e));
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

        const themeIconSize = Math.round(
            this.get_theme_node().get_length('icon-size'));
        let iconStyle = AppIndicatorsIconActor.DEFAULT_STYLE;

        if (themeIconSize > 0) {
            const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);

            if (themeIconSize / scaleFactor !== this._iconSize) {
                iconStyle = `${AppIndicatorsIconActor.DEFAULT_STYLE};` +
                    'icon-size: 0';
            }
        }

        this.set_style(iconStyle);
        this.set_icon_size(this._iconSize);
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
