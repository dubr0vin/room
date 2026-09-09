#pragma once

#include <array>
#include <atomic>
#include <bit>
#include <cstdint>
#include <limits>

namespace room {

inline constexpr double sampleRate = 48000;
inline constexpr uint32_t channels = 2;
inline constexpr uint32_t latencyFrames = 512;
inline constexpr uint32_t ringFrames = 65536;
inline constexpr uint32_t timestampPeriod = 16384;

// One producer (Core Audio's final output mix), any number of readers.
// Absolute frame tags prevent old audio from replaying after silence or wraparound.
// All accesses are atomic: a reader never races with a writer in the C++ memory model.
class Loopback {
    static constexpr int64_t empty = std::numeric_limits<int64_t>::min();

    struct Frame {
        std::atomic<int64_t> time{empty};
        std::atomic<uint64_t> samples{0};
    };

    std::array<Frame, ringFrames> frames_{};

public:
    static_assert(std::atomic<uint64_t>::is_always_lock_free);
    static_assert(std::atomic<int64_t>::is_always_lock_free);

    // Called only when the device has no running IO clients.
    void clear() noexcept {
        for (auto& frame : frames_) frame.time.store(empty);
    }

    void write(int64_t start, uint32_t count, const float* data) noexcept {
        for (uint32_t i = 0; i < count; ++i) {
            const auto time = start + i;
            auto& frame = frames_[static_cast<uint64_t>(time) % ringFrames];
            const std::array<float, 2> stereo{data[2 * i], data[2 * i + 1]};
            // Invalidate before overwriting. Sequential consistency is intentional:
            // the two tag reads below must bracket this exact sample pair.
            frame.time.store(empty);
            frame.samples.store(std::bit_cast<uint64_t>(stereo));
            frame.time.store(time);
        }
    }

    void read(int64_t start, uint32_t count, float* data) const noexcept {
        for (uint32_t i = 0; i < count; ++i) {
            const auto time = start + i;
            const auto& frame = frames_[static_cast<uint64_t>(time) % ringFrames];
            std::array<float, 2> stereo{};
            if (frame.time.load() == time) {
                const auto samples = frame.samples.load();
                if (frame.time.load() == time) stereo = std::bit_cast<decltype(stereo)>(samples);
            }
            data[2 * i] = stereo[0];
            data[2 * i + 1] = stereo[1];
        }
    }
};

} // namespace room
