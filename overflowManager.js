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
import * as StatusIcon from './indicatorStatusIcon.js';
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

        if (statusIcon._indicator) {
            Util.connectSmart(statusIcon._indicator, 'ready',
                this, () => {
                    this._recordKnownIndicator(statusIcon);
                    this._scheduleUpdate();
                    // Re-check after commandLine loads (needed for
                    // Electron apps sharing chrome_status_icon_1 ID)
                    this._scheduleDelayedUpdate();
                });
            Util.connectSmart(statusIcon._indicator, 'status',
                this, () => this._scheduleUpdate());
        }

        this._recordKnownIndicator(statusIcon);
        this._scheduleUpdate();
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

    _scheduleDelayedUpdate() {
        if (this._delayedUpdateId)
            return;

        // Re-check after 3s — gives time for _commandLine to load
        this._delayedUpdateId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 3000, () => {
                this._delayedUpdateId = 0;
                // Re-record known indicators with resolved appIds
                for (const icon of this._trackedIcons.values())
                    this._recordKnownIndicator(icon);
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

        // Active icons: ready and not PASSIVE
        const activeIcons = allIcons.filter(icon =>
            icon._indicator &&
            icon._indicator.isReady &&
            icon._indicator.status !== SNIStatus.PASSIVE
        );

        const visibleIcons = activeIcons.filter(icon =>
            !icon._indicator.appId ||
            !hiddenIds.includes(icon._indicator.appId)
        );

        const hiddenIcons = activeIcons.filter(icon =>
            icon._indicator.appId &&
            hiddenIds.includes(icon._indicator.appId)
        );

        // Visible icons — shown on panel
        for (const icon of visibleIcons)
            icon.setOverflowed(false);

        // Hidden icons — go to overflow
        const overflowedIcons = [];
        for (const icon of hiddenIcons) {
            icon.setOverflowed(true);
            overflowedIcons.push(icon);
        }

        // Inactive icons — not overflowed (own logic hides them)
        const inactiveIcons = allIcons.filter(icon =>
            !activeIcons.includes(icon)
        );
        for (const icon of inactiveIcons)
            icon.setOverflowed(false);

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

        this._overflowButton._appIndicatorOwned = true;

        // Patch menuManager to skip hover-switching for overflow button
        if (this._overflowButton.menu) {
            StatusIcon.patchMenuManager();
            this._overflowButton.menu.connect('open-state-changed',
                (_m, isOpen) => { StatusIcon.setTrayMenuOpen(isOpen); });
        }
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

        if (this._delayedUpdateId) {
            GLib.source_remove(this._delayedUpdateId);
            this._delayedUpdateId = 0;
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
