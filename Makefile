# simple helper makefile, handles schema compilation, translations and zip file creation

.PHONY= zip-file clean
SHELL := /usr/bin/env bash

# files that go into the zip
ZIP= $(wildcard *.js) metadata.json $(wildcard interfaces-xml/*) \
     $(wildcard locale/*/*/*.mo) $(wildcard schemas/*)

PO_FILES = $(wildcard locale/*.po)
GETTEXT_DOMAIN = 'AppIndicatorExtension'

all: compile-schema translations

zip-file: $(ZIP) translations
	@echo +++ Packing archive
	@mkdir -p build
	@rm -f build/appindicator-support.zip
	@zip build/appindicator-support.zip $(ZIP) locale/*/*/*.mo
	$(MAKE) clean-translations

compile-schema: ./schemas/org.gnome.shell.extensions.appindicator.gschema.xml
	@echo +++ Compiling schema
	@glib-compile-schemas schemas

check:
	eslint $(shell find -name '*.js')

translations: $(PO_FILES)
	@echo +++ Processing translations
	@for pofile in $^; do \
		localedir="$${pofile/.po}/LC_MESSAGES/"; \
		mkdir -p $$localedir; \
		msgfmt "$$pofile" -o "$$localedir/"$(GETTEXT_DOMAIN).mo; \
	done

clean-translations:
	rm -rf ls -d locale/*/

clean: clean-translations
	@echo +++ Removing all generated files
	rm -rf build
	rm -f schemas/*.compiled
