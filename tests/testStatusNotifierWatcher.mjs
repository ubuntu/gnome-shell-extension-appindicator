import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, URL} from 'node:url';
import {setImmediate} from 'node:timers';
import {test} from 'node:test';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';

async function fixture() {
    const state = {
        owners: new Map([['org.kde.StatusNotifierItem-100-1', ':1.100']]),
        indicators: [],
        icons: [],
        signals: [],
        discovery: [],
        timers: [],
        errors: [],
    };
    let util;
    class Indicator {
        constructor(service, busName, objectPath) {
            this.service = service;
            this.busName = busName;
            this.uniqueId = util.indicatorId(service, busName, objectPath);
            this.handlers = new Map();
            this.hasNameOwner = true;
            this.cancellable = {};
            this.resets = 0;
            this.destroyed = false;
            state.indicators.push(this);
        }

        connect(name, callback) {
            this.handlers.set(name, callback);
        }

        reset() {
            this.resets++;
        }

        destroy() {
            assert.equal(this.destroyed, false);
            this.destroyed = true;
            this.handlers.get('destroy')?.();
        }
    }
    class Variant {
        constructor(type, value) {
            this.value = value;
        }

        static new(type, value) {
            return new Variant(type, value);
        }
    }
    class InputStream {
        read_line_async() {
            const item = state.discovery.shift();
            return Promise.resolve([item ? new TextEncoder().encode(JSON.stringify(item)) : null]);
        }
    }
    class Subprocess {
        static new() {
            return new Subprocess();
        }

        get_stdout_pipe() {
            return {};
        }

        communicate_async() {
            return Promise.resolve([null, null]);
        }

        wait_async() {
            return Promise.resolve(true);
        }

        get_exit_status() {
            return 0;
        }
    }
    class Timeout {
        constructor() {
            return new Promise(resolve => state.timers.push(resolve));
        }
    }
    const gio = {
        _promisify() {},
        _LocalFilePrototype: {},
        DBusConnection: class {},
        InputStream: class {},
        Cancellable: class {},
        Subprocess,
        DataInputStream: InputStream,
        SubprocessFlags: {STDOUT_PIPE: 1, STDERR_PIPE: 2},
        DBusCallFlags: {NONE: 0},
        IOErrorEnum: {CANCELLED: 1},
        DBus: {
            session: {
                call(destination, path, iface, method, args) {
                    assert.equal(method, 'GetNameOwner');
                    const owner = state.owners.get(args.value[0]);
                    if (!owner)
                        return Promise.reject(new Error('Name has no owner'));
                    return Promise.resolve({deep_unpack: () => [owner]});
                },
            },
        },
    };
    const main = {layoutManager: {_startingUp: false}};
    const mocks = {
        'gi://Gio': {default: gio},
        'gi://GLib': {
            default: {
                Variant, VariantType: class {},
                build_filenamev: parts => parts.join('/'),
            },
        },
        'gi://GObject': {
            default: {
                registerClass: (options, type) => type,
                ParamSpec: {object() {}},
                ParamFlags: {},
            },
        },
        'gi://St': {default: {}},
        'resource:///org/gnome/shell/ui/main.js': main,
        'resource:///org/gnome/shell/misc/config.js': {},
        'resource:///org/gnome/shell/misc/signals.js': {EventEmitter: class {}},
        './logger.js': {Logger: {debug() {}, warn() {}}},
        './appIndicator.js': {AppIndicator: Indicator},
        './indicatorStatusIcon.js': {
            BaseStatusIcon: class {},
            IndicatorStatusIcon: class {
                constructor(indicator) {
                    this.indicator = indicator;
                }
            },
            addIconToPanel: icon => state.icons.push(icon),
        },
        './interfaces.js': {},
        './promiseUtils.js': {
            TimeoutPromise: Timeout,
            TimeoutSecondsPromise: class {
                constructor() {
                    return Promise.resolve();
                }
            },
        },
        './dbusMenu.js': {},
        './dbusProxy.js': {DBusProxy: {}},
    };
    const context = createContext({TextDecoder, logError: error => state.errors.push(error)});
    const modules = new Map();
    async function load(name) {
        if (modules.has(name))
            return modules.get(name);
        let module;
        if (Object.hasOwn(mocks, name)) {
            const values = mocks[name];
            module = new SyntheticModule(Object.keys(values), () => {
                for (const [key, value] of Object.entries(values))
                    module.setExport(key, value);
            }, {context});
        } else {
            const path = new URL(`../${name}`, import.meta.url);
            module = new SourceTextModule(await readFile(path, 'utf8'), {
                context, identifier: fileURLToPath(path),
            });
        }
        modules.set(name, module);
        return module;
    }
    const module = await load('./statusNotifierWatcher.js');
    await module.link(load);
    await module.evaluate();
    util = modules.get('./util.js').namespace;
    const watcher = Object.create(module.namespace.StatusNotifierWatcher.prototype);
    watcher._items = new Map();
    watcher._cancellable = {};
    watcher._dbusImpl = {
        emit_signal: (name, value) => state.signals.push([name, value.value]),
        emit_property_changed() {},
    };
    const invocation = {
        get_sender: () => ':1.100',
        get_connection: () => gio.DBus.session,
        return_value: () => {
            state.reply = true;
        },
        return_dbus_error: (name, message) => {
            state.reply = message;
        },
    };
    return {watcher, state, main, invocation};
}

const service = 'org.kde.StatusNotifierItem-100-1';
const owner = ':1.100';
const path = '/StatusNotifierItem';

for (const discoveryFirst of [true, false]) {
    test(`deduplicates discovery and registration, discovery first: ${discoveryFirst}`, async () => {
        const {watcher, state} = await fixture();
        state.discovery.push({services: ['org.example.Tray'], name: owner, path});
        if (discoveryFirst) {
            await watcher._seekStatusNotifierItems({path: '/extension'});
            await watcher._ensureItemRegistered(service, owner, path);
        } else {
            await watcher._ensureItemRegistered(service, owner, path);
            await watcher._seekStatusNotifierItems({path: '/extension'});
        }
        assert.equal(watcher._items.size, 1);
        assert.equal(state.icons.length, 1);
        assert.equal(state.indicators.length, 1);
    });
}

test('deduplicates overlapping registration through a service alias', async () => {
    const {watcher, state} = await fixture();
    await Promise.all([
        watcher._registerItem(null, owner, path),
        watcher._ensureItemRegistered(service, service, path),
    ]);
    assert.equal(watcher._items.size, 1);
    assert.equal(state.icons.length, 1);
});

test('deduplicates path registration after discovery through an application name', async () => {
    const {watcher, state, invocation} = await fixture();
    const objectPath = '/org/example/Tray';
    state.discovery.push({services: ['org.example.Tray'], name: owner, path: objectPath});
    await watcher._seekStatusNotifierItems({path: '/extension'});
    await watcher.RegisterStatusNotifierItemAsync([objectPath], invocation);
    assert.equal(state.reply, true);
    assert.equal(watcher._items.size, 1);
    assert.equal(state.icons.length, 1);
});

test('deduplicates standard SNI name registration while keeping the proxy address', async () => {
    const {watcher, state, invocation} = await fixture();
    const sni = 'org.freedesktop.StatusNotifierItem-100-1';
    state.owners.set(sni, owner);
    await watcher.RegisterStatusNotifierItemAsync([sni], invocation);
    await watcher.RegisterStatusNotifierItemAsync([path], invocation);
    assert.equal(state.reply, true);
    assert.equal(watcher._items.size, 1);
    assert.equal(state.indicators[0].busName, sni);
});

test('deduplicates the service/path registration format', async () => {
    const {watcher, state, invocation} = await fixture();
    await watcher.RegisterStatusNotifierItemAsync([`${service}${path}`], invocation);
    await watcher.RegisterStatusNotifierItemAsync([service], invocation);
    assert.equal(state.reply, true);
    assert.equal(watcher._items.size, 1);
    assert.equal(state.icons.length, 1);
});

test('preserves the proxy destination and advertised service', async () => {
    const {watcher, state} = await fixture();
    await watcher._ensureItemRegistered(service, service, path);
    assert.equal(state.indicators[0].busName, service);
    assert.equal(watcher.RegisteredStatusNotifierItems[0], service);
    assert.equal(watcher._items.has(`${owner}@${path}`), true);
});

test('resets an explicitly re-registered object without adding an icon', async () => {
    const {watcher, state} = await fixture();
    await watcher._ensureItemRegistered(service, owner, path);
    await watcher._ensureItemRegistered(path, owner, path);
    assert.equal(state.indicators[0].resets, 1);
    assert.equal(state.icons.length, 1);
});

test('keeps distinct object paths on one connection', async () => {
    const {watcher, state} = await fixture();
    await watcher._ensureItemRegistered('/First', owner, '/First');
    await watcher._ensureItemRegistered('/Second', owner, '/Second');
    assert.equal(watcher._items.size, 2);
    assert.equal(state.icons.length, 2);
});

test('keeps distinct connections with the same object path', async () => {
    const {watcher} = await fixture();
    await watcher._ensureItemRegistered(path, owner, path);
    await watcher._ensureItemRegistered(path, ':1.101', path);
    assert.equal(watcher._items.size, 2);
});

test('retires a previous owner when its advertised name is reused', async () => {
    const {watcher, state} = await fixture();
    await watcher._ensureItemRegistered(service, owner, path);
    await watcher._ensureItemRegistered(service, ':1.101', path);
    assert.equal(state.indicators[0].destroyed, true);
    assert.equal(watcher._items.size, 1);
    assert.equal(watcher._items.has(`:1.101@${path}`), true);
});

test('removes by object identity and ignores a stale destruction callback', async () => {
    const {watcher, state} = await fixture();
    await watcher._registerItem(service, owner, path);
    const first = state.indicators[0];
    const destroyed = first.handlers.get('destroy');
    first.destroy();
    assert.equal(watcher._items.size, 0);
    await watcher._registerItem(path, owner, path);
    destroyed();
    assert.equal(watcher._items.size, 1);
    assert.equal(watcher._items.get(`${owner}@${path}`), state.indicators[1]);
});

test('a delayed owner-loss callback does not destroy an already retired indicator', async () => {
    const {watcher, state} = await fixture();
    await watcher._registerItem(service, owner, path);
    const first = state.indicators[0];
    first.hasNameOwner = false;
    const pending = first.handlers.get('name-owner-changed')();
    first.destroy();
    await watcher._registerItem(path, owner, path);
    state.timers.shift()();
    await pending;
    assert.equal(state.errors.length, 0);
    assert.equal(watcher._items.size, 1);
});

test('does not publish an icon destroyed while waiting for desktop startup', async () => {
    const {watcher, state, main} = await fixture();
    let resume;
    main.layoutManager._startingUp = true;
    main.layoutManager.connect_once = () => new Promise(resolve => {
        resume = resolve;
    });
    const pending = watcher._registerItem(service, owner, path);
    await new Promise(resolve => setImmediate(resolve));
    state.indicators[0].destroy();
    resume();
    await pending;
    assert.equal(state.icons.length, 0);
    assert.equal(watcher._items.size, 0);
});

test('releases a failed registration so it can be retried', async () => {
    const {watcher, state, main} = await fixture();
    const failure = Object.assign(new Error('Startup cancelled'), {matches: () => true});
    main.layoutManager._startingUp = true;
    main.layoutManager.connect_once = () => Promise.reject(failure);
    await assert.rejects(watcher._registerItem(service, owner, path), /Startup cancelled/);
    assert.equal(watcher._items.size, 0);
    assert.equal(state.indicators[0].destroyed, true);
    main.layoutManager._startingUp = false;
    await watcher._registerItem(service, owner, path);
    assert.equal(state.icons.length, 1);
});
