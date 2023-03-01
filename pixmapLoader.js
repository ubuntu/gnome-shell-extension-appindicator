#!/usr/bin/env gjs

const { GLib, Gio } = imports.gi;

function argbToRgba(src) {
    const dest = new Uint8Array(src.length);

    for (let j = 0; j < src.length; j += 4) {
        const srcAlpha = src[j];

        dest[j] = src[j + 1]; /* red */
        dest[j + 1] = src[j + 2]; /* green */
        dest[j + 2] = src[j + 3]; /* blue */
        dest[j + 3] = srcAlpha; /* alpha */
    }

    return dest;
}

function dataArray(value, maxLength) {
    const array = new Uint8Array(maxLength);
    const strValue = `${value}`;

    if (strValue.length >= array.length)
        throw new TypeError('Array too big');

    for (let i = 0; i < strValue.length; ++i)
        array[i] = strValue.charCodeAt(i);

    return dataArray;
}

function main(argv) {
    if (argv.length < 4) {
        const currentBinary = GLib.path_get_basename(new Error().fileName);
        printerr(`Usage: ${currentBinary} bus-name path property preferred-size output-fd`);
        return 1;
    }

    const [busName, path, property, preferredSize] = argv;
    const cancellable = null;

    const connection = Gio.bus_get_sync(Gio.BusType.SESSION, cancellable);
    const [pixmapsVariant] = connection.call_sync(busName, path,
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.kde.StatusNotifierItem', property]),
        null, Gio.DBusCallFlags.NO_AUTO_START, -1, cancellable).deep_unpack();

    const pixmapsArray = pixmapsVariant.deep_unpack();

    if (!pixmapsArray || pixmapsArray.length < 1)
        throw TypeError('Empty Icon found');

    const sortedPixmapsArray = pixmapsArray.sort((pixmapA, pixmapB) => {
        // we sort smallest to biggest
        const areaA = pixmapA[0] * pixmapA[1];
        const areaB = pixmapB[0] * pixmapB[1];

        return areaA - areaB;
    });

    const qualifiedPixmapArray = sortedPixmapsArray.filter(([width, height]) =>
        // we prefer any pixmap that is equal or bigger than our requested size
        width >= preferredSize && height >= preferredSize);

    const iconPixmap = qualifiedPixmapArray.length > 0
        ? qualifiedPixmapArray[0] : sortedPixmapsArray.pop();

    const [width, height, bytes] = iconPixmap;
    // const rowStride = width * 4; // hopefully this is correct

    const iconBytes = argbToRgba(bytes);

    const stdOutputStream = new Gio.UnixOutputStream({ fd: 1, closeFd: true });
    const stdErrOutputStream = new Gio.UnixOutputStream({ fd: 2, closeFd: true });

    stdErrOutputStream.write_bytes(dataArray(iconBytes.length, 8), cancellable);
    stdErrOutputStream.write_bytes(dataArray(width, 4), cancellable);
    stdErrOutputStream.write_bytes(dataArray(height, 4), cancellable);
    // outputStream.write_bytes(dataArray(rowStride, 4), cancellable);
    stdOutputStream.write_bytes(iconBytes, cancellable);

    return 0;
}

main(ARGV);
