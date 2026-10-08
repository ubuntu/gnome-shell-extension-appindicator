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

export const CancellableChild = GObject.registerClass({
    Properties: {
        'parent': GObject.ParamSpec.object(
            'parent', 'parent', 'parent',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            Gio.Cancellable.$gtype),
    },
},
class CancellableChild extends Gio.Cancellable {
    _init(parent) {
        if (parent && !(parent instanceof Gio.Cancellable))
            throw TypeError('Not a valid cancellable');

        super._init({parent});

        if (parent) {
            if (parent.is_cancelled()) {
                this.cancel();
                return;
            }

            this._connectToParent();
        }
    }

    _connectToParent() {
        this._connectId = this.parent.connect(() => {
            // Gio.Cancellable.disconnect() must not run inside its callback.
            // Set the guard before emitting cancellation on the child, since
            // that can synchronously release or cancel this object again.
            if (!this._disconnectIdle) {
                this._disconnectIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    delete this._disconnectIdle;
                    this._disconnectFromParent();
                    return GLib.SOURCE_REMOVE;
                });
            }
            this._realCancel();
        });
    }

    _disconnectFromParent() {
        if (this._connectId && !this._disconnectIdle) {
            this.parent.disconnect(this._connectId);
            delete this._connectId;
        }
    }

    _realCancel() {
        Gio.Cancellable.prototype.cancel.call(this);
    }

    // End an operation's ownership without cancelling a completed operation.
    // The parent's signal closure otherwise keeps every completed child alive.
    release() {
        this._disconnectFromParent();
    }

    cancel() {
        this._disconnectFromParent();
        this._realCancel();
    }
});
