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

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {SNIStatus} from './appIndicator.js';
import {OverflowButton} from './overflowButton.js';
import * as SettingsManager from './settingsManager.js';
import * as Util from './util.js';

let overflowManager;

export class OverflowManager extends Signals.EventEmitter {
    static initialize() {
        if (!overflowManager)
            overflowManager = new OverflowManager();
        return overflowManager;
    }

    static destroy() {
        if (overflowManager) {
            overflowManager.destroy();
            overflowManager = null;
        }
    }

    static getDefault() {
        return overflowManager;
    }

    constructor() {
        super();

        if (overflowManager)
            throw new Error('OverflowManager is already constructed');

        this._trackedIcons = new Map();
        this._overflowButton = null;
        this._updateTimeoutId = 0;

        const settings = SettingsManager.getDefaultGSettings();
        this._settingsChangedIds = [
            settings.connect('changed::pin-mode-enabled',
                () => this._scheduleUpdate()),
            settings.connect('changed::hidden-icons',
                () => this._scheduleUpdate()),
            settings.connect('changed::tray-pos',
                () => this._onTrayPosChanged()),
        ];
    }

    registerIcon(statusIcon) {
        if (this._trackedIcons.has(statusIcon.uniqueId))
            return;

        this._trackedIcons.set(statusIcon.uniqueId, statusIcon);

        statusIcon.connect('destroy', () => {
            this._trackedIcons.delete(statusIcon.uniqueId);
            this._scheduleUpdate();
        });

        const refresh = () => {
            this._recordKnownIndicator(statusIcon);
            this._scheduleUpdate();
        };

        if (statusIcon._indicator) {
            // The appId of apps with an unstable SNI id (Electron, Go systray)
            // is only known once the app behind the process is resolved
            ['ready', 'app-info'].forEach(signal =>
                Util.connectSmart(statusIcon._indicator, signal, this, refresh));
            Util.connectSmart(statusIcon._indicator, 'status',
                this, () => this._scheduleUpdate());
        }

        refresh();
    }

    hideIcon(indicatorId) {
        const settings = SettingsManager.getDefaultGSettings();
        const hidden = settings.get_strv('hidden-icons');
        if (!hidden.includes(indicatorId)) {
            hidden.push(indicatorId);
            settings.set_strv('hidden-icons', hidden);
        }
    }

    unhideIcon(indicatorId) {
        const settings = SettingsManager.getDefaultGSettings();
        const hidden = settings.get_strv('hidden-icons');
        const filtered =
            hidden.filter(id => id !== indicatorId);
        if (filtered.length !== hidden.length)
            settings.set_strv('hidden-icons', filtered);
    }

    isHidden(indicatorId) {
        const settings = SettingsManager.getDefaultGSettings();
        return settings.get_strv('hidden-icons')
            .includes(indicatorId);
    }

    _recordKnownIndicator(statusIcon) {
        const indicator = statusIcon._indicator;
        if (!indicator?.appId)
            return;

        const settings = SettingsManager.getDefaultGSettings();
        const known = settings.get_value('known-indicators')
            .deep_unpack();
        const id = indicator.appId;
        const title = indicator.title || indicator.id || id;

        const idx = known.findIndex(pair => pair[0] === id);
        if (idx >= 0) {
            if (known[idx][1] === title)
                return;
            known[idx][1] = title;
        } else {
            known.push([id, title]);
        }

        settings.set_value('known-indicators',
            new GLib.Variant('a(ss)', known));
    }

    _scheduleUpdate() {
        if (this._updateTimeoutId)
            return;

        this._updateTimeoutId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT, () => {
                this._updateTimeoutId = 0;
                this._updateVisibility();
                return GLib.SOURCE_REMOVE;
            });
    }

    _updateVisibility() {
        const settings = SettingsManager.getDefaultGSettings();
        const pinMode =
            settings.get_boolean('pin-mode-enabled');

        const allIcons = [...this._trackedIcons.values()];

        // Classic mode: show everything, no overflow
        if (!pinMode) {
            for (const icon of allIcons)
                icon.setOverflowed(false);
            this._updateOverflowButton([]);
            return;
        }

        // Hide mode: all visible by default, hidden go to overflow
        const hiddenIds = settings.get_strv('hidden-icons');
        const overflowedIcons = [];

        for (const icon of allIcons) {
            const indicator = icon._indicator;

            // An icon whose appId is not final yet stays off the panel: it
            // may well be a hidden one, and showing it until the id arrives
            // makes it flash. It is kept out of the overflow menu too, as its
            // entry would carry the name and icon of an unidentified app.
            if (indicator?.appIdPending) {
                icon.setOverflowed(true);
                continue;
            }

            // The decision does not depend on the SNI status, so an icon the
            // app turns active again does not appear on the panel first
            const appId = indicator?.appId;
            const hidden = !!appId && hiddenIds.includes(appId);
            icon.setOverflowed(hidden);

            // Only the icons the app currently shows belong in the menu
            if (hidden && icon.isReady() &&
                indicator?.status !== SNIStatus.PASSIVE)
                overflowedIcons.push(icon);
        }

        this._updateOverflowButton(overflowedIcons);
    }

    _updateOverflowButton(overflowedIcons) {
        if (overflowedIcons.length > 0) {
            if (!this._overflowButton) {
                this._overflowButton = new OverflowButton();
                this._addOverflowButtonToPanel();
            }
            this._overflowButton.updateMenu(overflowedIcons);
        } else if (this._overflowButton) {
            this._overflowButton.destroy();
            this._overflowButton = null;
        }
    }

    _addOverflowButtonToPanel() {
        if (!this._overflowButton)
            return;

        const settings = SettingsManager.getDefaultGSettings();
        const indicatorId = 'appindicator-overflow';

        const currentButton =
            Main.panel.statusArea[indicatorId];
        if (currentButton) {
            if (currentButton !== this._overflowButton)
                currentButton.destroy();
            Main.panel.statusArea[indicatorId] = null;
        }

        Main.panel.addToStatusArea(indicatorId,
            this._overflowButton, -1,
            settings.get_string('tray-pos'));

    }

    _onTrayPosChanged() {
        if (this._overflowButton)
            this._addOverflowButtonToPanel();
    }

    destroy() {
        this.emit('destroy');

        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = 0;
        }

        if (this._overflowButton) {
            this._overflowButton.destroy();
            this._overflowButton = null;
        }

        const settings = SettingsManager.getDefaultGSettings();
        for (const id of this._settingsChangedIds)
            settings.disconnect(id);
        this._settingsChangedIds = [];

        for (const icon of this._trackedIcons.values())
            icon.setOverflowed(false);

        this._trackedIcons.clear();
    }
}
