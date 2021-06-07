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

const Extension = ExtensionUtils.getCurrentExtension();
const IndicatorStatusIcon = Extension.imports.indicatorStatusIcon;

var tray = null;
let icons = [];

function initTopIcons() {
    createTray();
}

function finTopIcons() {
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
