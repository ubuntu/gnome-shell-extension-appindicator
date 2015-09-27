# simple helper makefile, handles schema compilation, translations and zip file creation

.PHONY= zip-file

# files that go into the zip
ZIP= $(wildcard *.js) metadata.json $(wildcard interfaces-xml/*)

zip-file: $(ZIP)
	mkdir -p build
	rm -f build/appindicator-support.zip
	zip build/appindicator-support.zip $(ZIP)

clean:
	rm -rf build
