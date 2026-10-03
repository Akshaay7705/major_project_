#pragma once

#include "frame_types.h"
#include <atomic>
#include <array>
#include <cstring>

namespace holo {

/// Lock-free Single-Producer Single-Consumer (SPSC) frame queue.
///
/// Design principles:
/// - Capacity of 2 (double-buffer): minimizes latency, ensures newest frame wins
/// - Producer never blocks: if queue is full, oldest frame is silently dropped
/// - Consumer always gets the newest available frame
/// - All FrameBuffers are pre-allocated at construction (zero runtime malloc)
/// - Uses std::atomic with acquire/release semantics (no mutex on hot path)
///
/// Thread safety:
/// - Exactly ONE producer thread may call push()
/// - Exactly ONE consumer thread may call tryPop()
/// - No other synchronization is needed
class SPSCFrameQueue {
public:
    static constexpr int CAPACITY = 2;

    explicit SPSCFrameQueue(uint32_t frameWidth = 640, uint32_t frameHeight = 300) {
        for (int i = 0; i < CAPACITY; ++i) {
            m_slots[i] = FrameBuffer(frameWidth, frameHeight);
            m_slotReady[i].store(false, std::memory_order_relaxed);
        }
    }

    /// Producer: push a frame into the queue.
    /// If the queue is full, the oldest unread frame is overwritten (dropped).
    /// Returns true if a frame was dropped to make room.
    bool push(const uint8_t* pixels, uint32_t w, uint32_t h,
              uint64_t frameId, uint64_t timestampUs) {
        int slot = m_writeIdx % CAPACITY;
        bool dropped = m_slotReady[slot].load(std::memory_order_acquire);

        // Copy pixel data into the pre-allocated slot
        m_slots[slot].copyFrom(pixels, w, h, frameId, timestampUs);

        // Mark slot as ready for consumer
        m_slotReady[slot].store(true, std::memory_order_release);
        m_writeIdx++;

        if (dropped) {
            m_droppedFrames.fetch_add(1, std::memory_order_relaxed);
        }
        return dropped;
    }

    /// Consumer: try to pop the newest available frame.
    /// Copies data into the provided output buffer.
    /// Returns true if a frame was available, false if queue is empty.
    bool tryPop(FrameBuffer& output) {
        // Scan slots to find the newest ready frame
        // With capacity=2, this is just checking both slots
        int newestSlot = -1;
        uint64_t newestFrameId = 0;

        for (int i = 0; i < CAPACITY; ++i) {
            if (m_slotReady[i].load(std::memory_order_acquire)) {
                if (newestSlot == -1 || m_slots[i].frameId > newestFrameId) {
                    newestSlot = i;
                    newestFrameId = m_slots[i].frameId;
                }
            }
        }

        if (newestSlot == -1) {
            return false; // No frames available
        }

        // Copy from slot to output (reuses output's pre-allocated memory)
        output.copyFrom(m_slots[newestSlot].pixels.data(),
                        m_slots[newestSlot].width,
                        m_slots[newestSlot].height,
                        m_slots[newestSlot].frameId,
                        m_slots[newestSlot].timestampUs);

        // Mark ALL slots as consumed (we only care about the newest)
        for (int i = 0; i < CAPACITY; ++i) {
            m_slotReady[i].store(false, std::memory_order_release);
        }

        return true;
    }

    /// Stats: total frames dropped due to queue overflow
    uint64_t droppedFrames() const {
        return m_droppedFrames.load(std::memory_order_relaxed);
    }

private:
    std::array<FrameBuffer, CAPACITY> m_slots;
    std::array<std::atomic<bool>, CAPACITY> m_slotReady;
    int m_writeIdx = 0; // Only accessed by producer thread

    std::atomic<uint64_t> m_droppedFrames{0};
};

} // namespace holo
