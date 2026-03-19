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

import GLib from 'gi://GLib';

/**
 * Helper class for logging stuff
 */
export class Logger {
    static _logStructured(logLevel, message, extraFields = {}) {
        if (!Object.values(GLib.LogLevelFlags).includes(logLevel)) {
            Logger._logStructured(GLib.LogLevelFlags.LEVEL_WARNING,
                'logLevel is not a valid GLib.LogLevelFlags');
            return;
        }

        if (!Logger._levels.includes(logLevel))
            return;

        let fields = {
            'SYSLOG_IDENTIFIER': Logger._uuid,
            'MESSAGE': `${message}`,
        };

        let thisFile = null;
        const {stack} = new Error();
        for (let stackLine of stack.split('\n')) {
            stackLine = stackLine.replace('resource:///org/gnome/Shell/', '');
            const [code, line] = stackLine.split(':');
            const [func, file] = code.split(/@(.+)/);

            if (!thisFile || thisFile === file) {
                thisFile = file;
                continue;
            }

            fields = Object.assign(fields, {
                'CODE_FILE': file || '',
                'CODE_LINE': line || '',
                'CODE_FUNC': func || '',
            });

            break;
        }

        GLib.log_structured(Logger._domain, logLevel, Object.assign(fields, extraFields));
    }

    static init(extension) {
        if (Logger._domain)
            return;

        const allLevels = Object.values(GLib.LogLevelFlags);
        const domains = GLib.getenv('G_MESSAGES_DEBUG');
        const {name: domain} = extension.metadata;
        Logger._uuid = extension.metadata.uuid;
        Logger._domain = domain.replaceAll(' ', '-');

        if (domains === 'all' || (domains && domains.split(' ').includes(Logger._domain))) {
            Logger._levels = allLevels;
        } else {
            Logger._levels = allLevels.filter(
                l => l <= GLib.LogLevelFlags.LEVEL_WARNING);
        }
    }

    static destroy() {
        delete Logger._domain;
        delete Logger._uuid;
        delete Logger._levels;
    }

    static debug(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_DEBUG, message);
    }

    static message(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_MESSAGE, message);
    }

    static warn(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_WARNING, message);
    }

    static error(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_ERROR, message);
    }

    static critical(message) {
        Logger._logStructured(GLib.LogLevelFlags.LEVEL_CRITICAL, message);
    }
}
