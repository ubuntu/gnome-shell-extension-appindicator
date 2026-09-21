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

import Shell from 'gi://Shell';

const WindowTracker = Shell.WindowTracker.get_default();

/**
 * Toggle windows for an indicator: activate if not focused,
 * minimize if focused, or fall through if no windows found.
 *
 * @param {AppIndicator} indicator - the SNI indicator
 * @returns {boolean} true if handled, false to fall through
 */
export function toggleWindows(indicator) {
    const app = _findApp(indicator);
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
        app.activate_window(
            win, global.get_current_time());
    }
    return true;
}

function _findApp(indicator) {
    if (!indicator?.id)
        return null;

    const appSystem = Shell.AppSystem.get_default();
    const id = indicator.id.toLowerCase();
    const title = indicator.title?.toLowerCase();
    const cmdLine = indicator._commandLine?.toLowerCase();

    // Try direct desktop-file lookup
    for (const suffix of ['', '.desktop']) {
        const app = appSystem.lookup_app(indicator.id + suffix);
        if (app?.get_windows().length)
            return app;
    }

    // Match by command line first (reliable for Electron apps sharing same SNI ID)
    if (cmdLine) {
        for (const app of appSystem.get_running()) {
            if (!app.get_windows().length)
                continue;

            const appId = app.get_id()?.toLowerCase().replace('.desktop', '');
            if (appId && cmdLine.includes(appId))
                return app;
        }
    }

    // Match by wm_class among running apps
    for (const app of appSystem.get_running()) {
        const windows = app.get_windows();
        if (!windows.length)
            continue;

        const wmClass = windows[0].get_wm_class()?.toLowerCase();
        const appId = app.get_id()?.toLowerCase();

        if (wmClass && id && (wmClass.includes(id) || id.includes(wmClass)))
            return app;
        if (wmClass && title && (wmClass.includes(title) || title.includes(wmClass)))
            return app;
        if (appId && id && appId.includes(id))
            return app;

        // Match command line against wm_class
        if (wmClass && cmdLine && cmdLine.includes(wmClass))
            return app;
    }

    return null;
}
