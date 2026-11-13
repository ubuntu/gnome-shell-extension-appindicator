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


/**
 * Panel helpers with no shell imports, so that tests can load them
 */

function placeIcon(panel, settings, statusIcon) {
    const indicatorId = `appindicator-${statusIcon.uniqueId}`;

    const currentIcon = panel.statusArea[indicatorId];
    if (currentIcon) {
        if (currentIcon !== statusIcon)
            currentIcon.destroy();

        panel.statusArea[indicatorId] = null;
    }

    panel.addToStatusArea(indicatorId, statusIcon, 1,
        settings.get_string('tray-pos'));
}

export function addIconToPanel(panel, settings, statusIcon, connectSmart) {
    placeIcon(panel, settings, statusIcon);

    // Calling addIconToPanel() here would connect another handler on every change
    connectSmart(settings, 'changed::tray-pos', statusIcon, () =>
        placeIcon(panel, settings, statusIcon));
}
