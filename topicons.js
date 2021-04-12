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

/* exported initTopIcons, finTopIcons */

const Shell = imports.gi.Shell;
const Main = imports.ui.main;
const System = imports.system;

const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const IndicatorStatusIcon = Me.imports.indicatorStatusIcon;

var tray = null;
let trayAddedId = 0;
let trayRemovedId = 0;
let icons = [];

function initTopIcons() {
    tray = Main.legacyTray;
    if (tray)
        moveToTop();
    else
        createTray();
}

function finTopIcons() {
    if (Main.legacyTray)
        moveToTray();
    else
        destroyTray();
}

function createTray() {
    tray = new Shell.TrayManager();
    tray.connect('tray-icon-added', onTrayIconAdded);
    tray.connect('tray-icon-removed', onTrayIconRemoved);

    tray.manage_screen(Main.panel);
}

function onTrayIconAdded(_tray, icon) {
    const topIcon = new IndicatorStatusIcon.IndicatorStatusTopIcon(icon);

    icon.connect('destroy', () => {
        icon.clear_effects();
        topIcon.destroy();
    });

    icon.connect('button-release-event', (actor, event) => {
        icon.click(event);
    });

    icon.reactive = true;
    icons.push(topIcon);
}

function onTrayIconRemoved(_tray, icon) {
    const index = icons.findIndex(i => i.getIcon() === icon);

    if (index === -1)
        return;

    icon.destroy();
    icons.splice(index, 1);
}

function destroyTray() {
    for (let i = 0; i < icons.length; i++)
        icons[i].destroy();

    icons = [];

    tray = null;
    System.gc(); // force finalizing tray to unmanage screen
}

function moveToTop() {

    // Replace signal handlers
    if (tray._trayIconAddedId)
        tray._trayManager.disconnect(tray._trayIconAddedId);
    if (tray._trayIconRemovedId)
        tray._trayManager.disconnect(tray._trayIconRemovedId);

    trayAddedId = tray._trayManager.connect('tray-icon-added', onTrayIconAdded);
    trayRemovedId = tray._trayManager.connect('tray-icon-removed', onTrayIconRemoved);

    // Move each tray icon to the top
    let length = tray._iconBox.get_n_children();
    for (let i = 0; i < length; i++) {
        let button = tray._iconBox.get_child_at_index(0);
        let icon = button.child;
        button.remove_actor(icon);
        button.destroy();
        // Icon already loaded, no need to delay insertion
        onTrayIconAdded(this, icon, '', 0);
    }

}

function moveToTray() {

    // Replace signal handlers
    if (trayAddedId) {
        tray._trayManager.disconnect(trayAddedId);
        trayAddedId = 0;
    }

    if (trayRemovedId) {
        tray._trayManager.disconnect(trayRemovedId);
        trayRemovedId = 0;
    }

    tray._trayIconAddedId = tray._trayManager.connect(
        'tray-icon-added', tray._onTrayIconAdded);
    tray._trayIconRemovedId = tray._trayManager.connect(
        'tray-icon-removed', tray._onTrayIconRemoved);

    // Clean and move each icon back to the Legacy Tray;
    for (let topIcon of icons) {
        let icon = topIcon.getIcon();
        tray._onTrayIconAdded(tray, icon);
        topIcon.destroy();
    }

    // Clean containers
    icons = [];
}
