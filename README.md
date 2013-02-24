# AppIndicator support for GNOME Shell
This extension integrates AppIndicators, which are quite popular since the introduction of ubuntu unity, into the gnome shell.

It's based on patches made by Giovanni Campagna: https://bugzilla.gnome.org/show_bug.cgi?id=652122

## Features
* Show indicator icons in the message tray or in the panel (can be configured even per indicator!)
* Reveal indicator menus upon click.

## Missing features
* Tooltips: Not implemented in `libappindicator` and I've yet to see any indicator using it for anything relevant (KDE ones maybe?). They're likely to return (like implemented in the original patch) as soon as there is proven (and testable) real world usage.
* Oversized icons like the ones used by `indicator-multiload` are unsupported. They will be shrunk to normal size.
* Icon pixmaps: Implementation is likely to return if we find a real world indicator as test case.
* Overlay icons: Implementation has been dropped because there's no testcase. Will return if there's real world usage.

## Incomplete features
* Ayatana labels are supported in the panel only.

## TODO
* Add Localization.