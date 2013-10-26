#!/bin/sh

# creates config.js
echo // automatically generated file, see config.js.sh
echo const name = \"AppIndicator Support for Gnome Shell\"\;
echo const id = \"gnome-shell-extension-appindicator\"\;
echo const version = \"`git describe --tags --dirty`\"\;