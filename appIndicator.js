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

/* exported AppIndicatorProxy, AppIndicator IconActor */

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
const Params = imports.misc.params;
const PixmapsUtils = Extension.imports.pixmapsUtils;
const PromiseUtils = Extension.imports.promiseUtils;
const SettingsManager = Extension.imports.settingsManager;

PromiseUtils._promisify(Gio.File.prototype, 'read_async', 'read_finish');
PromiseUtils._promisify(Gio._LocalFilePrototype, 'read_async', 'read_finish');
PromiseUtils._promisify(GdkPixbuf.Pixbuf, 'get_file_info_async', 'get_file_info_finish');
PromiseUtils._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');
PromiseUtils._promisify(Gio.DBusProxy.prototype, 'init_async', 'init_finish');

const MAX_UPDATE_FREQUENCY = 100; // In ms

// eslint-disable-next-line no-unused-vars
const SNICategory = Object.freeze({
    APPLICATION: 'ApplicationStatus',
    COMMUNICATIONS: 'Communications',
    SYSTEM: 'SystemServices',
    HARDWARE: 'Hardware',
});

var SNIStatus = Object.freeze({
    PASSIVE: 'Passive',
    ACTIVE: 'Active',
    NEEDS_ATTENTION: 'NeedsAttention',
});

const SNIconType = Object.freeze({
    NORMAL: 0,
    ATTENTION: 1,
    OVERLAY: 2,

    toPropertyName: (iconType, params = { isPixbuf: false }) => {
        let propertyName = 'Icon';

        if (iconType === SNIconType.OVERLAY)
            propertyName = 'OverlayIcon';
        else if (iconType === SNIconType.ATTENTION)
            propertyName = 'AttentionIcon';

        return `${propertyName}${params.isPixbuf ? 'Pixmap' : 'Name'}`;
    },
});

var AppIndicatorProxy = GObject.registerClass({
    Signals: { 'destroy': {} },
}, class AppIndicatorProxy extends Gio.DBusProxy {
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

    static get TUPLE_VARIANT_TYPE() {
        if (!this._tupleVariantType)
            this._tupleVariantType = new GLib.VariantType('(v)');

        return this._tupleVariantType;
    }

    static destroy() {
        delete this._interfaceInfo;
        delete this._tupleVariantType;
        delete this._tupleType;
    }

    _init(busName, objectPath) {
        const { interfaceInfo } = AppIndicatorProxy;

        super._init({
            g_connection: Gio.DBus.session,
            g_interface_name: interfaceInfo.name,
            g_interface_info: interfaceInfo,
            g_name: busName,
            g_object_path: objectPath,
            g_flags: Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
        });

        this.set_cached_property('Status',
            new GLib.Variant('s', SNIStatus.PASSIVE));

        this._signalIds = [];
        this._accumulatedProperties = new Set();
        this._cancellables = new Map();
        this._changedProperties = Object.create(null);

        this._signalIds.push(this.connect('g-signal',
            (_proxy, ...args) => this._onSignal(...args).catch(logError)));

        this._signalIds.push(this.connect('notify::g-name-owner', () => {
            this._resetNeededProperties();
            if (!this.gNameOwner)
                this._cancelRefreshProperties();
            else
                this._setupProxyPropertyList();
        }));
    }

    async initAsync(cancellable) {
        cancellable = new Util.CancellableChild(cancellable);
        await this.init_async(GLib.PRIORITY_DEFAULT, cancellable);
        this._cancellable = cancellable;

        this.gInterfaceInfo.methods.map(m => m.name).forEach(method =>
            this._ensureAsyncMethod(method));

        this._setupProxyPropertyList();
    }

    destroy() {
        this.emit('destroy');
        this._signalIds.forEach(id => this.disconnect(id));

        const cachedProperties = this.get_cached_property_names();
        if (cachedProperties) {
            cachedProperties.forEach(propertyName =>
                this.set_cached_property(propertyName, null));
        }

        if (this._cancellable)
            this._cancellable.cancel();

        this._cancellables.clear();
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
                        !e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_PROPERTY))
                        logError(e);
                }
            }));
    }

    async _onSignal(_sender, signal, params) {
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
            GLib.PRIORITY_DEFAULT_IDLE, MAX_UPDATE_FREQUENCY, this._cancellable);
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

    // This can be removed when we will have GNOME 43 as minimum version
    _ensureAsyncMethod(method) {
        if (this[`${method}Async`])
            return;

        if (!this[`${method}Remote`])
            throw new Error(`Missing remote method '${method}'`);

        this[`${method}Async`] = function (...args) {
            return new Promise((resolve, reject) => {
                this[`${method}Remote`](...args, (ret, e) => {
                    if (e)
                        reject(e);
                    else
                        resolve(ret);
                });
            });
        };
    }

    getProperty(propertyName, cancellable) {
        return this.g_connection.call(this.g_name,
            this.g_object_path, 'org.freedesktop.DBus.Properties', 'Get',
            GLib.Variant.new('(ss)', [this.g_interface_name, propertyName]),
            AppIndicatorProxy.TUPLE_VARIANT_TYPE, Gio.DBusCallFlags.NONE, -1,
            cancellable);
    }

    getProperties(cancellable) {
        return this.g_connection.call(this.g_name,
            this.g_object_path, 'org.freedesktop.DBus.Properties', 'GetAll',
            GLib.Variant.new('(s)', [this.g_interface_name]),
            GLib.VariantType.new('(a{sv})'), Gio.DBusCallFlags.NONE, -1,
            cancellable);
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
                Object.assign(params, { cancellable }));
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                // the property may not even exist, silently ignore it
                Util.Logger.debug(`While refreshing property ${propertyName}: ${e}`);
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
            this._propertiesEmitTimeout = new PromiseUtils.TimeoutPromise(16,
                GLib.PRIORITY_DEFAULT_IDLE, params.cancellable);
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

if (imports.system.version < 17101) {
    /* In old versions wrappers are not applied to sub-classes, so let's do it */
    AppIndicatorProxy.prototype.init_async = Gio.DBusProxy.prototype.init_async;
}

/**
 * the AppIndicator class serves as a generic container for indicator information and functions common
 * for every displaying implementation (IndicatorMessageSource and IndicatorStatusIcon)
 */
var AppIndicator = class AppIndicatorsAppIndicator {

    static get NEEDED_PROPERTIES() {
        return ['Id', 'Menu'];
    }

    constructor(service, busName, object) {
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

        try {
            this._commandLine = await Util.getProcessName(this.busName,
                cancellable, GLib.PRIORITY_LOW);
        } catch (e) {
            Util.Logger.debug(`${this.uniqueId}, failed getting command line: ${e.message}`);
        }
    }

    _checkIfReady() {
        let wasReady = this.isReady;
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
            { isPixbuf: true });
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
            SNIconType.toPropertyName(iconType, { isPixbuf: true }), null);
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
};
Signals.addSignalMethods(AppIndicator.prototype);

let StTextureCacheSkippingGIcon;

if (imports.system.version >= 17501) {
    try {
        StTextureCacheSkippingGIcon = GObject.registerClass({
            Implements: [Gio.Icon],
        }, class StTextureCacheSkippingGIconClass extends Gio.EmblemedIcon {
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
    } catch (e) {}
}

var IconActor = GObject.registerClass({
    Signals: {
        'requires-custom-image': {},
    },
},
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

        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        this.height = iconSize * themeContext.scale_factor;

        this._indicator     = indicator;
        this._customIcons   = new Map();
        this._iconSize      = iconSize;
        this._iconCache     = new IconCache.IconCache();
        this._cancellable   = new Gio.Cancellable();
        this._loadingIcons  = Object.create(null);

        Object.values(SNIconType).forEach(t => (this._loadingIcons[t] = new Map()));

        Util.connectSmart(this._indicator, 'icon', this, () => this._updateIcon().catch(logError));
        Util.connectSmart(this._indicator, 'overlay-icon', this, this._updateOverlayIcon);
        Util.connectSmart(this._indicator, 'reset', this, this._invalidateIcon);

        const settings = SettingsManager.getDefaultGSettings();
        Util.connectSmart(settings, 'changed::icon-size', this, this._invalidateIcon);
        Util.connectSmart(settings, 'changed::custom-icons', this, () => {
            this._updateCustomIcons();
            this._invalidateIcon();
        });

        if (GObject.signal_lookup('resource-scale-changed', this))
            this.connect('resource-scale-changed', () => this._invalidateIcon());
        else
            this.connect('notify::resource-scale', () => this._invalidateIcon());

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
            this._cancellable = null;
            this._indicator = null;
            this._loadingIcons = null;
        });
    }

    _updateIconClass() {
        this.add_style_class_name(
            `appindicator-icon-${this._indicator.id.toLowerCase().replace(/_|\s/g, '-')}`);
    }

    _cancelLoadingByType(iconType) {
        this._loadingIcons[iconType].forEach(c => c.cancel());
        this._loadingIcons[iconType].clear();
    }

    _ensureNoIconIsLoading(iconType, id) {
        if (this._loadingIcons[iconType].has(id)) {
            Util.Logger.debug(`${this._indicator.id}, Icon ${id} Is still loading, ignoring the request`);
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

        const path = this._getIconInfo(iconName, themePath, iconSize, iconScaling);
        const loadingId = path || id;

        const cancellable = await this._getIconLoadingCancellable(iconType, id);
        try {
            gicon = await this._createIconByName(path, iconSize, iconScaling, cancellable);
        } finally {
            this._cleanupIconLoadingCancellable(iconType, loadingId);
        }
        if (gicon)
            gicon = this._iconCache.add(id, gicon);
        return gicon;
    }

    async _createIconByFile(file, iconSize, iconScaling, cancellable) {
        try {
            const inputStream = await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);
            return GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(inputStream,
                -1, Math.ceil(iconSize * iconScaling), true, cancellable);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`${this._indicator.id}, Impossible to read image from path '${file.get_path()}': ${e}`);
            throw e;
        }
    }

    async _createIconByName(path, iconSize, iconScaling, cancellable) {
        if (!path) {
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
            return null;
        } else if (this._createIconIdle) {
            this._createIconIdle.cancel();
            delete this._createIconIdle;
        }

        try {
            const [format, width, height] = await GdkPixbuf.Pixbuf.get_file_info_async(
                path, cancellable);

            if (!format) {
                Util.Logger.critical(`${this._indicator.id}, Invalid image format: ${path}`);
                return null;
            }

            const file = Gio.File.new_for_path(path);
            if (width >= height * 1.5) {
                /* Hello indicator-multiload! */
                await this._loadCustomImage(file, width, height, cancellable);
                return null;
            } else if (StTextureCacheSkippingGIcon) {
                /* We'll wrap the icon so that it won't be cached forever by the shell */
                return new Gio.FileIcon({ file });
            } else {
                return this._createIconByFile(file, iconSize, iconScaling, cancellable);
            }
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`${this._indicator.id}, Impossible to read image info from path '${path}': ${e}`);
            throw e;
        }
    }

    async _loadCustomImage(file, width, height, cancellable) {
        if (!(this instanceof CustomImageIconActor)) {
            this.emit('requires-custom-image');
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED,
                'Loading cancelled, need specific class');
        }

        const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
        const textureCache = St.TextureCache.get_default();
        const resourceScale = this._getResourceScale();

        const customImage = textureCache.load_file_async(file, -1,
            height, scaleFactor, resourceScale);

        customImage.set({
            xAlign: imports.gi.Clutter.ActorAlign.CENTER,
            yAlign: imports.gi.Clutter.ActorAlign.CENTER,
        });

        if (customImage.content) {
            this._setCustomImage(customImage, width, height);
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
                this._setCustomImage(customImage, width, height);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
        } finally {
            racingPromises.forEach(p => p.cancel());

            if (this._customImage !== customImage)
                customImage.destroy();
        }
    }

    _setCustomImage(imageActor, width, height) {
        if (this._customImage)
            this._customImage.destroy();

        this._customImage = imageActor;
        this.add_child(this._customImage);
        this.width = width;
        this.height = height;
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

    async _argbToRgba(src, cancellable) {
        await new PromiseUtils.IdlePromise(GLib.PRIORITY_LOW, cancellable);

        return PixmapsUtils.argbToRgba(src);
    }

    async _createIconFromPixmap(iconType, iconSize, iconScaling, pixmapsVariant) {
        iconSize *= iconScaling;

        const { pixmapVariant, width, height, rowStride } =
            PixmapsUtils.getBestPixmap(pixmapsVariant, iconSize);

        const id = `__PIXMAP_ICON_${width}x${height}`;

        const cancellable = this._getIconLoadingCancellable(iconType, id);
        try {
            return GdkPixbuf.Pixbuf.new_from_bytes(
                await this._argbToRgba(pixmapVariant.deep_unpack(), cancellable),
                GdkPixbuf.Colorspace.RGB, true,
                8, width, height, rowStride);
        } catch (e) {
            // the image data was probably bogus. We don't really know why, but it _does_ happen.
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`${this._indicator.id}, Impossible to create image from data: ${e}`);
            throw e;
        } finally {
            this._cleanupIconLoadingCancellable(iconType, id);
        }
    }

    // The icon cache Active flag will be set to true if the used gicon matches
    // the cached one (as in some cases it may be equal, but not the same object).
    // So when it's not need anymore we make sure to check the active state
    // and set it to false so that it can be picked up by the garbage collector.
    _setGicon(iconType, gicon, iconSize) {
        if (iconType !== SNIconType.OVERLAY) {
            if (gicon) {
                const isPixbuf = gicon instanceof GdkPixbuf.Pixbuf;
                this.gicon = StTextureCacheSkippingGIcon && !isPixbuf
                    ? new StTextureCacheSkippingGIcon({ gicon })
                    : new Gio.EmblemedIcon({ gicon });

                this._iconCache.updateActive(SNIconType.NORMAL, gicon,
                    this.gicon.get_icon() === gicon);

                this.set_icon_size(iconSize);
            } else {
                this.gicon = null;
            }
        } else if (gicon) {
            this._emblem = new Gio.Emblem({ icon: gicon });
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
            icon = this._indicator.icon;
            break;
        case SNIconType.OVERLAY:
            icon = this._indicator.overlayIcon;
            break;
        }

        const { theme, name, pixmap } = icon;
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
                e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING)) {
                Util.Logger.debug(`${this._indicator.uniqueId}, Impossible to load icon: ${e}`);
                return null;
            }

            if (iconType === SNIconType.OVERLAY)
                logError(e, `unable to update icon emblem for ${this._indicator.id}`);
            else
                logError(e, `unable to update icon for ${this._indicator.id}`);
        }

        try {
            this._setGicon(iconType, gicon, iconSize);

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
        const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
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

        if (pixmap && pixmap.n_children())
            return this._createIconFromPixmap(iconType, iconSize, iconScaling, pixmap);

        return null;
    }

    // updates the base icon
    async _updateIcon() {
        if (this._indicator.status === SNIStatus.PASSIVE)
            return;

        if (this.gicon instanceof Gio.EmblemedIcon) {
            const { gicon } = this.gicon;
            this._iconCache.updateActive(SNIconType.NORMAL, gicon, false);
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
        if (this._indicator.status === SNIStatus.PASSIVE)
            return;

        if (this._emblem) {
            const { icon } = this._emblem;
            this._iconCache.updateActive(SNIconType.OVERLAY, icon, false);
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

var CustomImageIconActor = GObject.registerClass(
class CustomImageIconActor extends IconActor {
    vfunc_paint(paintContext) {
        if (this._customImage) {
            this.paint_background(paintContext);
            this._customImage.paint(paintContext);
            return;
        }

        super.vfunc_paint(paintContext);
    }
});
