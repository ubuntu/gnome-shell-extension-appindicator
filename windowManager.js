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
 * Toggle windows for an indicator: activate if not focused,
 * minimize if focused, or fall through if no windows found.
 *
 * @param {AppIndicator} indicator - the SNI indicator
 * @returns {boolean} true if handled, false to fall through
 */
export function toggleWindows(indicator) {
    const app = findDesktopApp(indicator);
    if (!app)
        return false;

    const windows = app.get_windows();
    if (!windows.length)
        return false;

    const focusedApp = WindowTracker.focusApp;
    if (focusedApp && focusedApp.get_id() === app.get_id()) {
        for (const win of windows)
            win.minimize();
        return true;
    }

    for (const win of windows) {
        win.unminimize();
        app.activate_window(win, global.get_current_time());
    }
    return true;
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
