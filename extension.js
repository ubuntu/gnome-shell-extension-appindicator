const Extension = imports.misc.extensionUtils.getCurrentExtension();
const StatusNotifierWatcher = Extension.imports.statusNotifierWatcher;

let statusNotifierWatcher = null;

function init() {
    
}

function enable() {
    statusNotifierWatcher = new StatusNotifierWatcher.StatusNotifierWatcher();
}

function disable() {
    statusNotifierWatcher.destroy();
    statusNotifierWatcher = null;    
}
