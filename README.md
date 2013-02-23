# AppIndicator support for GNOME Shell
This extension integrates AppIndicators, which are quite popular since the introduction of ubuntu unity, into the gnome shell.

It's based on patches made by Giovanni Campagna: https://bugzilla.gnome.org/show_bug.cgi?id=652122

## Features
* Show indicator icons in the message tray or in the panel (can be configured even per indicator!)
* Reveal indicator menus upon click.

## Missing features
* Tooltips: Not implemented in `libappindicator` and I've yet to see any indicator using it (KDE ones maybe?). They're likely to return (like implemented in the original patch) as soon as there is proven (and testable) real world usage.
* Oversized icons like the ones used by `indicator-multiload` are unsupported. They will be shrunk to normal size.
* Icon pixmaps: Implementation is likely to return if we find a real world indicator as test case.

## Buggy features
* Ayatana labels are supported in the panel only.
* The whole thing eats a bunch of memory. There is no evidence for memory leaks (yet) but the garbage collector seems to have severe problems dealing with changing icons.
* `nm-applet` is broken: https://bugs.launchpad.net/ubuntu/+source/network-manager-applet/+bug/965895

## TODO
* Add Localization.