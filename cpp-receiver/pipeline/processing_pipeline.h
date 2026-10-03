#pragma once

#include "frame_types.h"
#include "frame_queue.h"
#include "view_generator.h"
#include "latency_tracker.h"

#include <memory>
#include <thread>
#include <atomic>
#include <functional>
#include <iostream>
#include <iomanip>

namespace holo {

/// Callback type for consuming processed quad-view output.
/// Called on the processing thread whenever a new set of 4 views is ready.
using OutputCallback = std::function<void(const QuadViewOutput&)>;

/// Main pipeline orchestrator that connects:
///   WebRTC receiver → lock-free queue → processing thread → view generator → output
///
/// Design:
/// - Producer (WebRTC thread) calls submitFrame() — never blocks
/// - Processing thread pops newest frame, generates 4 views, updates output
/// - Consumer reads latest output via getLatestOutput() — never blocks
/// - All buffers pre-allocated at construction
///
/// Thread safety:
/// - submitFrame() is safe to call from any single producer thread
/// - getLatestOutput() is safe to call from any single consumer thread
/// - start()/stop() must be called from the same thread
class ProcessingPipeline {
public:
    /// @param generator   View generation strategy (takes ownership)
    /// @param frameWidth  Expected frame width (for pre-allocation)
    /// @param frameHeight Expected frame height (for pre-allocation)
    ProcessingPipeline(std::unique_ptr<IViewGenerator> generator,
                       uint32_t frameWidth = 640,
                       uint32_t frameHeight = 300)
        : m_viewGen(std::move(generator))
        , m_inputQueue(frameWidth, frameHeight)
        , m_processingBuffer(frameWidth, frameHeight)
        , m_frameWidth(frameWidth)
        , m_frameHeight(frameHeight)
    {
        // Pre-allocate double-buffered output
        for (int i = 0; i < 2; ++i) {
            m_outputBuffers[i] = QuadViewOutput(frameWidth, frameHeight);
        }

        // Pre-allocate composite buffer (2x2 grid = double width × double height)
        m_compositeBuffer = FrameBuffer(frameWidth * 2, frameHeight * 2);

        std::cout << "[Pipeline] Created with strategy: " << m_viewGen->name()
                  << " (" << frameWidth << "x" << frameHeight << " → 4 views)"
                  << std::endl;
    }

    ~ProcessingPipeline() {
        stop();
    }

    // Non-copyable, non-movable
    ProcessingPipeline(const ProcessingPipeline&) = delete;
    ProcessingPipeline& operator=(const ProcessingPipeline&) = delete;

    /// Start the processing thread
    void start() {
        if (m_running.exchange(true)) return; // Already running

        m_thread = std::thread(&ProcessingPipeline::processingLoop, this);

        std::cout << "[Pipeline] Processing thread started" << std::endl;
    }

    /// Stop the processing thread (blocks until joined)
    void stop() {
        if (!m_running.exchange(false)) return; // Already stopped

        if (m_thread.joinable()) {
            m_thread.join();
        }

        std::cout << "[Pipeline] Processing thread stopped"
                  << " | Processed: " << m_processedFrames.load()
                  << " | Dropped: " << m_inputQueue.droppedFrames()
                  << std::endl;
    }

    /// Producer: submit a new frame for processing.
    /// Called from the WebRTC callback thread.
    /// NEVER blocks. If the queue is full, the oldest frame is dropped.
    void submitFrame(const uint8_t* pixels, uint32_t w, uint32_t h,
                     uint64_t frameId, uint64_t timestampUs = 0) {
        m_inputQueue.push(pixels, w, h, frameId, timestampUs);
        m_totalSubmitted.fetch_add(1, std::memory_order_relaxed);
    }

    /// Consumer: get the latest processed quad-view output.
    /// Returns true if a new output is available (different from last call).
    /// The output is copied into the provided buffer.
    /// NEVER blocks.
    bool getLatestOutput(QuadViewOutput& output) {
        int readIdx = m_readableOutput.load(std::memory_order_acquire);
        if (readIdx < 0) return false;

        const auto& src = m_outputBuffers[readIdx];
        if (src.sourceFrameId == m_lastConsumedFrameId) return false;

        // Copy output (pre-allocated buffers, just memcpy of pixel data)
        for (int v = 0; v < 4; ++v) {
            output.views[v].copyFrom(
                src.views[v].pixels.data(),
                src.views[v].width, src.views[v].height,
                src.views[v].frameId, src.views[v].timestampUs
            );
        }
        output.sourceFrameId = src.sourceFrameId;
        output.processingTimeMs = src.processingTimeMs;

        m_lastConsumedFrameId = src.sourceFrameId;
        return true;
    }

    /// Get the latest composite (2x2 grid) buffer pointer.
    /// Returns nullptr if no output is available yet.
    const FrameBuffer* getLatestComposite() {
        int readIdx = m_readableOutput.load(std::memory_order_acquire);
        if (readIdx < 0) return nullptr;
        return &m_compositeBuffer;
    }

    /// Register a callback to receive processed output on the processing thread
    void setOutputCallback(OutputCallback cb) {
        m_outputCallback = std::move(cb);
    }

    // ---- Stats ----
    uint64_t processedFrames() const { return m_processedFrames.load(std::memory_order_relaxed); }
    uint64_t droppedFrames() const { return m_inputQueue.droppedFrames(); }
    uint64_t totalSubmitted() const { return m_totalSubmitted.load(std::memory_order_relaxed); }
    double lastProcessingTimeMs() const { return m_lastProcessingTimeMs.load(std::memory_order_relaxed); }

private:
    void processingLoop() {
        std::cout << "[Pipeline] Processing loop started on dedicated thread" << std::endl;

        int writeIdx = 0; // Alternates between 0 and 1 (double buffer)

        while (m_running.load(std::memory_order_relaxed)) {
            // Try to pop the newest frame
            if (!m_inputQueue.tryPop(m_processingBuffer)) {
                // No frame available — backoff to avoid busy-spinning
                // Start with yield, escalate to sleep after repeated misses
                std::this_thread::yield();
                m_idleSpins++;
                if (m_idleSpins > 1000) {
                    std::this_thread::sleep_for(std::chrono::microseconds(500));
                }
                if (m_idleSpins > 10000) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(1));
                }
                continue;
            }

            m_idleSpins = 0; // Reset backoff on successful pop

            // ---- Process the frame ----
            m_tracker.frameStart();

            // Generate 4 views into the write-side output buffer
            QuadViewOutput& outputBuf = m_outputBuffers[writeIdx];
            m_viewGen->generate(m_processingBuffer, outputBuf);

            m_tracker.stageDone("viewgen");

            // Composite into 2x2 grid
            compositeViews(outputBuf);

            m_tracker.stageDone("composite");

            // Finalize output
            outputBuf.sourceFrameId = m_processingBuffer.frameId;

            m_tracker.frameEnd();
            outputBuf.processingTimeMs = m_tracker.lastTotalMs();

            // Swap readable output atomically
            m_readableOutput.store(writeIdx, std::memory_order_release);
            writeIdx = 1 - writeIdx; // Flip double buffer

            // Update stats
            m_processedFrames.fetch_add(1, std::memory_order_relaxed);
            m_lastProcessingTimeMs.store(m_tracker.lastTotalMs(), std::memory_order_relaxed);

            // Fire callback if registered
            if (m_outputCallback) {
                m_outputCallback(outputBuf);
            }

            // Print stats periodically (every 60 frames ≈ 2 seconds at 30fps)
            if (m_tracker.printStats(60)) {
                std::cout << "[Pipeline] Queue drops: " << m_inputQueue.droppedFrames()
                          << " | Submitted: " << m_totalSubmitted.load()
                          << " | Processed: " << m_processedFrames.load()
                          << std::endl;
            }
        }
    }

    /// Compose 4 views into a single 2×2 grid image
    void compositeViews(const QuadViewOutput& quad) {
        uint32_t w = m_frameWidth;
        uint32_t h = m_frameHeight;
        uint32_t compositeW = w * 2;
        uint32_t stride = compositeW * 4; // RGBA

        uint8_t* dst = m_compositeBuffer.pixels.data();

        // View layout:
        //  ┌───────┬───────┐
        //  │ V0    │ V1    │
        //  │(Front)│(Left) │
        //  ├───────┼───────┤
        //  │ V2    │ V3    │
        //  │(Right)│(Top)  │
        //  └───────┴───────┘

        for (uint32_t row = 0; row < h; ++row) {
            // Top-left: View 0 (Front)
            std::memcpy(
                dst + row * stride,
                quad.views[VIEW_FRONT].pixels.data() + row * w * 4,
                w * 4
            );
            // Top-right: View 1 (Left)
            std::memcpy(
                dst + row * stride + w * 4,
                quad.views[VIEW_LEFT].pixels.data() + row * w * 4,
                w * 4
            );
        }
        for (uint32_t row = 0; row < h; ++row) {
            // Bottom-left: View 2 (Right)
            std::memcpy(
                dst + (h + row) * stride,
                quad.views[VIEW_RIGHT].pixels.data() + row * w * 4,
                w * 4
            );
            // Bottom-right: View 3 (Top)
            std::memcpy(
                dst + (h + row) * stride + w * 4,
                quad.views[VIEW_TOP].pixels.data() + row * w * 4,
                w * 4
            );
        }

        m_compositeBuffer.frameId = quad.sourceFrameId;
    }

    // ---- Members ----
    std::unique_ptr<IViewGenerator> m_viewGen;
    SPSCFrameQueue m_inputQueue;
    FrameBuffer m_processingBuffer;       // Reusable buffer for popped frame
    uint32_t m_frameWidth;
    uint32_t m_frameHeight;

    // Double-buffered output
    QuadViewOutput m_outputBuffers[2];
    FrameBuffer m_compositeBuffer;        // 2x2 grid composite
    std::atomic<int> m_readableOutput{-1};
    uint64_t m_lastConsumedFrameId = 0;

    // Threading
    std::atomic<bool> m_running{false};
    std::thread m_thread;
    uint64_t m_idleSpins = 0;

    // Callback
    OutputCallback m_outputCallback;

    // Metrics
    LatencyTracker m_tracker;
    std::atomic<uint64_t> m_processedFrames{0};
    std::atomic<uint64_t> m_totalSubmitted{0};
    std::atomic<double> m_lastProcessingTimeMs{0.0};
};

} // namespace holo
