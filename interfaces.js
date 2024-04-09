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

export let StatusNotifierItem = null;
export let StatusNotifierWatcher = null;
export let DBusMenu = null;

// loads a xml file into an in-memory string
function loadInterfaceXml(extension, filename) {
    const interfacesDir = extension.dir.get_child('interfaces-xml');
    const file = interfacesDir.get_child(filename);
    const [result, contents] = imports.gi.GLib.file_get_contents(file.get_path());

    if (result) {
        // HACK: The "" + trick is important as hell because file_get_contents returns
        // an object (WTF?) but Gio.makeProxyWrapper requires `typeof() === "string"`
        // Otherwise, it will try to check `instanceof XML` and fail miserably because there
        // is no `XML` on very recent SpiderMonkey releases (or, if SpiderMonkey is old enough,
        // will spit out a TypeError soon).
        let nodeContents = contents;
        if (contents instanceof Uint8Array)
            nodeContents = imports.byteArray.toString(contents);
        return `<node>${nodeContents}</node>`;
    } else {
        throw new Error(`AppIndicatorSupport: Could not load file: ${filename}`);
    }
}

export function initialize(extension) {
    StatusNotifierItem = loadInterfaceXml(extension, 'StatusNotifierItem.xml');
    StatusNotifierWatcher = loadInterfaceXml(extension, 'StatusNotifierWatcher.xml');
    DBusMenu = loadInterfaceXml(extension, 'DBusMenu.xml');
}

export function destroy() {
    StatusNotifierItem = null;
    StatusNotifierWatcher = null;
    DBusMenu = null;
}
