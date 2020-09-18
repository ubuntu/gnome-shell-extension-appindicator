#!/usr/bin/gjs

/*
 * This creates an appindicator which contains all common menu items
 *
 * Requires libappindicator3 introspection data
 */
imports.gi.versions.Gtk = '3.0';
const Gtk = imports.gi.Gtk;
const AppIndicator = imports.gi.AppIndicator3;
const GLib = imports.gi.GLib;

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

var app = new Gtk.Application({
    application_id: null
});

var window = null;

app.connect("activate", () => {
    window.present();
});

app.connect("startup", () => {
    window = new Gtk.ApplicationWindow({
        title: "test",
        application: app
    });

    let getRandomIcon = () =>
        iconsPool[Math.floor(Math.random() * (iconsPool.length - 1))];

    var menu = new Gtk.Menu();

    var item = Gtk.MenuItem.new_with_label("A standard item");
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Foo");
    menu.append(item);

    item = Gtk.ImageMenuItem.new_with_label("Calculator");
    item.image = Gtk.Image.new_from_icon_name("gnome-calculator", Gtk.IconSize.MENU);
    menu.append(item);

    item = Gtk.CheckMenuItem.new_with_label("Check me!");
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Blub");
    let sub = new Gtk.Menu();
    item.set_submenu(sub);
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Blubdablub");
    sub.append(item);

    item = new Gtk.SeparatorMenuItem();
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Foo");
    menu.append(item);

    let submenu = new Gtk.Menu();
    item.set_submenu(submenu);

    item = Gtk.MenuItem.new_with_label("Hello");
    submenu.append(item);

    item = Gtk.MenuItem.new_with_label("Nested");
    submenu.append(item);

    let submenu1 = new Gtk.Menu();
    item.set_submenu(submenu1);

    item = Gtk.MenuItem.new_with_label("Another nested");
    submenu.append(item);

    let submenu2 = new Gtk.Menu();
    item.set_submenu(submenu2);

    item = Gtk.MenuItem.new_with_label("Some other item");
    submenu1.append(item);

    item = Gtk.MenuItem.new_with_label("abcdefg");
    submenu2.append(item);

    item = new Gtk.SeparatorMenuItem();
    menu.append(item);

    var group = [];

    for (let i = 0; i < 5; ++i) {
        item = Gtk.RadioMenuItem.new_with_label(group, "Example Radio "+i);
        group = Gtk.RadioMenuItem.prototype.get_group.apply(item)//.get_group();
        if (i == 1)
            item.set_active(true);
        menu.append(item);
    }

    item = new Gtk.SeparatorMenuItem();
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Set Label");
    item.connect('activate', () => {
        indicator.set_label(''+new Date().getTime(), 'Blub');
    });
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Unset Label");
    item.connect('activate', () => {
        indicator.set_label('', '');
    })
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Toggle Label");
    item.connect('activate', () => {
        indicator.get_label() ?
            indicator.set_label('', '') :
            indicator.set_label(new Date().getSeconds().toString(), 'Blub');
    })
    menu.append(item);
    toggle_label = item;

    item = Gtk.MenuItem.new_with_label("Autodestroy Label");
    item.connect('activate', () => {
        let i = 30;
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            indicator.set_label(i > 0 ? `Label timeout ${i--}` : '', '');
            return (i >= 0);
        });
    })
    menu.append(item);

    item = Gtk.MenuItem.new_with_label('Set Random icon');
    item.connect('activate', () => indicator.set_icon(getRandomIcon()));
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Toggle Attention");
    item.connect('activate', (item) => {
        indicator.set_status(indicator.get_status() != AppIndicator.IndicatorStatus.ATTENTION ?
                             AppIndicator.IndicatorStatus.ATTENTION :
                             AppIndicator.IndicatorStatus.ACTIVE);
    });
    menu.append(item);

    item = new Gtk.SeparatorMenuItem();
    menu.append(item);

    item = new Gtk.SeparatorMenuItem();
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Hide for some time");
    item.connect('activate', () => {
        indicator.set_status(AppIndicator.IndicatorStatus.PASSIVE);
        GLib.timeout_add(0, 5000, () => {
            indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE);
            return false;
        });
    });
    menu.append(item);

    item = Gtk.MenuItem.new_with_label("Close in 5 seconds");
    item.connect('activate', () => {
        GLib.timeout_add(0, 5000, () => {
            app.quit();
            return false;
        });
    });
    menu.append(item);

    menu.show_all();

    var indicator = AppIndicator.Indicator.new("Hello", "indicator-test", AppIndicator.IndicatorCategory.APPLICATION_STATUS);

    indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE);
    indicator.set_icon(DEFAULT_ICON);
    indicator.set_attention_icon(ATTENTION_ICON);
    indicator.set_menu(menu);
    indicator.set_secondary_activate_target(toggle_label);

    indicator.connect("connection-changed", (indicator, connected) => {
        print(`Signal \"connection-changed\" emitted. Connected: ${connected}`);
    });
    indicator.connect("new-attention-icon", (indicator) => {
        print(`Signal \"new-attention-icon\" emitted.`);
    });
    indicator.connect("new-icon", (indicator) => {
        print(`Signal \"new-icon\" emitted.`);
    });
    indicator.connect("new-icon-theme-path", (indicator, path) => {
        print(`Signal \"new-icon-theme-path\" emitted. Path: ${path}`);
    });
    indicator.connect("new-label", (indicator, label, guide) => {
        print(`Signal \"new-label\" emitted. Label: ${label}, Guide: ${guide}`);
    });
    indicator.connect("new-status", (indicator, status) => {
        print(`Signal \"new-status\" emitted. Status: ${status}`);
    });
    indicator.connect("scroll-event", (indicator, steps, direction) => {
        print(`Signal \"scroll-event\" emitted. Steps: ${steps}, Direction: ${direction}`);
        let currentIndex = iconsPool.indexOf(indicator.get_icon());
        let iconIndex;

        if (direction == ScrollType.UP) {
            iconIndex = (currentIndex + 1) % iconsPool.length;
        } else {
            iconIndex = (currentIndex <= 0 ? iconsPool.length : currentIndex) - 1;
        }

        indicator.set_icon(iconsPool[iconIndex]);
    });
});
app.run(ARGV);

})();
