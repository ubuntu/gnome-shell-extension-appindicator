#!/usr/bin/env gjs -m

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';

import * as DBusUtils from '../dbusUtils.js';

async function seekStatusNotifierItems() {
    // Some indicators (*coff*, dropbox, *coff*) do not re-register again
    // when the plugin is enabled/disabled, thus we need to manually look
    // for the objects in the session bus that implements the StatusNotifierItem
    // interface...
    const cancellable = null;
    const bus = Gio.DBus.session;
    const uniqueNames = await DBusUtils.getBusNames(bus, cancellable);

    const stdErrOutputStream = new GioUnix.OutputStream({fd: 1, closeFd: true});
    const introspectName = async name => {
        const nodes = DBusUtils.introspectBusObject(bus, name, cancellable,
            ['org.kde.StatusNotifierItem']);
        const services = [...uniqueNames.get(name)];

        for await (const node of nodes) {
            const {path} = node;
            stdErrOutputStream.write(`${JSON.stringify({services, name, path})}\n`,
                cancellable);
        }
    };
    await Promise.allSettled([...uniqueNames.keys()].map(n => introspectName(n)));
}

function main(_argv) {
    const loop = new GLib.MainLoop(null, false);

    let exitCode = 0;
    seekStatusNotifierItems().catch(e => {
        logError(e);
        exitCode = 1;
    }).finally(() => loop.quit());
    loop.run();

    return exitCode;
}

imports.system.exit(main(ARGV));
