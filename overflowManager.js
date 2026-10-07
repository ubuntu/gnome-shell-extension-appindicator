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

const OVERFLOW_BUTTON_ROLE = 'appindicator-overflow';

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
        this._destroyed = false;

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
        const {uniqueId} = statusIcon;
        if (this._destroyed || this._trackedIcons.has(uniqueId))
            return;

        this._trackedIcons.set(uniqueId, statusIcon);

        // 4-arg form: the handler is dropped when the manager is destroyed
        Util.connectSmart(statusIcon, 'destroy', this, () => {
            this._trackedIcons.delete(uniqueId);
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
        const id = statusIcon.appId;
        if (!id)
            return;

        const settings = SettingsManager.getDefaultGSettings();
        const known = settings.get_value('known-indicators')
            .deep_unpack();
        const title = statusIcon.title || id;

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
        if (this._destroyed || this._updateTimeoutId)
            return;

        this._updateTimeoutId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT, () => {
                this._updateTimeoutId = 0;
                this._updateVisibility();
                return GLib.SOURCE_REMOVE;
            });
    }

    _updateVisibility() {
        if (this._destroyed)
            return;

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

            // A legacy XEmbed icon carries no SNI, but the class of its X
            // window is a stable id, so it is hidden like any other. The
            // decision does not depend on the SNI status either, so an icon
            // the app turns active again does not appear on the panel first.
            const {appId} = icon;
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
                const button = new OverflowButton();
                button.connect('destroy', () => {
                    if (this._overflowButton === button)
                        this._overflowButton = null;
                });
                this._overflowButton = button;
                this._addOverflowButtonToPanel();
            }
            this._overflowButton.updateMenu(overflowedIcons);
            this._placeOverflowButton();
        } else {
            this._overflowButton?.destroy();
        }
    }

    _addOverflowButtonToPanel() {
        if (!this._overflowButton)
            return;

        const settings = SettingsManager.getDefaultGSettings();

        // Same re-add idiom as addIconToPanel(): addToStatusArea() throws
        // if the role is still set, so clear it first
        const currentButton = Main.panel.statusArea[OVERFLOW_BUTTON_ROLE];
        if (currentButton) {
            if (currentButton !== this._overflowButton)
                currentButton.destroy();
            Main.panel.statusArea[OVERFLOW_BUTTON_ROLE] = null;
        }

        Main.panel.addToStatusArea(OVERFLOW_BUTTON_ROLE,
            this._overflowButton, -1,
            settings.get_string('tray-pos'));
    }

    // Moves the button right after the last indicator icon of its panel box.
    // Icons are always inserted at index 1, so once placed the button stays
    // after them without further moves.
    _placeOverflowButton() {
        const container = this._overflowButton?.container;
        const parent = container?.get_parent();
        if (!parent)
            return;

        const children = parent.get_children();
        let lastIconIndex = -1;
        for (const icon of this._trackedIcons.values()) {
            lastIconIndex = Math.max(lastIconIndex,
                children.indexOf(icon.container));
        }

        if (lastIconIndex < 0)
            return;

        // set_child_at_index() removes the child before inserting it again
        const currentIndex = children.indexOf(container);
        const targetIndex = currentIndex < lastIconIndex
            ? lastIconIndex : lastIconIndex + 1;
        if (currentIndex !== targetIndex)
            parent.set_child_at_index(container, targetIndex);
    }

    _onTrayPosChanged() {
        if (!this._overflowButton)
            return;

        this._addOverflowButtonToPanel();
        // Icons move to the new box in their own tray-pos handlers, place the
        // button again once all of them are done
        this._scheduleUpdate();
    }

    destroy() {
        if (this._destroyed)
            return;

        this._destroyed = true;

        // Drops all the connectSmart() handlers targeting this manager
        this.emit('destroy');

        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = 0;
        }

        this._overflowButton?.destroy();

        const settings = SettingsManager.getDefaultGSettings();
        for (const id of this._settingsChangedIds)
            settings.disconnect(id);
        this._settingsChangedIds = [];

        for (const icon of this._trackedIcons.values())
            icon.setOverflowed(false);

        this._trackedIcons.clear();
    }
}
