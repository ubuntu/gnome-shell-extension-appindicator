#!/usr/bin/gjs

/*
 * This creates an appindicator which contains all common menu items
 *
 * Requires libappindicator3 introspection data
 */
import Gtk from 'gi://Gtk?version=3.0';
import AppIndicator from 'gi://AppIndicator3';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DEFAULT_ICON = 'start-here';
const ATTENTION_ICON = 'starred';

const iconsPool = [
    'emoji-recent-symbolic',
    'emoji-flags-symbolic',
    'emoji-objects-symbolic',
    'emoji-nature-symbolic',
    'emoji-body-symbolic',
    'emoji-activities-symbolic',
    'emoji-people-symbolic',
    'emoji-travel-symbolic',
    'emoji-symbols-symbolic',
    'emoji-food-symbolic',
];

const ScrollType = {
    UP: 0,
    DOWN: 1,
};

(() => {
    const temporaryFiles = [];

    var app = new Gtk.Application({
        application_id: null,
    });

    var window = null;

    app.connect('activate', () => {
        window.present();
    });

    app.connect('startup', () => {
        window = new Gtk.ApplicationWindow({
            title: 'test',
            application: app,
        });

        let getRandomIcon = () =>
            iconsPool[Math.floor(Math.random() * (iconsPool.length - 1))];

        let setRandomIconPath = () => {
            let iconName = getRandomIcon();
            let iconInfo = Gtk.IconTheme.get_default().lookup_icon(iconName,
                16, Gtk.IconLookupFlags.GENERIC_FALLBACK);
            let iconFile = Gio.File.new_for_path(iconInfo.get_filename());
            let [, extension] = iconFile.get_basename().split('.');
            let newName = `${Math.floor(Math.random() * 100)}${iconName}.${extension}`;
            let newFile = Gio.File.new_for_path(
                `${GLib.dir_make_tmp('indicator-test-XXXXXX')}/${newName}`);
            temporaryFiles.push(newFile, newFile.get_parent());
            iconFile.copy(newFile, Gio.FileCopyFlags.OVERWRITE, null, null);

            indicator.set_icon_theme_path(newFile.get_parent().get_path());
            indicator.set_icon(newFile.get_basename().split('.').slice(0, -1).join(''));
        };

        var menu = new Gtk.Menu();

        var item = Gtk.MenuItem.new_with_label('A standard item');
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Foo');
        const fooItem = item;
        let fooId = item.connect('activate', () => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                print('Changing item label', fooItem.get_label());
                fooItem.set_label('Destroy me now...');
                fooItem.connect('activate', () => {
                    print('Removed item labeled', fooItem.get_label());
                    fooItem.destroy();
                });
                fooItem.disconnect(fooId);

                const barItem = Gtk.MenuItem.new_with_label('Bar');
                menu.insert(barItem, 2);
                barItem.show();
                return GLib.SOURCE_REMOVE;
            });
        });
        menu.append(item);

        item = Gtk.ImageMenuItem.new_with_label('Calculator');
        item.image = Gtk.Image.new_from_icon_name('gnome-calculator', Gtk.IconSize.MENU);
        menu.append(item);

        item = Gtk.CheckMenuItem.new_with_label('Check me!');
        const checkItem = item;
        item.connect('activate', () => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                print('changed item label', checkItem.get_label());
                checkItem.set_label(`Checked at ${new Date().getTime()}`);
                return GLib.SOURCE_REMOVE;
            });
        });
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Blub');
        let sub = new Gtk.Menu();
        item.set_submenu(sub);
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Blubdablub');
        sub.append(item);

        item = new Gtk.SeparatorMenuItem();
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Foo');
        menu.append(item);

        let submenu = new Gtk.Menu();
        item.set_submenu(submenu);

        item = Gtk.MenuItem.new_with_label('Hello');
        submenu.append(item);

        item = Gtk.MenuItem.new_with_label('Nested');
        submenu.append(item);

        let submenu1 = new Gtk.Menu();
        item.set_submenu(submenu1);

        item = Gtk.MenuItem.new_with_label('Another nested');
        submenu.append(item);

        let submenu2 = new Gtk.Menu();
        item.set_submenu(submenu2);

        item = Gtk.MenuItem.new_with_label('Some other item');
        submenu1.append(item);

        item = Gtk.MenuItem.new_with_label('abcdefg');
        submenu2.append(item);

        item = new Gtk.SeparatorMenuItem();
        menu.append(item);

        var group = [];

        for (let i = 0; i < 5; ++i) {
            item = Gtk.RadioMenuItem.new_with_label(group, `Example Radio ${i}`);
            group = Gtk.RadioMenuItem.prototype.get_group.apply(item);// .get_group();
            if (i === 1)
                item.set_active(true);
            menu.append(item);
        }

        item = new Gtk.SeparatorMenuItem();
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Set Label');
        item.connect('activate', () => {
            indicator.set_label(`${new Date().getTime()}`, 'Blub');
        });
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Unset Label');
        item.connect('activate', () => {
            indicator.set_label('', '');
        });
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Autodestroy Label');
        item.connect('activate', () => {
            let i = 30;
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                indicator.set_label(i > 0 ? `Label timeout ${i--}` : '', '');
                return i >= 0;
            });
        });
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Set Random icon');
        item.connect('activate', () => indicator.set_icon(getRandomIcon()));
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Set Random custom theme icon');
        item.connect('activate', setRandomIconPath);
        menu.append(item);

        item = Gtk.CheckMenuItem.new_with_label('Toggle Label and Icon');
        item.connect('activate', it => {
            if (it.get_active()) {
                indicator.set_label(`${new Date().getTime()}`, 'Blub');
                item.connect('activate', () => indicator.set_icon(getRandomIcon()));
            } else {
                indicator.set_label('', '');
                indicator.set_icon(DEFAULT_ICON);
            }
        });
        menu.append(item);
        let toggleBrandingItem = item;

        item = Gtk.CheckMenuItem.new_with_label('Toggle Attention');
        let toggleAttentionId = item.connect('activate', () => {
            indicator.set_status(indicator.get_status() !== AppIndicator.IndicatorStatus.ATTENTION
                ? AppIndicator.IndicatorStatus.ATTENTION
                : AppIndicator.IndicatorStatus.ACTIVE);
        });
        menu.append(item);
        let toggleAttentionItem = item;

        item = new Gtk.SeparatorMenuItem();
        menu.append(item);

        /* Double separaptors test */

        item = new Gtk.SeparatorMenuItem();
        menu.append(item);

        /* Simulate similar behavior of #226 and #236 */
        item = Gtk.CheckMenuItem.new_with_label('Crazy icons updates');
        item.connect('activate', it => {
            if (it.get_active()) {
                item._timeoutID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                    setRandomIconPath();
                    indicator.set_label(`${new Date().getSeconds()}`, '');
                    return GLib.SOURCE_CONTINUE;
                });
            } else {
                GLib.source_remove(item._timeoutID);
                delete item._timeoutID;
            }
        });
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Hide for some time');
        item.connect('activate', () => {
            indicator.set_status(AppIndicator.IndicatorStatus.PASSIVE);
            GLib.timeout_add(0, 5000, () => {
                indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE);
                return false;
            });
        });
        menu.append(item);

        item = Gtk.MenuItem.new_with_label('Close in 5 seconds');
        item.connect('activate', () => {
            GLib.timeout_add(0, 5000, () => {
                app.quit();
                return false;
            });
        });
        menu.append(item);

        menu.show_all();

        var indicator = AppIndicator.Indicator.new('Hello', 'indicator-test', AppIndicator.IndicatorCategory.APPLICATION_STATUS);

        indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE);
        indicator.set_icon(DEFAULT_ICON);
        indicator.set_attention_icon(ATTENTION_ICON);
        indicator.set_menu(menu);
        indicator.set_secondary_activate_target(toggleBrandingItem);

        indicator.connect('connection-changed', (_indicator, connected) => {
            print(`Signal "connection-changed" emitted. Connected: ${connected}`);
        });
        indicator.connect('new-attention-icon', () => {
            print('Signal "new-attention-icon" emitted.');
        });
        indicator.connect('new-icon', () => {
            let icon = '<none>';
            if (indicator.get_status() === AppIndicator.IndicatorStatus.ATTENTION)
                icon = indicator.get_attention_icon();
            else if (indicator.get_status() === AppIndicator.IndicatorStatus.ACTIVE)
                icon = indicator.get_icon();

            print(`Signal "new-icon" emitted. Icon: ${icon}`);
        });
        indicator.connect('new-icon-theme-path', (_indicator, path) => {
            print(`Signal "new-icon-theme-path" emitted. Path: ${path}`);
        });
        indicator.connect('new-label', (_indicator, label, guide) => {
            print(`Signal "new-label" emitted. Label: ${label}, Guide: ${guide}`);
        });
        indicator.connect('new-status', (_indicator, status) => {
            print(`Signal "new-status" emitted. Status: ${status}`);

            toggleAttentionItem.block_signal_handler(toggleAttentionId);
            toggleAttentionItem.set_active(status === 'NeedsAttention');
            toggleAttentionItem.unblock_signal_handler(toggleAttentionId);
        });
        indicator.connect('scroll-event', (_indicator, steps, direction) => {
            print(`Signal "scroll-event" emitted. Steps: ${steps}, Direction: ${direction}`);
            let currentIndex = iconsPool.indexOf(indicator.get_icon());
            let iconIndex;

            if (direction === ScrollType.UP)
                iconIndex = (currentIndex + 1) % iconsPool.length;
            else
                iconIndex = (currentIndex <= 0 ? iconsPool.length : currentIndex) - 1;


            indicator.set_icon(iconsPool[iconIndex]);
        });
    });

    app.connect('shutdown', () =>
        temporaryFiles.forEach(file => file.delete(null)));

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, /* SIGTERM */ 2, () => {
        app.quit();
        return GLib.SOURCE_CONTINUE;
    });

    app.run(ARGV);
})();
