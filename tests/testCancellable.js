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


import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import System from 'system';

import {CancellableChild} from '../cancellable.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function countHandlers(parent) {
    const args = [parent, GObject.SignalMatchType.ID,
        GObject.signal_lookup('cancelled', Gio.Cancellable.$gtype),
        0, null, null, null];
    const count = GObject.signal_handlers_block_matched(...args);
    const unblocked = GObject.signal_handlers_unblock_matched(...args);
    assert(unblocked === count, 'Signal census must restore all handlers');
    return count;
}

function idle() {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

const tests = [
    ['completed operations do not accumulate parent handlers', () => {
        const parent = new Gio.Cancellable();
        for (let i = 0; i < 10000; i++) {
            const child = new CancellableChild(parent);
            child.release();
        }
        assert(countHandlers(parent) === 0, 'Completed children are retained by their parent');
    }],
    ['release is idempotent and does not emit cancellation', () => {
        const parent = new Gio.Cancellable();
        const child = new CancellableChild(parent);
        assert(countHandlers(parent) === 1, 'Active child must be connected');
        child.release();
        child.release();
        parent.cancel();
        assert(!child.is_cancelled(), 'Completed child must not receive subsequent cancellation');
        assert(countHandlers(parent) === 0, 'Completed child must be disconnected');
    }],
    ['parent cancellation still reaches an active child', async () => {
        const parent = new Gio.Cancellable();
        const child = new CancellableChild(parent);
        parent.cancel();
        assert(child.is_cancelled(), 'Parent cancellation was not propagated');
        await idle();
        assert(countHandlers(parent) === 0, 'Cancelled child must detach at idle');
    }],
    ['reentrant release during parent cancellation does not deadlock', async () => {
        const parent = new Gio.Cancellable();
        const child = new CancellableChild(parent);
        const id = child.connect(() => child.release());
        parent.cancel();
        await idle();
        child.disconnect(id);
        assert(child.is_cancelled(), 'Child must be cancelled');
        assert(countHandlers(parent) === 0, 'Deferred disconnect did not complete');
    }],
    ['cancelling one child leaves its siblings attached', () => {
        const parent = new Gio.Cancellable();
        const first = new CancellableChild(parent);
        const second = new CancellableChild(parent);
        first.cancel();
        assert(first.is_cancelled(), 'Explicit cancellation was lost');
        assert(!second.is_cancelled(), 'Sibling was unexpectedly cancelled');
        assert(countHandlers(parent) === 1, 'Active sibling must remain attached');
        second.release();
        assert(countHandlers(parent) === 0, 'Sibling release failed');
    }],
    ['already-cancelled parents do not acquire a handler', () => {
        const parent = new Gio.Cancellable();
        parent.cancel();
        const child = new CancellableChild(parent);
        assert(child.is_cancelled(), 'Initial parent cancellation was lost');
        child.release();
        assert(countHandlers(parent) === 0, 'Cancelled parent acquired a handler');
    }],
    ['a child without a parent can be released and cancelled', () => {
        const child = new CancellableChild(null);
        child.release();
        child.cancel();
        child.release();
        assert(child.is_cancelled(), 'Parentless child cancellation failed');
    }],
    ['nested cancellation releases every parent connection', async () => {
        const root = new Gio.Cancellable();
        const child = new CancellableChild(root);
        const grandchild = new CancellableChild(child);
        root.cancel();
        assert(grandchild.is_cancelled(), 'Nested cancellation was lost');
        await idle();
        assert(countHandlers(root) === 0, 'Root retained its child');
        assert(countHandlers(child) === 0, 'Child retained its grandchild');
    }],
];

print(`1..${tests.length}`);
let failures = 0;
for (const [index, [name, testCase]] of tests.entries()) {
    try {
        // Tests deliberately run in sequence so deferred disconnects settle.
        // eslint-disable-next-line no-await-in-loop
        await testCase();
        print(`ok ${index + 1} - ${name}`);
    } catch (error) {
        failures++;
        print(`not ok ${index + 1} - ${name}`);
        print(`# ${error.message}`);
    }
}
System.exit(failures ? 1 : 0);
