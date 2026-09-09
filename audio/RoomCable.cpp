#include "Loopback.hpp"

#include <CoreAudio/AudioHardware.h>
#include <CoreAudio/AudioServerPlugIn.h>
#include <CoreFoundation/CFPlugInCOM.h>
#include <mach/mach_time.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <mutex>

namespace {

constexpr AudioObjectID deviceID = 2;
constexpr AudioObjectID inputID = 3;
constexpr AudioObjectID outputID = 4;
constexpr auto globalScope = kAudioObjectPropertyScopeGlobal;
constexpr auto inputScope = kAudioObjectPropertyScopeInput;
constexpr auto outputScope = kAudioObjectPropertyScopeOutput;

extern AudioServerPlugInDriverInterface driverInterface;
AudioServerPlugInDriverInterface* interfacePointer = &driverInterface;
const AudioServerPlugInDriverRef driver = &interfacePointer;
AudioServerPlugInHostRef host = nullptr;
std::atomic<UInt32> references{1};
std::atomic<UInt32> running{0};
std::atomic<bool> inputActive{true};
std::atomic<bool> outputActive{true};
std::mutex controlMutex; // Never taken by an IO or timestamp callback.
room::Loopback loopback;
UInt64 clockAnchor = 0;
double ticksPerFrame = 0;

bool isStream(AudioObjectID id) { return id == inputID || id == outputID; }
bool isObject(AudioObjectID id) { return id == kAudioObjectPlugInObject || id == deviceID || isStream(id); }
bool isIOScope(AudioObjectPropertyScope scope) { return scope == inputScope || scope == outputScope; }

AudioStreamBasicDescription format() {
    return {room::sampleRate, kAudioFormatLinearPCM, kAudioFormatFlagsNativeFloatPacked,
            8, 1, 8, room::channels, 32, 0};
}

// Property payloads fit on the stack, including the two stream IDs and stereo layout.
// CFStrings are retained only when returned to the host, never during HasProperty.
struct Property {
    std::array<std::byte, 128> data{};
    UInt32 size = 0;
    UInt32 elementSize = 0;
    CFStringRef string = nullptr;

    template <class T> void set(const T& value) {
        static_assert(sizeof(T) <= 128);
        size = sizeof(T);
        std::memcpy(data.data(), &value, size);
    }

    void text(CFStringRef value) {
        string = value;
        set(value);
    }

    void list(const AudioObjectID* values, UInt32 count) {
        elementSize = sizeof(AudioObjectID);
        size = count * elementSize;
        if (size) std::memcpy(data.data(), values, size);
    }
};

OSStatus property(AudioObjectID id, const AudioObjectPropertyAddress* address,
                  UInt32 qualifierSize, const void* qualifier, Property& result) {
    if (!isObject(id)) return kAudioHardwareBadObjectError;
    if (!address) return kAudioHardwareIllegalOperationError;
    if (address->mElement != kAudioObjectPropertyElementMain) return kAudioHardwareUnknownPropertyError;
    const auto selector = address->mSelector;
    const auto scope = address->mScope;
    const bool device = id == deviceID;
    if (scope != globalScope && !(device && isIOScope(scope))) return kAudioHardwareUnknownPropertyError;

    if (selector == kAudioObjectPropertyOwnedObjects ||
        (device && selector == kAudioDevicePropertyStreams)) {
        std::array<AudioObjectID, 2> children{};
        UInt32 count = 0;
        auto include = [&](AudioObjectID child, AudioClassID type) {
            if (selector == kAudioObjectPropertyOwnedObjects && qualifierSize) {
                bool match = false;
                for (UInt32 offset = 0; offset < qualifierSize; offset += sizeof(AudioClassID)) {
                    AudioClassID requested;
                    std::memcpy(&requested, static_cast<const std::byte*>(qualifier) + offset, sizeof(requested));
                    match |= requested == type || requested == kAudioObjectClassID;
                }
                if (!match) return;
            }
            children[count++] = child;
        };
        if (qualifierSize && (!qualifier || qualifierSize % sizeof(AudioClassID)))
            return kAudioHardwareBadPropertySizeError;
        if (id == kAudioObjectPlugInObject) include(deviceID, kAudioDeviceClassID);
        if (device) {
            if (scope != outputScope) include(inputID, kAudioStreamClassID);
            if (scope != inputScope) include(outputID, kAudioStreamClassID);
        }
        result.list(children.data(), count);
        return noErr;
    }

    if (scope == globalScope) {
        switch (selector) {
        case kAudioObjectPropertyBaseClass:
            result.set<UInt32>(kAudioObjectClassID); return noErr;
        case kAudioObjectPropertyClass:
            result.set<UInt32>(device ? AudioClassID(kAudioDeviceClassID) : isStream(id) ? AudioClassID(kAudioStreamClassID) : AudioClassID(kAudioPlugInClassID));
            return noErr;
        case kAudioObjectPropertyOwner:
            result.set<UInt32>(device ? kAudioObjectPlugInObject : isStream(id) ? deviceID : kAudioObjectUnknown);
            return noErr;
        case kAudioObjectPropertyName:
            result.text(id == inputID ? CFSTR("Room Cable Input") : id == outputID ? CFSTR("Room Cable Output") : CFSTR("Room Cable"));
            return noErr;
        case kAudioObjectPropertyManufacturer:
            result.text(CFSTR("Room")); return noErr;
        case kAudioObjectPropertyControlList:
            result.list(nullptr, 0); return noErr;
        default: break;
        }
    }

    if (id == kAudioObjectPlugInObject) {
        switch (selector) {
        case kAudioPlugInPropertyBundleID:
            result.text(CFSTR("dev.dubrovin.room.audio")); return noErr;
        case kAudioPlugInPropertyResourceBundle:
            result.text(CFSTR("")); return noErr;
        case kAudioPlugInPropertyDeviceList:
            result.list(&deviceID, 1); return noErr;
        case kAudioPlugInPropertyTranslateUIDToDevice: {
            if (!qualifier || qualifierSize != sizeof(CFStringRef)) return kAudioHardwareBadPropertySizeError;
            CFStringRef uid;
            std::memcpy(&uid, qualifier, sizeof(uid));
            result.set<AudioObjectID>(uid && CFEqual(uid, CFSTR("dev.dubrovin.room.cable")) ? deviceID : kAudioObjectUnknown);
            return noErr;
        }
        default: return kAudioHardwareUnknownPropertyError;
        }
    }

    if (device && isIOScope(scope)) {
        switch (selector) {
        case kAudioDevicePropertyDeviceCanBeDefaultDevice:
            result.set<UInt32>(1); return noErr;
        case kAudioDevicePropertyDeviceCanBeDefaultSystemDevice:
            result.set<UInt32>(0); return noErr;
        case kAudioDevicePropertyLatency:
            result.set<UInt32>(scope == inputScope ? room::latencyFrames : 0); return noErr;
        case kAudioDevicePropertySafetyOffset:
            result.set<UInt32>(0); return noErr;
        case kAudioDevicePropertyPreferredChannelsForStereo:
            result.set(std::array<UInt32, 2>{1, 2}); return noErr;
        case kAudioDevicePropertyPreferredChannelLayout: {
            AudioChannelLayout layout{};
            layout.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo;
            result.set(layout);
            result.size = offsetof(AudioChannelLayout, mChannelDescriptions);
            return noErr;
        }
        default: return kAudioHardwareUnknownPropertyError;
        }
    }

    if (device) {
        switch (selector) {
        case kAudioDevicePropertyDeviceUID:
            result.text(CFSTR("dev.dubrovin.room.cable")); return noErr;
        case kAudioDevicePropertyModelUID:
            result.text(CFSTR("dev.dubrovin.room.cable.stereo")); return noErr;
        case kAudioDevicePropertyTransportType:
            result.set<UInt32>(kAudioDeviceTransportTypeVirtual); return noErr;
        case kAudioDevicePropertyRelatedDevices:
            result.list(&deviceID, 1); return noErr;
        case kAudioDevicePropertyClockDomain:
        case kAudioDevicePropertyIsHidden:
        case kAudioDevicePropertyWantsControlsRestored:
        case kAudioDevicePropertyWantsStreamFormatsRestored:
            result.set<UInt32>(0); return noErr;
        case kAudioDevicePropertyDeviceIsAlive:
        case kAudioDevicePropertyClockIsStable:
            result.set<UInt32>(1); return noErr;
        case kAudioDevicePropertyDeviceIsRunning:
            result.set<UInt32>(running.load() != 0); return noErr;
        case kAudioDevicePropertyNominalSampleRate:
            result.set<Float64>(room::sampleRate); return noErr;
        case kAudioDevicePropertyAvailableNominalSampleRates:
            result.set(AudioValueRange{room::sampleRate, room::sampleRate}); return noErr;
        case kAudioDevicePropertyZeroTimeStampPeriod:
            result.set<UInt32>(room::timestampPeriod); return noErr;
        case kAudioDevicePropertyClockAlgorithm:
            result.set<UInt32>(kAudioDeviceClockAlgorithmRaw); return noErr;
        default: return kAudioHardwareUnknownPropertyError;
        }
    }

    switch (selector) {
    case kAudioStreamPropertyIsActive:
        result.set<UInt32>((id == inputID ? inputActive : outputActive).load()); return noErr;
    case kAudioStreamPropertyDirection:
        result.set<UInt32>(id == inputID); return noErr;
    case kAudioStreamPropertyTerminalType:
        result.set<UInt32>(kAudioStreamTerminalTypeLine); return noErr;
    case kAudioStreamPropertyStartingChannel:
        result.set<UInt32>(1); return noErr;
    case kAudioStreamPropertyLatency:
        result.set<UInt32>(0); return noErr;
    case kAudioStreamPropertyVirtualFormat:
    case kAudioStreamPropertyPhysicalFormat:
        result.set(format()); return noErr;
    case kAudioStreamPropertyAvailableVirtualFormats:
    case kAudioStreamPropertyAvailablePhysicalFormats:
        result.set(AudioStreamRangedDescription{format(), {room::sampleRate, room::sampleRate}});
        return noErr;
    default: return kAudioHardwareUnknownPropertyError;
    }
}

ULONG addRef(void* reference) {
    if (reference != driver) return 0;
    auto count = references.load();
    while (count != UINT32_MAX && !references.compare_exchange_weak(count, count + 1)) {}
    return count == UINT32_MAX ? count : count + 1;
}

ULONG release(void* reference) {
    if (reference != driver) return 0;
    auto count = references.load();
    while (count && !references.compare_exchange_weak(count, count - 1)) {}
    return count ? count - 1 : 0; // Static instance lives until the bundle is unloaded.
}

HRESULT queryInterface(void* reference, REFIID uuidBytes, LPVOID* out) {
    if (!out) return E_POINTER;
    *out = nullptr;
    if (reference != driver) return E_NOINTERFACE;
    auto uuid = CFUUIDCreateFromUUIDBytes(nullptr, uuidBytes);
    const bool supported = uuid && (CFEqual(uuid, IUnknownUUID) || CFEqual(uuid, kAudioServerPlugInDriverInterfaceUUID));
    if (uuid) CFRelease(uuid);
    if (!supported) return E_NOINTERFACE;
    addRef(reference);
    *out = driver;
    return S_OK;
}

OSStatus initialize(AudioServerPlugInDriverRef reference, AudioServerPlugInHostRef newHost) {
    if (reference != driver || !newHost) return kAudioHardwareIllegalOperationError;
    std::lock_guard lock(controlMutex);
    if (host) return kAudioHardwareIllegalOperationError;
    mach_timebase_info_data_t timebase{};
    if (mach_timebase_info(&timebase) != KERN_SUCCESS || !timebase.numer || !timebase.denom)
        return kAudioHardwareUnspecifiedError;
    ticksPerFrame = 1e9 * timebase.denom / timebase.numer / room::sampleRate;
    clockAnchor = mach_absolute_time();
    host = newHost;
    return noErr;
}

OSStatus createDevice(AudioServerPlugInDriverRef, CFDictionaryRef,
                      const AudioServerPlugInClientInfo*, AudioObjectID* out) {
    if (out) *out = kAudioObjectUnknown;
    return kAudioHardwareUnsupportedOperationError;
}

OSStatus destroyDevice(AudioServerPlugInDriverRef, AudioObjectID) {
    return kAudioHardwareUnsupportedOperationError;
}

OSStatus deviceClient(AudioServerPlugInDriverRef reference, AudioObjectID id,
                      const AudioServerPlugInClientInfo*) {
    return reference == driver && id == deviceID ? OSStatus(noErr) : OSStatus(kAudioHardwareBadObjectError);
}

OSStatus configurationChange(AudioServerPlugInDriverRef, AudioObjectID, UInt64, void*) {
    return kAudioHardwareUnsupportedOperationError; // Format and topology are fixed.
}

Boolean hasProperty(AudioServerPlugInDriverRef reference, AudioObjectID id, pid_t,
                    const AudioObjectPropertyAddress* address) {
    if (reference != driver) return false;
    // UID translation requires a qualifier only when reading the value.
    if (id == kAudioObjectPlugInObject && address && address->mScope == globalScope &&
        address->mElement == kAudioObjectPropertyElementMain &&
        address->mSelector == kAudioPlugInPropertyTranslateUIDToDevice) return true;
    Property value;
    return property(id, address, 0, nullptr, value) == noErr;
}

OSStatus isSettable(AudioServerPlugInDriverRef reference, AudioObjectID id, pid_t pid,
                    const AudioObjectPropertyAddress* address, Boolean* out) {
    if (!out) return kAudioHardwareIllegalOperationError;
    *out = false;
    if (reference != driver || !isObject(id)) return kAudioHardwareBadObjectError;
    if (!hasProperty(reference, id, pid, address)) return kAudioHardwareUnknownPropertyError;
    const auto key = address->mSelector;
    *out = (id == deviceID && key == kAudioDevicePropertyNominalSampleRate) ||
        (isStream(id) && (key == kAudioStreamPropertyIsActive ||
                        key == kAudioStreamPropertyPhysicalFormat || key == kAudioStreamPropertyVirtualFormat));
    return noErr;
}

OSStatus getSize(AudioServerPlugInDriverRef reference, AudioObjectID id, pid_t,
                 const AudioObjectPropertyAddress* address, UInt32 qualifierSize,
                 const void* qualifier, UInt32* out) {
    if (!out) return kAudioHardwareIllegalOperationError;
    *out = 0;
    if (reference != driver) return kAudioHardwareBadObjectError;
    if (id == kAudioObjectPlugInObject && address &&
        address->mSelector == kAudioPlugInPropertyTranslateUIDToDevice &&
        hasProperty(reference, id, 0, address)) {
        *out = sizeof(AudioObjectID);
        return noErr;
    }
    Property value;
    const auto error = property(id, address, qualifierSize, qualifier, value);
    if (!error) *out = value.size;
    return error;
}

OSStatus getData(AudioServerPlugInDriverRef reference, AudioObjectID id, pid_t,
                 const AudioObjectPropertyAddress* address, UInt32 qualifierSize,
                 const void* qualifier, UInt32 capacity, UInt32* written, void* out) {
    if (!written) return kAudioHardwareIllegalOperationError;
    *written = 0;
    if (reference != driver) return kAudioHardwareBadObjectError;
    Property value;
    const auto error = property(id, address, qualifierSize, qualifier, value);
    if (error) return error;
    const auto size = value.elementSize ? std::min(value.size, capacity / value.elementSize * value.elementSize) : value.size;
    if (capacity < size) return kAudioHardwareBadPropertySizeError;
    if (size && !out) return kAudioHardwareIllegalOperationError;
    if (value.string) CFRetain(value.string);
    if (size) std::memcpy(out, value.data.data(), size);
    *written = size;
    return noErr;
}

void notify(AudioObjectID id, AudioObjectPropertySelector selector) {
    const AudioObjectPropertyAddress address{selector, globalScope, kAudioObjectPropertyElementMain};
    if (host && host->PropertiesChanged) host->PropertiesChanged(host, id, 1, &address);
}

OSStatus setData(AudioServerPlugInDriverRef reference, AudioObjectID id, pid_t pid,
                 const AudioObjectPropertyAddress* address, UInt32, const void*,
                 UInt32 size, const void* data) {
    Boolean writable = false;
    const auto error = isSettable(reference, id, pid, address, &writable);
    if (error) return error;
    if (!writable) return kAudioHardwareUnsupportedOperationError;
    if (!data) return kAudioHardwareIllegalOperationError;
    if (id == deviceID) {
        if (size != sizeof(Float64)) return kAudioHardwareBadPropertySizeError;
        Float64 rate;
        std::memcpy(&rate, data, size);
        return rate == room::sampleRate ? OSStatus(noErr) : OSStatus(kAudioDeviceUnsupportedFormatError);
    }
    if (address->mSelector == kAudioStreamPropertyIsActive) {
        if (size != sizeof(UInt32)) return kAudioHardwareBadPropertySizeError;
        UInt32 active;
        std::memcpy(&active, data, size);
        auto& state = id == inputID ? inputActive : outputActive;
        if (state.exchange(active != 0) != (active != 0)) notify(id, kAudioStreamPropertyIsActive);
        return noErr;
    }
    if (size != sizeof(AudioStreamBasicDescription)) return kAudioHardwareBadPropertySizeError;
    AudioStreamBasicDescription requested;
    std::memcpy(&requested, data, size);
    const auto expected = format();
    const bool match = requested.mSampleRate == expected.mSampleRate && requested.mFormatID == expected.mFormatID &&
        requested.mFormatFlags == expected.mFormatFlags && requested.mBytesPerPacket == expected.mBytesPerPacket &&
        requested.mFramesPerPacket == expected.mFramesPerPacket && requested.mBytesPerFrame == expected.mBytesPerFrame &&
        requested.mChannelsPerFrame == expected.mChannelsPerFrame && requested.mBitsPerChannel == expected.mBitsPerChannel;
    return match ? OSStatus(noErr) : OSStatus(kAudioDeviceUnsupportedFormatError);
}

OSStatus startIO(AudioServerPlugInDriverRef reference, AudioObjectID id, UInt32) {
    if (reference != driver || id != deviceID) return kAudioHardwareBadObjectError;
    bool changed;
    {
        std::lock_guard lock(controlMutex);
        if (!host || running.load() == UINT32_MAX) return kAudioHardwareIllegalOperationError;
        changed = running.load() == 0;
        if (changed) loopback.clear();
        running.fetch_add(1);
    }
    if (changed) notify(deviceID, kAudioDevicePropertyDeviceIsRunning);
    return noErr;
}

OSStatus stopIO(AudioServerPlugInDriverRef reference, AudioObjectID id, UInt32) {
    if (reference != driver || id != deviceID) return kAudioHardwareBadObjectError;
    bool changed;
    {
        std::lock_guard lock(controlMutex);
        if (!running.load()) return kAudioHardwareIllegalOperationError;
        changed = running.fetch_sub(1) == 1;
    }
    if (changed) notify(deviceID, kAudioDevicePropertyDeviceIsRunning);
    return noErr;
}

OSStatus zeroTimestamp(AudioServerPlugInDriverRef reference, AudioObjectID id, UInt32,
                       Float64* sampleTime, UInt64* hostTime, UInt64* seed) {
    if (reference != driver || id != deviceID) return kAudioHardwareBadObjectError;
    if (!sampleTime || !hostTime || !seed || !clockAnchor) return kAudioHardwareIllegalOperationError;
    const auto now = mach_absolute_time();
    const auto periods = std::floor((now - clockAnchor) / (ticksPerFrame * room::timestampPeriod));
    *sampleTime = periods * room::timestampPeriod;
    *hostTime = clockAnchor + static_cast<UInt64>(*sampleTime * ticksPerFrame);
    *seed = 1; // Clock follows mach_absolute_time continuously, including while IO is stopped.
    return noErr;
}

OSStatus willDoIO(AudioServerPlugInDriverRef reference, AudioObjectID id, UInt32,
                  UInt32 operation, Boolean* willDo, Boolean* inPlace) {
    if (reference != driver || id != deviceID) return kAudioHardwareBadObjectError;
    if (!willDo || !inPlace) return kAudioHardwareIllegalOperationError;
    *willDo = operation == kAudioServerPlugInIOOperationReadInput || operation == kAudioServerPlugInIOOperationWriteMix;
    *inPlace = true;
    return noErr;
}

OSStatus ioBoundary(AudioServerPlugInDriverRef reference, AudioObjectID id, UInt32, UInt32,
                     UInt32, const AudioServerPlugInIOCycleInfo*) {
    return reference == driver && id == deviceID ? OSStatus(noErr) : OSStatus(kAudioHardwareBadObjectError);
}

OSStatus doIO(AudioServerPlugInDriverRef reference, AudioObjectID id, AudioObjectID stream, UInt32,
               UInt32 operation, UInt32 count, const AudioServerPlugInIOCycleInfo* cycle,
               void* buffer, void*) {
    if (reference != driver || id != deviceID || !isStream(stream)) return kAudioHardwareBadObjectError;
    if (!cycle || (count && !buffer)) return kAudioHardwareIllegalOperationError;
    if (count > room::ringFrames) return kAudioHardwareBadPropertySizeError;
    const bool read = operation == kAudioServerPlugInIOOperationReadInput;
    if ((!read && operation != kAudioServerPlugInIOOperationWriteMix) ||
        stream != (read ? inputID : outputID)) return kAudioHardwareUnsupportedOperationError;
    const double time = read ? cycle->mInputTime.mSampleTime : cycle->mOutputTime.mSampleTime;
    if (!std::isfinite(time) || std::abs(time) > 9e15) return kAudioHardwareIllegalOperationError;
    auto* samples = static_cast<float*>(buffer);
    const auto start = static_cast<int64_t>(std::floor(time));
    if (read) {
        if (running.load() && inputActive.load()) loopback.read(start - room::latencyFrames, count, samples);
        else if (count) std::memset(samples, 0, count * room::channels * sizeof(float));
    } else if (running.load() && outputActive.load()) {
        loopback.write(start, count, samples);
    }
    return noErr;
}

AudioServerPlugInDriverInterface driverInterface{
    ._reserved = nullptr,
    .QueryInterface = queryInterface,
    .AddRef = addRef,
    .Release = release,
    .Initialize = initialize,
    .CreateDevice = createDevice,
    .DestroyDevice = destroyDevice,
    .AddDeviceClient = deviceClient,
    .RemoveDeviceClient = deviceClient,
    .PerformDeviceConfigurationChange = configurationChange,
    .AbortDeviceConfigurationChange = configurationChange,
    .HasProperty = hasProperty,
    .IsPropertySettable = isSettable,
    .GetPropertyDataSize = getSize,
    .GetPropertyData = getData,
    .SetPropertyData = setData,
    .StartIO = startIO,
    .StopIO = stopIO,
    .GetZeroTimeStamp = zeroTimestamp,
    .WillDoIOOperation = willDoIO,
    .BeginIOOperation = ioBoundary,
    .DoIOOperation = doIO,
    .EndIOOperation = ioBoundary,
};

} // namespace

extern "C" __attribute__((visibility("default")))
void* RoomCable_Create(CFAllocatorRef, CFUUIDRef type) {
    return type && CFEqual(type, kAudioServerPlugInTypeUUID) ? driver : nullptr;
}
