#pragma once

#include "view_generator.h"
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/geometry/2d.hpp>  // getPerspectiveTransform (moved here in OpenCV 5)
#include <array>
#include <iostream>

namespace holo {

/// Approach 1: Simple geometric perspective transform view generator.
///
/// Creates 4 views by applying pre-computed perspective warp matrices
/// to the input frame. This produces a "parallax" effect by simulating
/// different camera viewpoints, but does NOT generate genuine 3D views.
///
/// View layout:
///   View 0 (Front):  Identity + slight zoom — direct frontal view
///   View 1 (Left):   Perspective warp simulating ~15° left camera
///   View 2 (Right):  Perspective warp simulating ~15° right camera
///   View 3 (Top):    Perspective warp simulating elevated camera
///
/// Performance: All matrices are pre-computed at construction.
/// Per-frame cost is just 4x cv::warpPerspective calls (~0.3-0.5ms total at 640x300).
class SimpleViewGenerator : public IViewGenerator {
public:
    /// @param angleDeg   Angular separation for side views (degrees)
    /// @param topAngleDeg Angular separation for top view (degrees)
    SimpleViewGenerator(float angleDeg = 15.0f, float topAngleDeg = 10.0f)
        : m_angleDeg(angleDeg)
        , m_topAngleDeg(topAngleDeg)
    {
    }

    /// Initialize/update warp matrices for given frame dimensions.
    /// Must be called before generate() if dimensions change.
    void initForSize(uint32_t width, uint32_t height) {
        if (width == m_width && height == m_height) return;

        m_width = width;
        m_height = height;

        float w = static_cast<float>(width);
        float h = static_cast<float>(height);

        // ---- View 0: Front (slight zoom/crop for "camera" feel) ----
        {
            float inset = w * 0.02f; // 2% crop
            cv::Point2f src[4] = {
                {inset, inset}, {w - inset, inset},
                {w - inset, h - inset}, {inset, h - inset}
            };
            cv::Point2f dst[4] = {
                {0, 0}, {w, 0}, {w, h}, {0, h}
            };
            m_warpMatrices[VIEW_FRONT] = cv::getPerspectiveTransform(src, dst);
        }

        // ---- View 1: Left (~angleDeg perspective shift to the left) ----
        {
            // Compress the left edge, expand the right edge
            float shift = w * (m_angleDeg / 100.0f);
            cv::Point2f src[4] = {
                {0, 0}, {w, 0}, {w, h}, {0, h}
            };
            cv::Point2f dst[4] = {
                {shift, shift * 0.3f},        // top-left moves right & down slightly
                {w, 0},                        // top-right stays
                {w, h},                        // bottom-right stays
                {shift, h - shift * 0.3f}      // bottom-left moves right & up slightly
            };
            m_warpMatrices[VIEW_LEFT] = cv::getPerspectiveTransform(src, dst);
        }

        // ---- View 2: Right (~angleDeg perspective shift to the right) ----
        {
            float shift = w * (m_angleDeg / 100.0f);
            cv::Point2f src[4] = {
                {0, 0}, {w, 0}, {w, h}, {0, h}
            };
            cv::Point2f dst[4] = {
                {0, 0},                              // top-left stays
                {w - shift, shift * 0.3f},            // top-right moves left & down
                {w - shift, h - shift * 0.3f},        // bottom-right moves left & up
                {0, h}                                // bottom-left stays
            };
            m_warpMatrices[VIEW_RIGHT] = cv::getPerspectiveTransform(src, dst);
        }

        // ---- View 3: Top (elevated camera — compress bottom, expand top) ----
        {
            float shift = h * (m_topAngleDeg / 100.0f);
            cv::Point2f src[4] = {
                {0, 0}, {w, 0}, {w, h}, {0, h}
            };
            cv::Point2f dst[4] = {
                {0, 0},                           // top-left stays
                {w, 0},                            // top-right stays
                {w - shift * 0.5f, h - shift},     // bottom-right compresses inward & up
                {shift * 0.5f, h - shift}           // bottom-left compresses inward & up
            };
            m_warpMatrices[VIEW_TOP] = cv::getPerspectiveTransform(src, dst);
        }

        std::cout << "[SimpleViewGen] Initialized for " << width << "x" << height
                  << " (angle=" << m_angleDeg << "°, topAngle=" << m_topAngleDeg << "°)"
                  << std::endl;
    }

    void generate(const FrameBuffer& input, QuadViewOutput& output) override {
        // Lazy init on first frame (or if dimensions changed)
        initForSize(input.width, input.height);

        // Wrap input as cv::Mat (zero-copy)
        cv::Mat srcMat = input.asMat();

        // Apply all 4 perspective warps
        for (int i = 0; i < 4; ++i) {
            cv::Mat dstMat = output.views[i].asMat();

            cv::warpPerspective(
                srcMat, dstMat,
                m_warpMatrices[i],
                cv::Size(static_cast<int>(input.width), static_cast<int>(input.height)),
                cv::INTER_LINEAR,       // Fast bilinear interpolation
                cv::BORDER_REPLICATE    // Replicate edge pixels (avoid black borders)
            );

            // Copy metadata
            output.views[i].frameId = input.frameId;
            output.views[i].timestampUs = input.timestampUs;
        }

        output.sourceFrameId = input.frameId;
    }

    const char* name() const override { return "SimpleGeometricTransform"; }
    double expectedLatencyMs() const override { return 0.5; }

    /// Update angle at runtime (e.g., from command-line or config)
    void setAngle(float angleDeg) {
        m_angleDeg = angleDeg;
        m_width = 0; m_height = 0; // Force re-init
    }

    void setTopAngle(float topAngleDeg) {
        m_topAngleDeg = topAngleDeg;
        m_width = 0; m_height = 0;
    }

private:
    float m_angleDeg;
    float m_topAngleDeg;
    uint32_t m_width = 0;
    uint32_t m_height = 0;

    std::array<cv::Mat, 4> m_warpMatrices;
};

} // namespace holo
