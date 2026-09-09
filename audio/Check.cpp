#include "Loopback.hpp"

#include <CoreAudio/AudioServerPlugIn.h>
#include <CoreFoundation/CFPlugInCOM.h>
#include <mach/mach_time.h>

#include <cassert>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <thread>
#include <vector>

namespace {

constexpr auto device = AudioObjectID{2};
constexpr auto input = AudioObjectID{3};
constexpr auto output = AudioObjectID{4};
constexpr auto global = kAudioObjectPropertyScopeGlobal;
AudioServerPlugInDriverRef driver;
std::atomic<unsigned> notifications{0};

OSStatus changed(AudioServerPlugInHostRef, AudioObjectID, UInt32,
                 const AudioObjectPropertyAddress*) {
    ++notifications;
    return noErr;
}

AudioObjectPropertyAddress address(AudioObjectPropertySelector selector,
                                    AudioObjectPropertyScope scope = global) {
    return {selector, scope, kAudioObjectPropertyElementMain};
}

template <class T>
T get(AudioObjectID id, AudioObjectPropertySelector selector,
       AudioObjectPropertyScope scope = global) {
    auto key = address(selector, scope);
    assert((*driver)->HasProperty(driver, id, 0, &key));
    UInt32 size = 0;
    assert((*driver)->GetPropertyDataSize(driver, id, 0, &key, 0, nullptr, &size) == noErr);
    assert(size == sizeof(T));
    T result{};
    UInt32 written = 0;
    assert((*driver)->GetPropertyData(driver, id, 0, &key, 0, nullptr, size, &written, &result) == noErr);
    assert(written == size);
    return result;
}

void setActive(AudioObjectID stream, bool active) {
    auto key = address(kAudioStreamPropertyIsActive);
    UInt32 value = active;
    assert((*driver)->SetPropertyData(driver, stream, 0, &key, 0, nullptr, sizeof(value), &value) == noErr);
}

void transfer(UInt32 op, AudioObjectID stream, int64_t time, UInt32 frames, float* data) {
    AudioServerPlugInIOCycleInfo cycle{};
    cycle.mInputTime.mSampleTime = time;
    cycle.mOutputTime.mSampleTime = time;
    assert((*driver)->DoIOOperation(driver, device, stream, 1, op, frames, &cycle, data, nullptr) == noErr);
}

void read(int64_t writtenTime, UInt32 frames, float* data) {
    transfer(kAudioServerPlugInIOOperationReadInput, input, writtenTime + room::latencyFrames, frames, data);
}

bool silence(const std::vector<float>& data) {
    for (float sample : data) if (sample != 0) return false;
    return true;
}

void checkProperties() {
    assert(get<AudioObjectID>(1, kAudioPlugInPropertyDeviceList) == device);
    assert((get<std::array<AudioObjectID, 2>>(device, kAudioObjectPropertyOwnedObjects) ==
            std::array<AudioObjectID, 2>{input, output}));
    assert(get<AudioObjectID>(device, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput) == input);
    assert(get<AudioObjectID>(device, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput) == output);
    auto name = get<CFStringRef>(device, kAudioObjectPropertyName);
    assert(CFEqual(name, CFSTR("Room Cable")));
    CFRelease(name);
    assert(get<Float64>(device, kAudioDevicePropertyNominalSampleRate) == room::sampleRate);
    const auto pcm = get<AudioStreamBasicDescription>(input, kAudioStreamPropertyPhysicalFormat);
    assert(pcm.mSampleRate == 48000 && pcm.mChannelsPerFrame == 2 && pcm.mBytesPerFrame == 8);
    assert(pcm.mFormatID == kAudioFormatLinearPCM && pcm.mFormatFlags == kAudioFormatFlagsNativeFloatPacked);
    assert(get<UInt32>(input, kAudioStreamPropertyDirection) == 1);
    assert(get<UInt32>(output, kAudioStreamPropertyDirection) == 0);
    assert(get<UInt32>(device, kAudioDevicePropertyLatency, kAudioObjectPropertyScopeInput) == room::latencyFrames);
    assert(get<UInt32>(device, kAudioDevicePropertyZeroTimeStampPeriod) >= 10923);

    auto key = address(kAudioDevicePropertyNominalSampleRate);
    Float64 rate = 44100;
    assert((*driver)->SetPropertyData(driver, device, 0, &key, 0, nullptr, sizeof(rate), &rate) == kAudioDeviceUnsupportedFormatError);
    rate = 48000;
    assert((*driver)->SetPropertyData(driver, device, 0, &key, 0, nullptr, sizeof(rate), &rate) == noErr);
    UInt32 guard = 0x12345678, written = 99;
    assert((*driver)->GetPropertyData(driver, device, 0, &key, 0, nullptr, sizeof(guard), &written, &guard) == kAudioHardwareBadPropertySizeError);
    assert(guard == 0x12345678 && written == 0);
    key.mScope = kAudioObjectPropertyScopeInput;
    assert(!(*driver)->HasProperty(driver, device, 0, &key));

    key = address(kAudioPlugInPropertyTranslateUIDToDevice);
    assert((*driver)->GetPropertyDataSize(driver, 1, 0, &key, 0, nullptr, &written) == noErr);
    assert(written == sizeof(AudioObjectID));
    CFStringRef uid = CFSTR("dev.dubrovin.room.cable");
    AudioObjectID translated = 0;
    assert((*driver)->GetPropertyData(driver, 1, 0, &key, sizeof(uid), &uid,
                                     sizeof(translated), &written, &translated) == noErr);
    assert(translated == device);
    uid = CFSTR("not-our-device");
    assert((*driver)->GetPropertyData(driver, 1, 0, &key, sizeof(uid), &uid,
                                     sizeof(translated), &written, &translated) == noErr);
    assert(translated == kAudioObjectUnknown);

    key = address(kAudioObjectPropertyOwnedObjects);
    AudioClassID filter = kAudioDeviceClassID;
    assert((*driver)->GetPropertyDataSize(driver, device, 0, &key, sizeof(filter), &filter, &written) == noErr);
    assert(written == 0);
    filter = kAudioStreamClassID;
    assert((*driver)->GetPropertyDataSize(driver, device, 0, &key, sizeof(filter), &filter, &written) == noErr);
    assert(written == 2 * sizeof(AudioObjectID));
    Boolean doesIO = false, inPlace = false;
    assert((*driver)->WillDoIOOperation(driver, device, 1, kAudioServerPlugInIOOperationWriteMix, &doesIO, &inPlace) == noErr);
    assert(doesIO && inPlace);
    std::cout << "Device discovery, properties, scopes and fixed PCM format: OK\n";
}

void checkIO() {
    assert((*driver)->StartIO(driver, device, 1) == noErr);
    assert((*driver)->StartIO(driver, device, 2) == noErr);
    assert(get<UInt32>(device, kAudioDevicePropertyDeviceIsRunning) == 1);
    int64_t time = room::ringFrames - 100;
    for (UInt32 count : {37, 256, 512, 1024, 4096}) {
        std::vector<float> sent(count * 2), received(count * 2, 1);
        for (UInt32 i = 0; i < count; ++i) {
            sent[2 * i] = std::sin(i * 0.13f) * 0.5f;
            sent[2 * i + 1] = std::cos(i * 0.31f) * 0.25f;
        }
        transfer(kAudioServerPlugInIOOperationWriteMix, output, time, count, sent.data());
        read(time, count, received.data());
        assert(received == sent);
        // A second reader sees the same data; reads don't consume it.
        read(time, count, received.data());
        assert(received == sent);
        read(time + room::ringFrames, count, received.data());
        assert(silence(received));
        setActive(input, false);
        read(time, count, received.data());
        assert(silence(received));
        setActive(input, true);
        time += count;
        setActive(output, false);
        transfer(kAudioServerPlugInIOOperationWriteMix, output, time, count, sent.data());
        read(time, count, received.data());
        assert(silence(received));
        setActive(output, true);
        time += count;
    }
    assert((*driver)->StopIO(driver, device, 1) == noErr);
    assert(get<UInt32>(device, kAudioDevicePropertyDeviceIsRunning) == 1);
    std::vector<float> signal(512 * 2, 0.375f), received(512 * 2);
    transfer(kAudioServerPlugInIOOperationWriteMix, output, time, 512, signal.data());
    read(time, 512, received.data());
    assert(received == signal);
    assert((*driver)->StopIO(driver, device, 2) == noErr);
    assert(get<UInt32>(device, kAudioDevicePropertyDeviceIsRunning) == 0);
    assert((*driver)->StartIO(driver, device, 1) == noErr);
    read(time, 512, received.data());
    assert(silence(received));
    assert((*driver)->StopIO(driver, device, 1) == noErr);
    assert((*driver)->StopIO(driver, device, 1) == kAudioHardwareIllegalOperationError);
    assert(notifications.load() > 0);
    std::cout << "PCM loopback, ring wrap, silence, multiple clients and restart: OK\n";
}

void checkClock() {
    Float64 firstSample, secondSample;
    UInt64 firstHost, secondHost, firstSeed, secondSeed;
    assert((*driver)->GetZeroTimeStamp(driver, device, 1, &firstSample, &firstHost, &firstSeed) == noErr);
    std::this_thread::sleep_for(std::chrono::milliseconds(360));
    assert((*driver)->GetZeroTimeStamp(driver, device, 1, &secondSample, &secondHost, &secondSeed) == noErr);
    assert(secondSample > firstSample && secondHost > firstHost && secondHost <= mach_absolute_time());
    assert(firstSeed == secondSeed);
    mach_timebase_info_data_t timebase{};
    mach_timebase_info(&timebase);
    const double elapsed = double(secondHost - firstHost) * timebase.numer / timebase.denom / 1e9;
    assert(std::abs((secondSample - firstSample) / elapsed - room::sampleRate) < 0.1);
    std::cout << "Monotonic 48 kHz clock and timestamp period: OK\n";
}

void checkConcurrentRing() {
    room::Loopback ring;
    std::atomic<bool> done{false};
    std::atomic<int64_t> latest{0};
    std::thread writer([&] {
        for (int64_t time = 1; time < room::ringFrames * 5; ++time) {
            const float data[]{float(time), -float(time)};
            ring.write(time, 1, data);
            latest.store(time);
        }
        done.store(true);
    });
    std::thread reader([&] {
        while (!done.load()) {
            const auto time = latest.load();
            float data[2];
            // Reading a slot while it is overwritten may give silence, never torn audio.
            for (int64_t candidate : {time, time - room::ringFrames}) {
                ring.read(candidate, 1, data);
                assert((data[0] == 0 && data[1] == 0) ||
                       (data[0] == float(candidate) && data[1] == -float(candidate)));
            }
        }
    });
    writer.join();
    reader.join();
    std::cout << "Concurrent ring reads and overwrite protection: OK\n";
}

} // namespace

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    const auto path = std::filesystem::absolute(argv[1]).string();
    auto url = CFURLCreateFromFileSystemRepresentation(nullptr,
        reinterpret_cast<const UInt8*>(path.data()), path.size(), true);
    auto plugin = CFPlugInCreate(nullptr, url);
    assert(plugin);
    auto factories = CFPlugInFindFactoriesForPlugInTypeInPlugIn(kAudioServerPlugInTypeUUID, plugin);
    assert(factories && CFArrayGetCount(factories) == 1);
    auto factory = static_cast<CFUUIDRef>(CFArrayGetValueAtIndex(factories, 0));
    driver = static_cast<AudioServerPlugInDriverRef>(CFPlugInInstanceCreate(nullptr, factory, kAudioServerPlugInTypeUUID));
    assert(driver);
    void* queried = nullptr;
    assert((*driver)->QueryInterface(driver, CFUUIDGetUUIDBytes(kAudioServerPlugInDriverInterfaceUUID), &queried) == S_OK);
    assert(queried == driver);
    (*driver)->Release(driver);
    AudioServerPlugInHostInterface host{};
    host.PropertiesChanged = changed;
    assert((*driver)->Initialize(driver, &host) == noErr);
    checkProperties();
    checkIO();
    checkClock();
    checkConcurrentRing();
    (*driver)->Release(driver);
    CFRelease(factories);
    CFRelease(plugin);
    CFRelease(url);
    std::cout << "All checks passed in an isolated process; system audio was not changed.\n";
}
