/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// A collection of DBus interface declarations
//
// Scraped from various tarballs or aquired using debugging tools

const StatusNotifierItem = loadInterfaceXml("StatusNotifierItem.xml")
const Properties = loadInterfaceXml("Properties.xml")
const DBusMenu = loadInterfaceXml("DBusMenu.xml")
const StatusNotifierWatcher = loadInterfaceXml("StatusNotifierWatcher.xml")

// loads a xml file into an in-memory string
function loadInterfaceXml(filename) {
    let extension = imports.misc.extensionUtils.getCurrentExtension()

    let interfaces_dir = extension.dir.get_child("interfaces-xml")

    let file = interfaces_dir.get_child(filename)

    let [ result, contents ] = imports.gi.GLib.file_get_contents(file.get_path())

    if (result) {
        //HACK: The "" + trick is important as hell because file_get_contents returns
        // an object (WTF?) but Gio.makeProxyWrapper requires `typeof() == "string"`
        // Otherwise, it will try to check `instanceof XML` and fail miserably because there
        // is no `XML` on very recent SpiderMonkey releases (or, if SpiderMonkey is old enough,
        // will spit out a TypeError soon).
        return "<node>" + contents + "</node>"
    } else {
        throw new Error("AppIndicatorSupport: Could not load file: "+filename)
    }
}
