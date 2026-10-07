#!/usr/bin/gjs -m
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


import System from 'system';

import * as MenuUtils from '../menuUtils.js';

/**
 * A stand-in for the St.BoxLayout backing a PopupMenu, exposing the actor
 * API that gnome-shell uses to arrange menu rows
 */
class FakeBox {
    constructor(children) {
        this._children = [...children];
    }

    get_children() {
        return [...this._children];
    }

    add_child(child) {
        this._children.push(child);
    }

    insert_child_below(child, sibling) {
        this._children.splice(this._children.indexOf(sibling), 0, child);
    }

    remove_child(child) {
        this._children.splice(this._children.indexOf(child), 1);
    }
}

class FakeMenu {
    constructor(dbusItems) {
        this.box = new FakeBox(dbusItems.map(dbusItem => ({_dbusItem: dbusItem})));
    }

    _getMenuItems() {
        return this.box.get_children();
    }
}

function assertOrder(menu, expected) {
    const actual = menu._getMenuItems().map(item => item._dbusItem);

    if (actual.join(' ') !== expected.join(' '))
        throw new Error(`expected [${expected}], got [${actual}]`);
}

const tests = [
    ['moves a row towards the front of the menu', () => {
        const menu = new FakeMenu(['first', 'second', 'third']);

        MenuUtils.moveItemInMenu(menu, 'third', 0);

        assertOrder(menu, ['third', 'first', 'second']);
    }],
    ['appends a row moved past the last one', () => {
        // rows lag behind the item list while additions are still queued
        const menu = new FakeMenu(['first', 'second']);

        MenuUtils.moveItemInMenu(menu, 'first', 2);

        assertOrder(menu, ['second', 'first']);
    }],
    ['leaves the menu alone for an item that has no row', () => {
        const menu = new FakeMenu(['first', 'second']);

        MenuUtils.moveItemInMenu(menu, 'third', 0);

        assertOrder(menu, ['first', 'second']);
    }],
];

print(`1..${tests.length}`);

let failures = 0;

tests.forEach(([name, testCase], index) => {
    try {
        testCase();
        print(`ok ${index + 1} - ${name}`);
    } catch (error) {
        failures += 1;
        print(`not ok ${index + 1} - ${name}`);
        print(`# ${error.message}`);
    }
});

System.exit(failures ? 1 : 0);
