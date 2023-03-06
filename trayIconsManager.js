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
const SettingsManager = Extension.imports.settingsManager;

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

        this._changedId = SettingsManager.getDefaultGSettings().connect(
            'changed::legacy-tray-enabled', () => this._toggle());

        this._toggle();
    }

    _toggle() {
        if (SettingsManager.getDefaultGSettings().get_boolean('legacy-tray-enabled'))
            this._enable();
        else
            this._disable();
    }

    _enable() {
        if (this._tray)
            return;

        this._tray = new Shell.TrayManager();
        Util.connectSmart(this._tray, 'tray-icon-added', this, this.onTrayIconAdded);
        Util.connectSmart(this._tray, 'tray-icon-removed', this, this.onTrayIconRemoved);

        this._tray.manage_screen(Main.panel);
    }

    _disable() {
        if (!this._tray)
            return;

        IndicatorStatusIcon.getTrayIcons().forEach(i => i.destroy());
        if (this._tray.unmanage_screen) {
            this._tray.unmanage_screen();
            this._tray = null;
        } else {
            // FIXME: This is very ugly, but it's needed by old shell versions
            this._tray = null;
            imports.system.gc(); // force finalizing tray to unmanage screen
        }
    }

    onTrayIconAdded(_tray, icon) {
        const trayIcon = new IndicatorStatusIcon.IndicatorStatusTrayIcon(icon);
        IndicatorStatusIcon.addIconToPanel(trayIcon);
    }

    onTrayIconRemoved(_tray, icon) {
        try {
            const [trayIcon] = IndicatorStatusIcon.getTrayIcons().filter(i => i.icon === icon);
            trayIcon.destroy();
        } catch (e) {
            Util.Logger.warning(`No icon container found for ${icon.title} (${icon})`);
        }
    }

    destroy() {
        this.emit('destroy');
        SettingsManager.getDefaultGSettings().disconnect(this._changedId);
        this._disable();
        trayIconsManager = null;
    }
};
Signals.addSignalMethods(TrayIconsManager.prototype);
