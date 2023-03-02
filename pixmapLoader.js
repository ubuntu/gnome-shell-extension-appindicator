#!/usr/bin/env gjs

const { GLib, Gio } = imports.gi;
const { byteArray: ByteArray } = imports;

const currentPath = GLib.path_get_dirname(new Error().fileName);
imports.searchPath.unshift(currentPath);

const { pixmapsUtils: PixmapsUtils } = imports;

function main(argv) {
    if (argv.length < 4) {
        const currentBinary = GLib.path_get_basename(new Error().fileName);
        printerr(`Usage: ${currentBinary} bus-name path property preferred-size output-fd`);
        return 1;
    }

    const [busName, path, property, preferredSize] = argv;
    const cancellable = null;

    if (!property.endsWith('Pixmap'))
        throw new TypeError(`Invalid property name: ${property}`);

    const connection = Gio.bus_get_sync(Gio.BusType.SESSION, cancellable);
    const [pixmapsVariant] = connection.call_sync(busName, path,
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.kde.StatusNotifierItem', property]),
        null, Gio.DBusCallFlags.NO_AUTO_START, -1, cancellable).unpack();

    const { pixmapVariant, width, height, rowStride } =
        PixmapsUtils.getBestPixmap(pixmapsVariant.unpack(), preferredSize);
    const iconBytes = PixmapsUtils.argbToRgba(pixmapVariant.deep_unpack());

    const stdErrOutputStream = new Gio.UnixOutputStream({ fd: 2, closeFd: true });
    const controlFields = [iconBytes.length, width, height, rowStride];
    stdErrOutputStream.write(controlFields.join(','), cancellable);

    const stdOutputStream = new Gio.UnixOutputStream({ fd: 1, closeFd: true });
    stdOutputStream.write_bytes(iconBytes, cancellable);

    return 0;
}

main(ARGV);
