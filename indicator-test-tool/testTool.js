#!/usr/bin/gjs

/*
 * This creates an appindicator which contains all common menu items
 *
 * Requires libappindicator3 introspection data
 */
const Gtk = imports.gi.Gtk;
const AppIndicator = imports.gi.AppIndicator3;
const GLib = imports.gi.GLib;

(function() {

var app = new Gtk.Application({
    application_id: null
});

var window = null;

app.connect("activate", function(){
    window.present();
});

app.connect("startup", function() {
    window = new Gtk.ApplicationWindow({
        title: "test",
        application: app
    });
    
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

    menu.show_all();

    var indicator = AppIndicator.Indicator.new("Hello", "indicator-test", AppIndicator.IndicatorCategory.APPLICATION_STATUS);

    indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE);
    indicator.set_icon("gnome-run");
    indicator.set_menu(menu);
});
app.run(ARGV);

})();
