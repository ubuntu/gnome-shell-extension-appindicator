import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {CancellableChild, Logger} from './util.js';

Gio._promisify(Gio.DBusProxy.prototype, 'init_async');

export const DBusProxy = GObject.registerClass({
    Signals: {'destroy': {}},
}, class DBusProxy extends Gio.DBusProxy {
    static get TUPLE_VARIANT_TYPE() {
        if (!this._tupleVariantType)
            this._tupleVariantType = new GLib.VariantType('(v)');

        return this._tupleVariantType;
    }

    static destroy() {
        delete this._tupleType;
    }

    _init(busName, objectPath, interfaceInfo, flags = Gio.DBusProxyFlags.NONE) {
        if (interfaceInfo.signals.length)
            Logger.warn('Avoid exposing signals to gjs!');

        super._init({
            gConnection: Gio.DBus.session,
            gInterfaceName: interfaceInfo.name,
            gInterfaceInfo: interfaceInfo,
            gName: busName,
            gObjectPath: objectPath,
            gFlags: flags,
        });

        this._signalIds = [];

        if (!(flags & Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS)) {
            this._signalIds.push(this.connect('g-signal',
                (_proxy, ...args) => this._onSignal(...args)));
        }

        this._signalIds.push(this.connect('notify::g-name-owner', () =>
            this._onNameOwnerChanged()));
    }

    async initAsync(cancellable) {
        cancellable = new CancellableChild(cancellable);
        await this.init_async(GLib.PRIORITY_DEFAULT, cancellable);
        this._cancellable = cancellable;

        this.gInterfaceInfo.methods.map(m => m.name).forEach(method =>
            this._ensureAsyncMethod(method));
    }

    destroy() {
        this.emit('destroy');

        this._signalIds.forEach(id => this.disconnect(id));

        if (this._cancellable)
            this._cancellable.cancel();
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

    _onSignal() {
    }

    getProperty(propertyName, cancellable) {
        return this.gConnection.call(this.gName,
            this.gObjectPath, 'org.freedesktop.DBus.Properties', 'Get',
            GLib.Variant.new('(ss)', [this.gInterfaceName, propertyName]),
            DBusProxy.TUPLE_VARIANT_TYPE, Gio.DBusCallFlags.NONE, -1,
            cancellable);
    }

    getProperties(cancellable) {
        return this.gConnection.call(this.gName,
            this.gObjectPath, 'org.freedesktop.DBus.Properties', 'GetAll',
            GLib.Variant.new('(s)', [this.gInterfaceName]),
            GLib.VariantType.new('(a{sv})'), Gio.DBusCallFlags.NONE, -1,
            cancellable);
    }
});
