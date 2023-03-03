#!/usr/bin/env gjs

const { GLib, Gio } = imports.gi;

const currentPath = GLib.path_get_dirname(new Error().fileName);
imports.searchPath.unshift(currentPath);

const { pixmapsUtils: PixmapsUtils } = imports;

const MAX_CHUNK_SIZE = 8192;

function main(argv) {
    if (argv.length < 1) {
        const currentBinary = GLib.path_get_basename(new Error().fileName);
        printerr(`Usage: ${currentBinary} size`);
        return 1;
    }

    const dataSize = Number(argv[0]);
    const cancellable = null;

    const stdInputStream = new Gio.UnixInputStream({ fd: 0, closeFd: true });
    let readBytes;

    if (dataSize <= MAX_CHUNK_SIZE) {
        readBytes = stdInputStream.read_bytes(dataSize, cancellable);
    } else {
        let readDataSize = 0;
        readBytes = new Uint8Array(dataSize);

        while (readDataSize < dataSize) {
            const chunk = stdInputStream.read_bytes(
                Math.min(dataSize - readDataSize, MAX_CHUNK_SIZE), cancellable);
            readBytes.set(chunk.get_data(), readDataSize);
            readDataSize += chunk.get_size();
        }

        if (readDataSize !== dataSize)
            throw new Error(`Read ${readDataSize} of ${dataSize}`);
    }

    const pixmapVariant =
        GLib.Variant.new_from_bytes(new GLib.VariantType('ay'), readBytes, true);
    const iconBytes = PixmapsUtils.argbToRgba(pixmapVariant.deepUnpack());

    const stdErrOutputStream = new Gio.UnixOutputStream({ fd: 2, closeFd: true });
    const controlFields = [iconBytes.length];
    stdErrOutputStream.write(controlFields.join(','), cancellable);

    const stdOutputStream = new Gio.UnixOutputStream({ fd: 1, closeFd: true });
    stdOutputStream.write_bytes(iconBytes, cancellable);

    return 0;
}

main(ARGV);
