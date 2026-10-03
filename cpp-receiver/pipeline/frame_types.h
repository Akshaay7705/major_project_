#pragma once

#include <cstdint>
#include <vector>
#include <chrono>

#ifdef HAS_OPENCV
#include <opencv2/core.hpp>
#endif

namespace holo {

/// Pre-allocated frame buffer for zero-copy pipeline processing.
/// All memory is allocated once at construction and reused every frame.
struct FrameBuffer {
    std::vector<uint8_t> pixels;    // Raw RGBA pixel data
    uint32_t width  = 0;
    uint32_t height = 0;
    uint32_t channels = 4;          // Always RGBA
    uint64_t frameId = 0;
    uint64_t timestampUs = 0;       // Source timestamp in microseconds

    FrameBuffer() = default;

    /// Pre-allocate for known dimensions
    explicit FrameBuffer(uint32_t w, uint32_t h)
        : width(w), height(h), channels(4)
    {
        pixels.resize(static_cast<size_t>(w) * h * channels, 0);
    }

    /// Total byte size of pixel data
    size_t byteSize() const {
        return static_cast<size_t>(width) * height * channels;
    }

    /// Reset metadata without reallocating pixel memory
    void reset(uint32_t w, uint32_t h, uint64_t fid, uint64_t ts) {
        // Only reallocate if dimensions changed (should never happen in steady state)
        if (w != width || h != height) {
            width = w;
            height = h;
            pixels.resize(static_cast<size_t>(w) * h * channels, 0);
        }
        frameId = fid;
        timestampUs = ts;
    }

    /// Copy raw pixel data into this buffer (used by producer)
    void copyFrom(const uint8_t* src, uint32_t w, uint32_t h, uint64_t fid, uint64_t ts) {
        reset(w, h, fid, ts);
        std::memcpy(pixels.data(), src, byteSize());
    }

#ifdef HAS_OPENCV
    /// Wrap pixel data as cv::Mat WITHOUT copying.
    /// The cv::Mat does NOT own the memory — FrameBuffer must outlive the Mat.
    cv::Mat asMat() {
        return cv::Mat(static_cast<int>(height), static_cast<int>(width),
                       CV_8UC4, pixels.data());
    }

    const cv::Mat asMat() const {
        return cv::Mat(static_cast<int>(height), static_cast<int>(width),
                       CV_8UC4, const_cast<uint8_t*>(pixels.data()));
    }
#endif
};

/// Output container holding 4 synchronized views + metadata.
/// All 4 view buffers are pre-allocated at construction.
struct QuadViewOutput {
    FrameBuffer views[4];           // Front, Left, Right, Top
    uint64_t sourceFrameId = 0;
    double processingTimeMs = 0.0;  // Total time to generate all 4 views

    QuadViewOutput() = default;

    /// Pre-allocate all 4 views for known dimensions
    explicit QuadViewOutput(uint32_t w, uint32_t h) {
        for (int i = 0; i < 4; ++i) {
            views[i] = FrameBuffer(w, h);
        }
    }
};

/// Indices for the 4 views
enum ViewIndex : int {
    VIEW_FRONT = 0,
    VIEW_LEFT  = 1,
    VIEW_RIGHT = 2,
    VIEW_TOP   = 3
};

} // namespace holo
