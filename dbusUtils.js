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

import {Logger} from './logger.js';

export const BUS_ADDRESS_REGEX = /([a-zA-Z0-9._-]+\.[a-zA-Z0-9.-]+)|(:[0-9]+\.[0-9]+)$/;

Gio._promisify(Gio.DBusConnection.prototype, 'call');

export async function getUniqueBusName(bus, name, cancellable) {
    if (name[0] === ':')
        return name;

    if (!bus)
        bus = Gio.DBus.session;

    const variantName = new GLib.Variant('(s)', [name]);
    const [unique] = (await bus.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus',
        'GetNameOwner', variantName, new GLib.VariantType('(s)'),
        Gio.DBusCallFlags.NONE, -1, cancellable)).deep_unpack();

    return unique;
}

export async function getBusNames(bus, cancellable) {
    if (!bus)
        bus = Gio.DBus.session;

    const [names] = (await bus.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus',
        'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE,
        -1, cancellable)).deep_unpack();

    const uniqueNames = new Map();
    const requests = names.map(name => getUniqueBusName(bus, name, cancellable));
    const results = await Promise.allSettled(requests);

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
            let namesForBus = uniqueNames.get(result.value);
            if (!namesForBus) {
                namesForBus = new Set();
                uniqueNames.set(result.value, namesForBus);
            }
            if (result.value !== names[i])
                namesForBus.add(names[i]);
        } else if (!result.reason.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            Logger.debug(`Impossible to get the unique name of ${names[i]}: ${result.reason}`);
        }
    }

    return uniqueNames;
}

async function getProcessId(connectionName, cancellable = null, bus = Gio.DBus.session) {
    const res = await bus.call('org.freedesktop.DBus', '/',
        'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
        new GLib.Variant('(s)', [connectionName]),
        new GLib.VariantType('(u)'),
        Gio.DBusCallFlags.NONE,
        -1,
        cancellable);
    const [pid] = res.deepUnpack();
    return pid;
}

export async function getProcessName(connectionName, cancellable = null,
    priority = GLib.PRIORITY_DEFAULT, bus = Gio.DBus.session) {
    const pid = await getProcessId(connectionName, cancellable, bus);
    const cmdFile = Gio.File.new_for_path(`/proc/${pid}/cmdline`);
    const inputStream = await cmdFile.read_async(priority, cancellable);
    const bytes = await inputStream.read_bytes_async(2048, priority, cancellable);
    const textDecoder = new TextDecoder();
    return textDecoder.decode(bytes.toArray().map(v => !v ? 0x20 : v));
}

export async function* introspectBusObject(bus, name, cancellable,
    interfaces = undefined, path = undefined) {
    if (!path)
        path = '/';

    const [introspection] = (await bus.call(name, path, 'org.freedesktop.DBus.Introspectable',
        'Introspect', null, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE,
        5000, cancellable)).deep_unpack();

    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(introspection);

    if (!interfaces || dbusNodeImplementsInterfaces(nodeInfo, interfaces))
        yield {nodeInfo, path};

    if (path === '/')
        path = '';

    for (const subNodeInfo of nodeInfo.nodes) {
        const subPath = `${path}/${subNodeInfo.path}`;
        yield* introspectBusObject(bus, name, cancellable, interfaces, subPath);
    }
}

function dbusNodeImplementsInterfaces(nodeInfo, interfaces) {
    if (!(nodeInfo instanceof Gio.DBusNodeInfo) || !Array.isArray(interfaces))
        return false;

    return interfaces.some(iface => nodeInfo.lookup_interface(iface));
}
