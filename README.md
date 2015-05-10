
---

***IN SEARCH OF NEW MAINTAINER - SEE [BUG REPORT](https://github.com/rgcjonas/gnome-shell-extension-appindicator/issues/56)***

---

# AppIndicator/KStatusNotifierItem support for GNOME Shell
This extension integrates Ubuntu AppIndicators and KStatusNotifierItems (KDE's blessed successor of the systray) into GNOME Shell.

It's based on patches made by Giovanni Campagna: https://bugzilla.gnome.org/show_bug.cgi?id=652122

## Features
* Show indicator icons in the message tray or in the panel (can be configured even per indicator!)
* Reveal indicator menus upon click.
* Double clicking an icon will activate the application window (if implemented by the indicator).

## Missing features
* Tooltips: Not implemented in `libappindicator` nor in Unity and I've yet to see any indicator using it for anything relevant (KDE ones maybe?). Also, the GNOME designers decided not to have tooltips in the shell and I'd like to honor that decision.
* Oversized icons like the ones used by `indicator-multiload` are unsupported. They will be shrunk to normal size.

## Incomplete features
* Ayatana labels are supported in the panel only.

## Known issues
* ClassicMenu Indicator takes ages to load and has been reported to freeze the shell forever. This is probably caused by the insane amount of embedded PNG icons. Try at your own risk.

## Installation
Normal users are recommended to get the extension from [extensions.gnome.org](https://extensions.gnome.org/extension/615/appindicator-support/).

Alternatively, you can check out a version from git. Make sure you have `glib-compile-schemas` (comes with glib development packages)
and gettext utilities (`msgformat`, `msgmerge`, `xgettext` - might also be included in glib dev packages) installed.

1. Create a clone of the repo. Do **not** use zip files or release tarballs. We need git metadata during the build.
2. Run `make`.
3. Symlink `~/.local/share/gnome-shell/extensions/appindicatorsupport@rgcjonas.gmail.com` to your clone.
4. Restart the Shell (`alt+f2`, `r`, `⏎`).
5. Enable the extension in `gnome-tweak-tool`.

## Guidelines for bug reports
Unfortunately, this extension is not completely bug free and will probably never be.
In order to successfully resolve the issues you need to provide some data:

* Your distribution, Shell version and extension version (something like "latest git" or "latest from extensions.gnome.org" is sufficient).

  Starting from extension version v10, you can get this all by clicking "Copy debug information" on the "About" tab in the settings screen.
  You may of course shorten it a bit if you consider the `uname -a` output a privacy breach.
* The indicator that caused the bug (if applicable)
* Instructions how to reproduce it. **This is the single most important point**. Bugs that [can't be reproduced](http://xkcd.com/583/) can't be fixed either.

Bugs which don't provide the necessary information may be closed as "invalid" without prior notice.

## Release process
This section serves as reminder for the current maintainer and as instruction set for an eventual sucessor.

* The maintainer decides when to release a new version.
* Versions are tagged (and signed). Version numbers sould be kept in sync with the versions submitted to `extensions.gnome.org`.
  This implies that version numbers are integers that will be incremented which each release.
* The maintainer will tag a new version and the do a `make clean; make zip-file` to generate the zip file.
* The zip file will be tested to ensure that nothing was missing when packaging it.
* Only if it passed, it is uploaded to `extensions.gnome.org` and the tag is pushed.

This release process has been in place since v9.
