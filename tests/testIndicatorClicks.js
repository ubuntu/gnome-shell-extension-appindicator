#!/usr/bin/gjs -m
// SPDX-License-Identifier: GPL-2.0-or-later
// Exercise production click and model methods without a running GNOME Shell.
// Shell UI objects are stubbed; Gio cancellables and error types are real.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const Clutter = {
    BUTTON_PRIMARY: 1, BUTTON_MIDDLE: 2, BUTTON_SECONDARY: 3,
    EVENT_STOP: true, EVENT_PROPAGATE: false,
};
const Main = {panel: {menuManager: {activeMenu: null}}};
const settings = {doubleClickTime: 250, doubleClickDistance: 5};
let lookup, query, lookupCount, queryCount;
let errors = [];
const DBusUtils = {
    getProcessId(name, cancellable) {
        lookupCount++;
        return lookup(name, cancellable);
    },
};
const GioMock = {
    Cancellable: Gio.Cancellable,
    IOErrorEnum: Gio.IOErrorEnum,
    DBusError: Gio.DBusError,
    FILE_ATTRIBUTE_STANDARD_SYMLINK_TARGET: Gio.FILE_ATTRIBUTE_STANDARD_SYMLINK_TARGET,
    FileQueryInfoFlags: Gio.FileQueryInfoFlags,
    _promisify() {},
    File: {
        prototype: {}, new_for_path(path) {
            return {
                query_info_async(...args) {
                    queryCount++;
                    return Promise.resolve().then(() => query(path, ...args));
                },
            };
        },
    },
};
const GObject = {
    registerClass(...args) {
        return args.at(-1);
    },
};
const PanelMenu = {Button: class {}};
const Util = {Logger: {debug() {}, warn() {}}};
const [ok, contents] = Gio.File.new_for_path(System.programArgs[0]).load_contents(null);
if (!ok)
    throw new Error('Cannot read production source');
const source = new TextDecoder().decode(contents)
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const factory = new Function('Clutter', 'Gio', 'GLib', 'GObject', 'St',
    'AppDisplay', 'Main', 'Panel', 'PanelMenu', 'AppIndicator', 'PromiseUtils',
    'SettingsManager', 'Util', 'DBusMenu', 'DBusUtils', 'global', 'logError',
    `${source}\nreturn IndicatorStatusIcon;`);
const Icon = factory(Clutter, GioMock, GLib, GObject, {}, {}, Main,
    {PANEL_ICON_SIZE: 16}, PanelMenu, {}, {}, {}, Util, {}, DBusUtils,
    {
        stage: {
            context: {
                get_settings() {
                    return settings;
                },
            },
        },
    }, e => errors.push(e));

const [, modelBytes] = Gio.File.new_for_path(System.programArgs[1]).load_contents(null);
const modelText = new TextDecoder().decode(modelBytes);
const modelStart = modelText.indexOf('export class AppIndicator extends');
const modelEnd = modelText.indexOf('\nconst StTextureCacheSkippingFileIcon');
if (modelStart < 0 || modelEnd <= modelStart)
    throw new Error('Cannot locate production AppIndicator class');
const modelSource = modelText.slice(modelStart, modelEnd).replace(/^export /, '');
const Model = new Function('Signals', 'Gio', 'Util', 'logError',
    `${modelSource}\nreturn AppIndicator;`)(
    {EventEmitter: class {}}, Gio, Util, e => errors.push(e));

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });
    return {promise, resolve, reject};
}

function drain() {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function event(button, time = 1000, x = 40, y = 20) {
    return {
        get_button: () => button, get_time: () => time,
        get_coords: () => [x, y], copy: () => event(button, time, x, y),
    };
}

function makeIcon(menuPath = null) {
    lookupCount = 0;
    queryCount = 0;
    errors = [];
    lookup = () => Promise.resolve(123);
    query = () => ({get_symlink_target: () => '/usr/bin/wine64-preloader'});
    const calls = [];
    const icon = Object.create(Icon.prototype);
    icon._indicator = {
        busName: 'org.kde.StatusNotifierItem-123-1', nameOwner: ':1.123', hasNameOwner: true, menuPath,
        uniqueId: 'test', open: (...args) => calls.push(['open', ...args]),
        contextMenu: (...args) => Promise.resolve(calls.push(['context', ...args])),
        secondaryActivate: (...args) => calls.push(['middle', ...args]),
    };
    icon.menu = {numMenuItems: 0, toggle: () => calls.push(['toggle'])};
    icon._lastClickTime = -1;
    icon._lastClickX = -1;
    icon._lastClickY = -1;
    Main.panel.menuManager.activeMenu = {close: () => calls.push(['close'])};
    Main.panel.menuManager._closeMenu = () => calls.push(['legacy-close']);
    return {icon, calls};
}

const tests = [
    ['unknown menu properties remain unready', () => {
        const model = Object.create(Model.prototype);
        model._proxy = {g_name_owner: ':1.222', Id: 'wine'};
        model.emit = () => {};
        for (const menu of [undefined, null, '']) {
            model._proxy.Menu = menu;
            model.isReady = false;
            assert(!model._checkIfReady(), 'missing Menu treated as ready');
        }
    }],
    ['activation support disappearing during lookup is respected', async () => {
        const {icon, calls} = makeIcon();
        const pending = deferred();
        lookup = () => pending.promise;
        icon.vfunc_button_press_event(event(1));
        icon._indicator.supportsActivation = false;
        pending.resolve(123);
        await drain();
        assert(!calls.some(c => c[0] === 'open' || c[0] === 'context'),
            'late unsupported Activate dispatched');
    }],

    ['cached Wine respects an explicitly unsupported Activate', async () => {
        const {icon, calls} = makeIcon();
        icon._isWine = true;
        icon._indicator.supportsActivation = false;
        icon._handleButtonPress(event(1));
        assert(calls.length === 0, 'base control should not activate');
        icon.vfunc_button_press_event(event(1, 2000));
        await drain();
        assert(!calls.some(c => c[0] === 'open'), 'Wine path ignores supportsActivation=false');
    }],
    ['fresh NO_DBUSMENU item reaches ready state', async () => {
        const model = Object.create(Model.prototype);
        model._proxy = {g_name_owner: ':1.222', Id: 'wine', Menu: '/Menu'};
        model.emit = () => {};
        model.isReady = false;
        assert(model._checkIfReady() === true, 'normal menu control should become ready');
        model.isReady = false;
        model._proxy.Menu = '/NO_DBUSMENU';
        assert(model.menuPath === null, 'sentinel not normalized');
        assert(model._checkIfReady() === true, 'NO_DBUSMENU can never satisfy ready predicate');
        assert(await model._checkNeededProperties(null), 'explicit no-menu property retried');
    }],
    ['owner change invalidates Wine cache before property refresh', async () => {
        const {icon, calls} = makeIcon();
        const model = Object.create(Model.prototype);
        const refreshed = deferred();
        model._proxy = {g_name_owner: ':1.222', Id: 'native', Menu: '/NO_DBUSMENU'};
        model.busName = 'org.kde.StatusNotifierItem-123-1';
        model._cancellable = new Gio.Cancellable();
        model._checkNeededProperties = () => refreshed.promise;
        model._updateAppInfo = () => Promise.resolve();
        model.emit = name => {
            if (name === 'name-owner-changed')
                icon._resetWineState();
        };
        model.contextMenu = () => Promise.resolve(calls.push(['context-on-new-native-owner']));
        icon._indicator = model;
        icon._isWine = true;
        query = () => ({get_symlink_target: () => '/usr/bin/heroic'});
        const change = model._nameOwnerChanged();
        icon.vfunc_button_press_event(event(3));
        await drain();
        const staleDispatch = calls.some(c => c[0] === 'context-on-new-native-owner');
        refreshed.resolve(true);
        await change;
        assert(!staleDispatch, 'old Wine identity used during new owner property refresh');
    }],

    ['first right click uses async symlink query and ContextMenu', async () => {
        const {icon, calls} = makeIcon();
        lookup = name => {
            assert(name === ':1.123', 'lookup must use the unique owner, not the well-known name');
            return Promise.resolve(123);
        };
        query = (path, attribute, flags) => {
            assert(path === '/proc/123/exe', 'wrong executable path');
            assert(attribute === Gio.FILE_ATTRIBUTE_STANDARD_SYMLINK_TARGET, 'wrong attribute');
            assert(flags === Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, 'followed executable link');
            return {get_symlink_target: () => '/opt/proton/files/bin/wine'};
        };
        assert(icon._isWine === undefined, 'detection must start unknown');
        assert(icon.vfunc_button_press_event(event(3)) === true, 'event not reserved');
        await drain();
        assert(JSON.stringify(calls) === JSON.stringify([['close'], ['context', 40, 20]]),
            'context menu not called exactly once');
        assert(lookupCount === 1 && queryCount === 1, 'duplicate detection');
    }],
    ['first left double click survives a pending lookup with copied coordinates', async () => {
        const {icon, calls} = makeIcon();
        const pending = deferred();
        lookup = () => pending.promise;
        const first = event(1);
        icon.vfunc_button_press_event(first);
        icon.vfunc_button_press_event(event(1, 1100));
        first.get_coords = () => {
            throw new Error('original event used after callback');
        };
        assert(lookupCount === 1 && calls.length === 0, 'lookup not shared/lazy');
        pending.resolve(123);
        await drain();
        assert(JSON.stringify(calls.filter(c => c[0] === 'open')) ===
            JSON.stringify([['open', 40, 20, 1000], ['open', 40, 20, 1100]]),
        'first click lost or reordered');
        icon.vfunc_button_press_event(event(1, 1500));
        await drain();
        assert(lookupCount === 1, 'successful detection not cached');
    }],
    ['normal DBusMenu and pending Menu properties never trigger Wine detection', () => {
        for (const path of ['/Menu', undefined]) {
            const {icon, calls} = makeIcon(path);
            icon._indicator.menuPath = path;
            assert(icon.vfunc_button_press_event(event(3)) === false, 'propagation changed');
            assert(lookupCount === 0 && calls[0][0] === 'toggle', 'normal menu changed');
        }
    }],
    ['non-Wine no-menu item retains right click and double-click activation', async () => {
        const {icon, calls} = makeIcon();
        query = () => ({get_symlink_target: () => '/usr/bin/heroic'});
        icon.vfunc_button_press_event(event(3));
        await drain();
        assert(icon._isWine === false && calls[0][0] === 'toggle', 'non-Wine fallback missing');
        icon.vfunc_button_press_event(event(1, 2000));
        icon.vfunc_button_press_event(event(1, 2100));
        assert(calls.filter(c => c[0] === 'open').length === 1, 'non-Wine double click changed');
        assert(lookupCount === 1, 'negative detection not cached');
    }],
    ['middle click bypasses Wine detection', () => {
        const {icon, calls} = makeIcon();
        assert(icon.vfunc_button_press_event(event(2)) === true, 'middle click not handled');
        assert(lookupCount === 0 && calls.some(c => c[0] === 'middle'), 'middle click changed');
    }],
    ['missing ContextMenu falls back and caches lack of support', async () => {
        const {icon, calls} = makeIcon();
        let attempts = 0;
        icon._indicator.contextMenu = () => {
            attempts++;
            throw new Gio.DBusError({code: Gio.DBusError.UNKNOWN_METHOD, message: 'missing'});
        };
        icon.vfunc_button_press_event(event(3));
        await drain();
        icon.vfunc_button_press_event(event(3, 2000));
        await drain();
        assert(attempts === 1 && calls.filter(c => c[0] === 'toggle').length === 2,
            'unsupported method called again or fallback lost');
    }],
    ['failed executable lookup stays unknown and retries on next click', async () => {
        const {icon, calls} = makeIcon();
        query = () => {
            throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.NOT_FOUND, message: 'gone'});
        };
        icon.vfunc_button_press_event(event(3));
        await drain();
        assert(icon._isWine === undefined && calls[0][0] === 'toggle', 'failure cached as false');
        query = () => ({get_symlink_target: () => '/usr/bin/wine'});
        icon.vfunc_button_press_event(event(3, 2000));
        await drain();
        assert(lookupCount === 2 && calls.some(c => c[0] === 'context'), 'retry did not work');
    }],
    ['owner reset discards pending detection and uses a new lookup', async () => {
        const {icon, calls} = makeIcon();
        const old = deferred();
        lookup = () => old.promise;
        icon.vfunc_button_press_event(event(1));
        icon._resetWineState();
        lookup = () => Promise.resolve(456);
        query = path => ({
            get_symlink_target: () =>
                path === '/proc/456/exe' ? '/usr/bin/heroic' : '/usr/bin/wine',
        });
        icon.vfunc_button_press_event(event(3, 2000));
        await drain();
        old.resolve(123);
        await drain();
        assert(icon._isWine === false, 'stale result overwrote new owner');
        assert(!calls.some(c => c[0] === 'open'), 'stale click reached new owner');
    }],
    ['menu appearing during detection uses the normal menu path', async () => {
        const {icon, calls} = makeIcon();
        const pending = deferred();
        lookup = () => pending.promise;
        icon.vfunc_button_press_event(event(3));
        icon._indicator.menuPath = '/Menu';
        pending.resolve(123);
        await drain();
        assert(calls.length === 1 && calls[0][0] === 'toggle', 'late menu ignored');
    }],
    ['destroy cancels lookup and dispatch', async () => {
        const {icon, calls} = makeIcon();
        const pending = deferred();
        lookup = () => pending.promise;
        icon.vfunc_button_press_event(event(3));
        icon._onDestroy();
        pending.resolve(123);
        await drain();
        assert(calls.length === 0 && icon._isWine === undefined, 'destroyed icon handled click');
    }],
    ['transient ContextMenu errors fall back without disabling retry', async () => {
        const {icon, calls} = makeIcon();
        icon._indicator.contextMenu = () => {
            throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.FAILED, message: 'temporary'});
        };
        icon.vfunc_button_press_event(event(3));
        await drain();
        assert(icon._hasContextMenu === undefined && calls.some(c => c[0] === 'toggle'),
            'temporary failure disabled context menu');
        icon._indicator.contextMenu = () => Promise.resolve(calls.push(['context']));
        icon.vfunc_button_press_event(event(3, 2000));
        await drain();
        assert(calls.some(c => c[0] === 'context'), 'temporary error was not retried');
    }],
    ['owner reset while ContextMenu is pending discards old errors', async () => {
        const {icon, calls} = makeIcon();
        const pending = deferred();
        icon._indicator.contextMenu = () => pending.promise;
        icon.vfunc_button_press_event(event(3));
        await drain();
        icon._resetWineState();
        pending.reject(new Gio.DBusError({code: Gio.DBusError.UNKNOWN_METHOD, message: 'old'}));
        await drain();
        assert(icon._hasContextMenu === undefined, 'old error poisoned new owner');
        assert(!calls.some(c => c[0] === 'toggle'), 'stale failure opened a menu');
    }],
    ['real Gio can read the executable symlink asynchronously', async () => {
        Gio._promisify(Gio.File.prototype, 'query_info_async');
        const info = await Gio.File.new_for_path('/proc/self/exe').query_info_async(
            Gio.FILE_ATTRIBUTE_STANDARD_SYMLINK_TARGET, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT, null);
        assert(info.get_symlink_target()?.startsWith('/'), 'real symlink query failed');
    }],
];

print(`1..${tests.length}`);
let failures = 0;
for (let i = 0; i < tests.length; i++) {
    const [name, test] = tests[i];
    try {
        // Tests share the Shell stubs and must finish before the next fixture is set up.
        // eslint-disable-next-line no-await-in-loop
        await test();
        assert(errors.length === 0, `unexpected async error: ${errors[0]}`);
        print(`ok ${i + 1} - ${name}`);
    } catch (e) {
        failures++;
        print(`not ok ${i + 1} - ${name}\n# ${e.stack ?? e}`);
    }
}
System.exit(failures ? 1 : 0);
