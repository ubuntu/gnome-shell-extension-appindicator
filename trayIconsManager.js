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

/* exported TrayIconsManager */

const Shell = imports.gi.Shell;
const Main = imports.ui.main;
const Signals = imports.signals;

const ExtensionUtils = imports.misc.extensionUtils;

const Extension = ExtensionUtils.getCurrentExtension();
const IndicatorStatusIcon = Extension.imports.indicatorStatusIcon;
const Util = Extension.imports.util;

let trayIconsManager;

var TrayIconsManager = class TrayIconsManager {
    static initialize() {
        if (!trayIconsManager)
            trayIconsManager = new TrayIconsManager();
        return trayIconsManager;
    }

    static destroy() {
        trayIconsManager.destroy();
    }

    constructor() {
        if (trayIconsManager)
            throw new Error('TrayIconsManager is already constructed');

        this._tray = new Shell.TrayManager();
        Util.connectSmart(this._tray, 'tray-icon-added', this, this.onTrayIconAdded);
        Util.connectSmart(this._tray, 'tray-icon-removed', this, this.onTrayIconRemoved);

        this._tray.manage_screen(Main.panel);
        this._icons = [];
    }

    onTrayIconAdded(_tray, icon) {
        const trayIcon = new IndicatorStatusIcon.IndicatorStatusTrayIcon(icon);
        this._icons.push(trayIcon);
        trayIcon.connect('destroy', () =>
            this._icons.splice(this._icons.indexOf(trayIcon), 1));
    }

    onTrayIconRemoved(_tray, icon) {
        icon.destroy();
    }

    destroy() {
        this.emit('destroy');
        this._icons.forEach(i => i.destroy());
        if (this._tray.unmanage_screen) {
            this._tray.unmanage_screen();
            this._tray = null;
        } else {
            // FIXME: This is very ugly, but it's needed by old shell versions
            this._tray = null;
            imports.system.gc(); // force finalizing tray to unmanage screen
        }
        trayIconsManager = null;
    }
};
Signals.addSignalMethods(TrayIconsManager.prototype);
