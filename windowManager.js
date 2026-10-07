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

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

const WindowTracker = Shell.WindowTracker.get_default();

// Resolved apps, keyed by indicator and by tray icon
const _appCache = new WeakMap();

// Directories shared by many apps, too generic to match an app by
const GENERIC_DIRS = ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/local/bin', '/opt'];

/**
 * Toggle windows for an indicator, like a taskbar entry: minimize if the app
 * is focused, activate its windows otherwise. An app without windows (closed
 * to tray) is launched again when its running instance is known to take the
 * launch and bring its window back.
 *
 * @param {AppIndicator} indicator - the SNI indicator
 * @param {number} timestamp - event time
 * @returns {boolean} true if handled, false to fall through
 */
export function toggleWindows(indicator, timestamp) {
    return _toggleWindowsOf(findDesktopApp(indicator), timestamp,
        () => indicator.executable);
}

/**
 * Same as toggleWindows() for a legacy XEmbed tray icon.
 *
 * @param {Shell.TrayIcon} trayIcon - the legacy tray icon
 * @param {number} timestamp - event time
 * @returns {boolean} true if handled, false to forward the click to the icon
 */
export function toggleTrayIconWindows(trayIcon, timestamp) {
    return _toggleWindowsOf(findTrayIconApp(trayIcon), timestamp,
        () => _getPidExecutable(trayIcon.pid));
}

function _toggleWindowsOf(app, timestamp, getExecutable) {
    if (!app || (!app.get_windows().length && !_reopensWindow(app, getExecutable)))
        return false;

    return _toggleAppWindows(app, timestamp);
}

// An app that is closed to the tray has no window to raise. A second launch
// reaches the running instance in two cases: a D-Bus activatable app is
// activated over the bus instead of being started, and Electron hands the
// launch over through its single instance lock. The executable is only read
// when the desktop file does not answer the question.
function _reopensWindow(app, getExecutable) {
    return app.appInfo?.get_boolean('DBusActivatable') ||
        _isElectron(getExecutable());
}

/**
 * Find the app behind a legacy XEmbed tray icon, whether it has windows or
 * not. Same as findDesktopApp() for the icons that carry no SNI.
 *
 * @param {Shell.TrayIcon} trayIcon - the legacy tray icon
 * @returns {Shell.App|null} the app, if any
 */
export function findTrayIconApp(trayIcon) {
    if (!trayIcon)
        return null;

    const app = trayIcon.pid
        ? WindowTracker.get_app_from_pid(trayIcon.pid) : null;
    if (app)
        return app;

    return _cachedLookup(trayIcon, trayIcon.wm_class, () =>
        _lookupApp(_getPidExecutable(trayIcon.pid), [trayIcon.wm_class]));
}

/**
 * Find the app an indicator belongs to, whether it has windows or not. The
 * indicator resolves the app of its process itself; the lookup by executable
 * is only needed for the apps it could not identify.
 *
 * @param {AppIndicator} indicator - the SNI indicator
 * @returns {Shell.App|null} the app, if any
 */
export function findDesktopApp(indicator) {
    if (!indicator?.id)
        return null;

    const appSystem = Shell.AppSystem.get_default();
    const appId = indicator._appInfo?.get_id();
    if (appId) {
        const app = appSystem.lookup_app(appId);
        if (app)
            return app;
    }

    // The command line is read asynchronously, resolve again once it is set
    return _cachedLookup(indicator, indicator._commandLine, () =>
        _lookupApp(indicator.executable, [indicator.id, indicator.title]));
}

function _toggleAppWindows(app, timestamp) {
    const windows = app.get_windows();
    if (!windows.length) {
        app.open_new_window(-1);
        return true;
    }

    const focusedApp = WindowTracker.focusApp;
    if (focusedApp && focusedApp.get_id() === app.get_id()) {
        windows.forEach(win => win.minimize());
        return true;
    }

    const workspace = global.workspace_manager.get_active_workspace();
    for (const win of windows) {
        if (!win.is_on_all_workspaces())
            win.change_workspace(workspace);
        win.unminimize();
        app.activate_window(win, timestamp);
    }
    return true;
}

function _cachedLookup(key, cacheTag, lookup) {
    const cached = _appCache.get(key);
    if (cached && cached.tag === cacheTag)
        return cached.app;

    const app = lookup();
    _appCache.set(key, {tag: cacheTag, app});
    return app;
}

// The shell keeps indexes of the installed desktop files, which answer the
// same question without walking them all
function _lookupByName(name) {
    if (!name)
        return null;

    const appSystem = Shell.AppSystem.get_default();
    return appSystem.lookup_startup_wmclass(name) ??
        appSystem.lookup_desktop_wmclass(name) ?? null;
}

// Scores installed apps: same executable, then StartupWMClass or desktop id
// equal to one of the names, then an app specific install directory
function _lookupApp(exe, names) {
    const appSystem = Shell.AppSystem.get_default();
    const exeBasename = exe ? GLib.path_get_basename(exe) : null;

    for (const name of [...names, exeBasename]) {
        const app = _lookupByName(name);
        if (app)
            return app;
    }

    if (exeBasename) {
        const app = appSystem.lookup_heuristic_basename(exeBasename);
        if (app)
            return app;
    }

    const lowerNames = [exeBasename, ...names]
        .filter(n => n).map(n => n.toLowerCase());
    const exeDir = exe ? GLib.path_get_dirname(exe) : null;
    const matchDir = exeDir && !GENERIC_DIRS.includes(exeDir);

    let best = null;
    let bestScore = 0;
    for (const info of appSystem.get_installed()) {
        const commandLine = info.get_commandline() || '';
        const wmClass = info.get_startup_wm_class()?.toLowerCase();
        const desktopId = info.get_id()?.toLowerCase().replace(/\.desktop$/, '');
        let score = 0;

        if (exe && commandLine.split(/\s+/).includes(exe))
            score = 3;
        else if ((wmClass && lowerNames.includes(wmClass)) ||
                 (desktopId && lowerNames.includes(desktopId)))
            score = 2;
        else if (matchDir && commandLine.includes(`${exeDir}/`))
            score = 1;

        if (score > bestScore) {
            const app = appSystem.lookup_app(info.get_id());
            if (app) {
                best = app;
                bestScore = score;

                if (bestScore === 3)
                    break;
            }
        }
    }

    return best;
}

function _getPidExecutable(pid) {
    if (!pid)
        return null;

    try {
        return GLib.file_read_link(`/proc/${pid}/exe`);
    } catch (e) {
        return null;
    }
}

const _electronPaths = new Map();

function _isElectron(exe) {
    if (!exe || !GLib.path_is_absolute(exe))
        return false;

    const dir = GLib.path_get_dirname(exe);
    let isElectron = _electronPaths.get(dir);

    if (isElectron === undefined) {
        isElectron =
            GLib.file_test(`${dir}/chrome_crashpad_handler`, GLib.FileTest.EXISTS) ||
            GLib.file_test(`${dir}/resources/app.asar`, GLib.FileTest.EXISTS);
        _electronPaths.set(dir, isElectron);
    }

    return isElectron;
}
