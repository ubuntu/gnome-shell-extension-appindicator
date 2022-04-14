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

/* exported init, enable, disable */

const Extension = imports.misc.extensionUtils.getCurrentExtension();

const StatusNotifierWatcher = Extension.imports.statusNotifierWatcher;
const TrayIconsManager = Extension.imports.trayIconsManager;
const Util = Extension.imports.util;

let statusNotifierWatcher = null;
let isEnabled = false;
let watchDog = null;

function init() {
    watchDog = new Util.NameWatcher(StatusNotifierWatcher.WATCHER_BUS_NAME);
    watchDog.connect('vanished', () => maybeEnableAfterNameAvailable());

    // HACK: we want to leave the watchdog alive when disabling the extension,
    // but if we are being reloaded, we destroy it since it could be considered
    // a leak and spams our log, too.
    /* eslint-disable no-undef */
    if (typeof global['--appindicator-extension-on-reload'] === 'function')
        global['--appindicator-extension-on-reload']();

    global['--appindicator-extension-on-reload'] = () => {
        Util.Logger.debug('Reload detected, destroying old watchdog');
        watchDog.destroy();
    };
    /* eslint-enable no-undef */
}

// FIXME: when entering/leaving the lock screen, the extension might be enabled/disabled rapidly.
// This will create very bad side effects in case we were not done unowning the name while trying
// to own it again. Since g_bus_unown_name doesn't fire any callback when it's done, we need to
// monitor the bus manually to find out when the name vanished so we can reclaim it again.
function maybeEnableAfterNameAvailable() {
    // by the time we get called whe might not be enabled
    if (isEnabled && (!watchDog.nameAcquired || !watchDog.nameOnBus) && statusNotifierWatcher === null)
        statusNotifierWatcher = new StatusNotifierWatcher.StatusNotifierWatcher(watchDog);
}

function enable() {
    isEnabled = true;
    Util.tryCleanupOldIndicators();
    maybeEnableAfterNameAvailable();
    TrayIconsManager.TrayIconsManager.initialize();
}

function disable() {
    isEnabled = false;
    TrayIconsManager.TrayIconsManager.destroy();
    if (statusNotifierWatcher !== null) {
        statusNotifierWatcher.destroy();
        statusNotifierWatcher = null;
    }
}
