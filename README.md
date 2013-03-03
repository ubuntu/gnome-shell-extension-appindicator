# AppIndicator support for GNOME Shell
This extension integrates AppIndicators, which are quite popular since the introduction of ubuntu unity, into the gnome shell.

It's based on patches made by Giovanni Campagna: https://bugzilla.gnome.org/show_bug.cgi?id=652122

## Features
* Show indicator icons in the message tray or in the panel (can be configured even per indicator!)
* Reveal indicator menus upon click.

## Missing features
* Tooltips: Not implemented in `libappindicator` nor in Unity and I've yet to see any indicator using it for anything relevant (KDE ones maybe?). Also, the GNOME designers decided not to have tooltips in the shell and I'd like to honor that decision.
* Oversized icons like the ones used by `indicator-multiload` are unsupported. They will be shrunk to normal size.
* Icon pixmaps: Implementation is likely to return if we find a real world indicator as test case.
* Overlay icons: Implementation has been dropped because there's no testcase. Will return if there's real world usage.

## Incomplete features
* Ayatana labels are supported in the panel only.

## Known issues
* ClassicMenu Indicator takes ages to load and has been reported to freeze the shell forever. This is probably caused by the insane amount of embedded PNG icons. Sadly, this seems to be unfixable.
* Embedded PNG icon data in menus (as used by Skype, ClassicMenu Indicator and others) cannot be handled efficiently, they will eat memory and can cause lags.
* Using a sni-qt based indicator (e.g. Clementine) together with the MediaPlayer extension creates a deadlock that freezes the shell. This can only be fixed in sni-qt or the MediaPlayer extension.

## TODO
* Add Localization (You can help there!).