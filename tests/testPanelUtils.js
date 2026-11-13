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


import GObject from 'gi://GObject';
import System from 'system';

import * as PanelUtils from '../panelUtils.js';

/**
 * A stand-in for Gio.Settings, emitting a real detailed GObject signal
 */
const FakeSettings = GObject.registerClass({
    Signals: {'changed': {flags: GObject.SignalFlags.RUN_LAST | GObject.SignalFlags.DETAILED}},
}, class FakeSettings extends GObject.Object {
    _init(trayPos) {
        super._init();
        this._trayPos = trayPos;
    }

    get_string() {
        return this._trayPos;
    }

    setTrayPos(trayPos) {
        this._trayPos = trayPos;
        this.emit('changed::tray-pos');
    }
});

class FakePanel {
    constructor() {
        this.statusArea = {};
        this.placements = [];
    }

    addToStatusArea(role, indicator, _position, box) {
        this.statusArea[role] = indicator;
        this.placements.push(box);
    }
}

function connect(src, signal, _target, callback) {
    return src.connect(signal, callback);
}

function assertPlacements(panel, expected) {
    const actual = panel.placements;

    if (actual.join(' ') !== expected.join(' '))
        throw new Error(`expected [${expected}], got [${actual}]`);
}

const tests = [
    ['moves the icon once for each tray-pos change', () => {
        const panel = new FakePanel();
        const settings = new FakeSettings('right');
        const expected = ['right'];

        PanelUtils.addIconToPanel(panel, settings, {uniqueId: 'test'}, connect);

        for (let i = 0; i < 10; ++i) {
            const trayPos = i % 2 ? 'right' : 'left';
            settings.setTrayPos(trayPos);
            expected.push(trayPos);
        }

        assertPlacements(panel, expected);
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
