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

let settingsManager;

export class SettingsManager {
    static initialize(extension) {
        SettingsManager._settingsManager = new SettingsManager(extension);
    }

    static destroy() {
        SettingsManager._settingsManager.destroy();
        SettingsManager._settingsManager = null;
    }

    static getDefault() {
        return this._settingsManager;
    }

    get gsettings() {
        return this._gsettings;
    }

    constructor(extension) {
        if (settingsManager)
            throw new Error('SettingsManager is already constructed');

        this._gsettings = extension.getSettings();
    }

    destroy() {
        this._gsettings = null;
    }
}

export function getDefault() {
    return SettingsManager.getDefault();
}

export function getDefaultGSettings() {
    return SettingsManager.getDefault().gsettings;
}
