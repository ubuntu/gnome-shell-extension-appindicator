// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/* exported CancellablePromise, SignalConnectionPromise, IdlePromise,
   TimeoutPromise, TimeoutSecondsPromise, MetaLaterPromise, _promisify,
   _promisifySignals */

const { Gio, GLib, GObject, Meta } = imports.gi;
const Signals = imports.signals;

var CancellablePromise = class extends Promise {
    constructor(executor, cancellable) {
        if (!(executor instanceof Function))
            throw TypeError('executor is not a function');

        if (cancellable && !(cancellable instanceof Gio.Cancellable))
            throw TypeError('cancellable parameter is not a Gio.Cancellable');

        const cancelled = cancellable && cancellable.is_cancelled();
        let cancellationId;
        let rejector;

        if (cancellable && !cancelled)
            cancellationId = cancellable.connect(() => this.cancel());

        super((resolve, reject) => {
            rejector = reject;
            if (cancelled) {
                reject(new GLib.Error(Gio.IOErrorEnum,
                    Gio.IOErrorEnum.CANCELLED, 'Promise cancelled'));
            } else if (cancellationId) {
                rejector = (...args) => {
                    reject(...args);
                    // This must happen in an idle not to deadlock on ::cancelled
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () =>
                        cancellable.disconnect(cancellationId));
                };
                executor((...args) => {
                    resolve(...args);
                    cancellable.disconnect(cancellationId);
                }, rejector);
            } else {
                executor(resolve, reject);
            }
        });

        this._cancelled = cancelled;
        this._rejector = rejector;
        this._cancellable = cancellable || null;
    }

    get cancellable() {
        return this._cancellable;
    }

    then(...args) {
        const ret = super.then(...args);

        /* Every time we call then() on this promise we'd get a new
         * CancellablePromise however that won't have the properties that the
         * root one has set, and then it won't be possible to cancel a promise
         * chain from the last one.
         * To allow this we keep track of the root promise, make sure that
         * the same method on the root object is called during cancellation
         * or any destruction method if you want this to work. */
        if (ret instanceof CancellablePromise)
            ret._root = this._root || this;

        return ret;
    }

    resolved() {
        return !this.cancelled() && !!(this._root || this)._resolved;
    }

    cancelled() {
        return !!(this._root || this)._cancelled;
    }

    pending() {
        return !this.resolved() && !this.cancelled();
    }

    cancel() {
        if (this._root) {
            this._root.cancel();
            return this;
        }

        if (!this._rejector)
            throw new GObject.NotImplementedError();

        this._cancelled = !this._resolved;
        this._rejector(new GLib.Error(Gio.IOErrorEnum,
            Gio.IOErrorEnum.CANCELLED, 'Promise cancelled'));

        return this;
    }
};

var SignalConnectionPromise = class extends CancellablePromise {
    constructor(object, signal, cancellable) {
        if (arguments.length === 1 && object instanceof Function) {
            super(object);
            return;
        }

        if (!(object.connect instanceof Function))
            throw new TypeError('Not a valid object');

        if (object instanceof GObject.Object &&
            !GObject.signal_lookup(signal.split(':')[0], object.constructor.$gtype))
            throw new TypeError(`Signal ${signal} not found on object ${object}`);

        let id;
        let destroyId;
        super(resolve => {
            id = object.connect(signal, (_obj, ...args) => {
                this._resolved = !this.cancelled();
                this.disconnect();
                resolve(args.length === 1 ? args[0] : args);
            });

            if (!(object instanceof GObject.Object) ||
                GObject.signal_lookup('destroy', object.constructor.$gtype))
                destroyId = object.connect('destroy', () => this.cancel());
        }, cancellable);

        this._object = object;
        this._id = id;
        this._destroyId = destroyId;
    }

    disconnect() {
        if (this._root) {
            this._root.disconnect();
            return this;
        }

        if (this._id) {
            this._object.disconnect(this._id);
            if (this._destroyId) {
                this._object.disconnect(this._destroyId);
                this._destroyId = 0;
            }
            this._object = null;
            this._id = 0;
        }
        return this;
    }

    cancel() {
        this.disconnect();
        return super.cancel();
    }
};

var GSourcePromise = class extends CancellablePromise {
    constructor(gsource, priority, cancellable) {
        if (arguments.length === 1 && gsource instanceof Function) {
            super(gsource);
            return;
        }

        if (gsource.constructor.$gtype !== GLib.Source.$gtype)
            throw new TypeError(`gsource ${gsource} is not of type GLib.Source`);

        if (!priority)
            priority = GLib.PRIORITY_DEFAULT;

        super(resolve => {
            gsource.set_callback(() => {
                this._resolved = !this.cancelled();
                this.remove();
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            gsource.set_name(`[gnome-shell] Source promise ${
                new Error().stack.split('\n').filter(line =>
                    !line.match(/promiseUtils\.js/))[0]}`);
            gsource.attach(null);
        }, cancellable);

        this._gsource = gsource;

        if (this.cancelled())
            this.remove();
    }

    remove() {
        if (this._root) {
            this._root.remove();
            return this;
        }

        if (this._gsource) {
            this._gsource.destroy();
            this._gsource = null;
        }

        return this;
    }

    cancel() {
        this.remove();
        return super.cancel();
    }
};

var IdlePromise = class extends GSourcePromise {
    constructor(priority, cancellable) {
        if (arguments.length === 1 && priority instanceof Function) {
            super(priority);
            return;
        }

        if (priority === undefined)
            priority = GLib.PRIORITY_DEFAULT_IDLE;
        else if (!Number.isInteger(priority))
            throw TypeError('Invalid priority');

        super(GLib.idle_source_new(), priority, cancellable);
    }
};

var TimeoutPromise = class extends GSourcePromise {
    constructor(interval, priority, cancellable) {
        if (arguments.length === 1 && interval instanceof Function) {
            super(interval);
            return;
        }

        if (!Number.isInteger(interval) || interval < 0)
            throw TypeError('Invalid interval');

        super(GLib.timeout_source_new(interval), priority, cancellable);
    }
};

var TimeoutSecondsPromise = class extends GSourcePromise {
    constructor(interval, priority, cancellable) {
        if (arguments.length === 1 && interval instanceof Function) {
            super(interval);
            return;
        }

        if (!Number.isInteger(interval) || interval < 0)
            throw TypeError('Invalid interval');

        super(GLib.timeout_source_new_seconds(interval), priority, cancellable);
    }
};

var MetaLaterPromise = class extends CancellablePromise {
    constructor(laterType, cancellable) {
        if (arguments.length === 1 && laterType instanceof Function) {
            super(laterType);
            return;
        }

        if (laterType && laterType.constructor.$gtype !== Meta.LaterType.$gtype)
            throw new TypeError(`laterType ${laterType} is not of type Meta.LaterType`);
        else if (!laterType)
            laterType = Meta.LaterType.BEFORE_REDRAW;

        let id;
        super(resolve => {
            id = Meta.later_add(laterType, () => {
                this._resolved = !this.cancelled();
                this.remove();
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        }, cancellable);

        this._id = id;
    }

    remove() {
        if (this._root) {
            this._root.remove();
            return this;
        }

        if (this._id) {
            Meta.later_remove(this._id);
            this._id = 0;
        }
        return this;
    }

    cancel() {
        this.remove();
        return super.cancel();
    }
};

function _promisifySignals(proto) {
    if (proto.connect_once)
        return;

    proto.connect_once = function (signal, cancellable) {
        return new SignalConnectionPromise(this, signal, cancellable);
    };
}

const addSignalMethods = Signals.addSignalMethods;
Signals.addSignalMethods = proto => {
    addSignalMethods(proto);
    _promisifySignals(proto);
};

_promisifySignals(GObject.Object.prototype);

var _promisify = Gio._promisify;
if (imports.system.version < 16501) {
    /* This is backported from upstream gjs, so that all the features are available */
    _promisify = function (proto, asyncFunc, finishFunc) {
        if (proto[`_original_${asyncFunc}`] !== undefined)
            return;
        proto[`_original_${asyncFunc}`] = proto[asyncFunc];
        proto[asyncFunc] = function (...args) {
            if (!args.every(arg => typeof arg !== 'function'))
                return this[`_original_${asyncFunc}`](...args);
            return new Promise((resolve, reject) => {
                const callStack = new Error().stack.split('\n').filter(line => !line.match(/promisify/)).join('\n');
                this[`_original_${asyncFunc}`](...args, (source, res) => {
                    try {
                        const result = source !== null && source[finishFunc] !== undefined
                            ? source[finishFunc](res)
                            : proto[finishFunc](res);
                        if (Array.isArray(result) && result.length > 1 && result[0] === true)
                            result.shift();
                        resolve(result);
                    } catch (error) {
                        if (error.stack)
                            error.stack += `### Promise created here: ###\n${callStack}`;
                        else
                            error.stack = callStack;
                        reject(error);
                    }
                });
            });
        };
    };
}

if (!Promise.allSettled) {
    Promise.allSettled = function (promises) {
        let wrappedPromises = promises.map(p => Promise.resolve(p)
            .then(
                val => ({ status: 'fulfilled', value: val }),
                err => ({ status: 'rejected', reason: err })));
        return Promise.all(wrappedPromises);
    };
}
