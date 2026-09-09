CXX := xcrun clang++
CXXFLAGS := -std=c++20 -O2 -Wall -Wextra -Wpedantic -Werror -mmacosx-version-min=13.0
FRAMEWORKS := -framework CoreAudio -framework CoreFoundation
BUNDLE := build/RoomCable.driver
BINARY := $(BUNDLE)/Contents/MacOS/RoomCable
ARCHS ?= -arch arm64 -arch x86_64

.PHONY: all check clean

all: $(BUNDLE)/Contents/_CodeSignature/CodeResources

$(BINARY): RoomCable.cpp Loopback.hpp
	mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) $(ARCHS) -fvisibility=hidden -fno-exceptions -bundle RoomCable.cpp $(FRAMEWORKS) -o $@

$(BUNDLE)/Contents/Info.plist: Info.plist
	mkdir -p $(dir $@)
	cp $< $@
	plutil -lint $@

$(BUNDLE)/Contents/_CodeSignature/CodeResources: $(BINARY) $(BUNDLE)/Contents/Info.plist
	codesign --force --sign - --timestamp=none $(BUNDLE)
	codesign --verify --strict $(BUNDLE)

build/check: Check.cpp Loopback.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) Check.cpp $(FRAMEWORKS) -o $@

check: all build/check
	./build/check $(BUNDLE)

clean:
	rm -rf build
