# simple helper makefile, handles schema compilation, translations and zip file creation

.PHONY= zip-file clean

# files that go into the zip
ZIP= $(wildcard *.js) metadata.json $(wildcard interfaces-xml/*) \
     $(wildcard locale/*) $(wildcard schemas/*)

all: zip-file

zip-file: $(ZIP) compile-schema
	@echo +++ Packing archive
	@mkdir -p build
	@rm -f build/appindicator-support.zip
	@zip build/appindicator-support.zip $(ZIP)

compile-schema: ./schemas/org.gnome.shell.extensions.appindicator.gschema.xml
	@echo +++ Compiling schema
	@glib-compile-schemas schemas

check:
	eslint $(shell find -name '*.js')

clean:
	rm -rf build
