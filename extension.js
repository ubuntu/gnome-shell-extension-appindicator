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
const Gio = imports.gi.Gio
const GLib = imports.gi.GLib

const Extension = imports.misc.extensionUtils.getCurrentExtension()

const StatusNotifierWatcher = Extension.imports.statusNotifierWatcher
const Util = Extension.imports.util

let statusNotifierWatcher = null;
let isEnabled = false;

function init() {
    NameWatchdog.init();
    NameWatchdog.onVanished = maybe_enable_after_name_available;

    //HACK: we want to leave the watchdog alive when disabling the extension,
    // but if we are being reloaded, we destroy it since it could be considered
    // a leak and spams our log, too.
    if (typeof global['--appindicator-extension-on-reload'] == 'function')
        global['--appindicator-extension-on-reload']()

    global['--appindicator-extension-on-reload'] = function() {
        Util.Logger.debug("Reload detected, destroying old watchdog")
        NameWatchdog.destroy()
    }
}

//FIXME: when entering/leaving the lock screen, the extension might be enabled/disabled rapidly.
// This will create very bad side effects in case we were not done unowning the name while trying
// to own it again. Since g_bus_unown_name doesn't fire any callback when it's done, we need to
// monitor the bus manually to find out when the name vanished so we can reclaim it again.
function maybe_enable_after_name_available() {
    // by the time we get called whe might not be enabled
    if (isEnabled && !NameWatchdog.isPresent && statusNotifierWatcher === null)
        statusNotifierWatcher = new StatusNotifierWatcher.StatusNotifierWatcher();
}

function enable() {
    isEnabled = true;
    maybe_enable_after_name_available();
}

function disable() {
    isEnabled = false;
    if (statusNotifierWatcher !== null) {
        statusNotifierWatcher.destroy();
        statusNotifierWatcher = null;
    }
}

/**
 * NameWatchdog will monitor the ork.kde.StatusNotifierWatcher bus name for us
 */
const NameWatchdog = {
    onAppeared: null,
    onVanished: null,

    _watcher_id: null,

    isPresent: false, //will be set in the handlers which are guaranteed to be called at least once

    init: function() {
        this._watcher_id = Gio.DBus.session.watch_name("org.kde.StatusNotifierWatcher", 0,
            this._appeared_handler.bind(this), this._vanished_handler.bind(this));
    },

    destroy: function() {
        Gio.DBus.session.unwatch_name(this._watcher_id);
    },

    _appeared_handler: function() {
        this.isPresent = true;
        if (this.onAppeared) this.onAppeared();
    },

    _vanished_handler: function() {
        this.isPresent = false;
        if (this.onVanished) this.onVanished();
    }
}
