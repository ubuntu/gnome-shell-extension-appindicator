const Extension = imports.misc.extensionUtils.getCurrentExtension();
const StatusNotifierWatcher = Extension.imports.statusNotifierWatcher;
const GLib = imports.gi.GLib;

let statusNotifierWatcher = null;
let wasEverEnabled = false;

function init() {
    
}

function do_enable() {
    log("appindicator: enabling extension");
    statusNotifierWatcher = new StatusNotifierWatcher.StatusNotifierWatcher();
}

function do_disable() {
    log("appindicator: disabling extension");
    statusNotifierWatcher.destroy();
    statusNotifierWatcher = null;    
}

//HACK: while entering the lock screen, the extension will be enabled and disabled multiple times rapidly.
// this causes the own_name stuff to disintegrate, so we need to make sure we do not toggle the extension too often.
// however, this will cause a slight delay at initialization.
var debounced_executor = debounce_func(function(func) {
    func();    
});

function enable() {
    if (wasEverEnabled) {
        debounced_executor(do_enable);
    } else {
        wasEverEnabled = true;
        do_enable();
    }
}

function disable() {
    debounced_executor(do_disable);
}

function debounce_func(func) {
    var timeout;
    
    return function() {
        var self = this;
        var args = arguments;
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(function() {
            timeout = null;
            func.apply(self, args);
        }, 500);
    }
}

var setTimeout = function(cb, time) {
       return GLib.timeout_add(GLib.PRIORITY_DEFAULT, time, function() {
          cb();
          return false;
      }, null, null);
}
var clearTimeout = GLib.source_remove;