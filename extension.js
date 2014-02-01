const Extension = imports.misc.extensionUtils.getCurrentExtension();
const StatusNotifierWatcher = Extension.imports.statusNotifierWatcher;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ExtensionSystem = imports.ui.extensionSystem;
const StatusNotifierDispatcher = Extension.imports.statusNotifierDispatcher;

let statusNotifierWatcher = null;
let isEnabled = false;
let detectExtensionsID = null;

function init() {
    NameWatchdog.init();
    NameWatchdog.onVanished = maybe_enable_after_name_available;
}

//FIXME: when entering/leaving the lock screen, the extension might be enabled/disabled rapidly.
// This will create very bad side effects in case we were not done unowning the name whil trying
// to own it again. Since g_bus_unown_name doesn't fire any callbakc when it's done, we need to 
// monitor the bus manually to find out when the name vanished so we can reclaim it again.
function maybe_enable_after_name_available() {
    // by the time we get called whe might not be enabled
    if (isEnabled && !NameWatchdog.isPresent && statusNotifierWatcher === null) {
        statusNotifierWatcher = new StatusNotifierWatcher.StatusNotifierWatcher();

    //connect to dash-to-dock extension changes. Compatibility with this extension allows
    //to place indicators in the dash-to-dock
    detectExtensionsID = ExtensionSystem.connect('extension-state-changed',
        function (obj, extension) {
            if (extension.uuid == 'dash-to-dock@micxgx.gmail.com') {
		//re-add all indicators if dash-to-dock changes its status
	        StatusNotifierDispatcher.IndicatorDispatcher.instance._settingsChanged(null,null); 
            }
        });
    }
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

        if (detectExtensionsID) {
            ExtensionSystem.disconnect(detectExtensionsID);
            detectExtensionsID = null;
	}
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
        log("appindicator: bus name appeared");
        this.isPresent = true;
        if (this.onAppeared) this.onAppeared();
    },
    
    _vanished_handler: function() {
        log("appindicator: bus name vanished");
        this.isPresent = false;
        if (this.onVanished) this.onVanished();
    }
}
