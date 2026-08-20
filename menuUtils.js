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
 * Utility functions not necessarily belonging into the item factory
 */

export function moveItemInMenu(menu, dbusItem, newpos) {
    // HACK: we're really getting into the internals of the PopupMenu implementation

    // First, find our wrapper. Children tend to lie. We do not trust the old positioning.
    const family = menu._getMenuItems();
    for (let i = 0; i < family.length; ++i) {
        if (family[i]._dbusItem === dbusItem) {
            // now, remove it
            menu.box.remove_child(family[i]);

            // and add it again somewhere else
            if (newpos < family.length && family[newpos] !== family[i])
                menu.box.insert_child_below(family[i], family[newpos]);
            else
                menu.box.add_child(family[i]);

            // skip the rest
            return;
        }
    }
}
