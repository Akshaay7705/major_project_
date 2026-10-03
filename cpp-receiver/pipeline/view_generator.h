#pragma once

#include "frame_types.h"

namespace holo {

/// Abstract interface for view generation strategies.
/// Implementations must generate 4 views from a single input frame.
///
/// Contract:
/// - `input` contains valid RGBA pixel data
/// - `output.views[0..3]` are pre-allocated with matching dimensions
/// - Implementation MUST write all 4 views on every call
/// - Implementation MUST NOT allocate memory per-frame
/// - Implementation SHOULD be deterministic for the same input
class IViewGenerator {
public:
    virtual ~IViewGenerator() = default;

    /// Generate 4 views from the input frame.
    /// @param input   Source frame (RGBA, typically 640x300)
    /// @param output  Pre-allocated output with 4 view buffers
    virtual void generate(const FrameBuffer& input, QuadViewOutput& output) = 0;

    /// Human-readable name for logging
    virtual const char* name() const = 0;

    /// Expected processing time hint (for scheduling decisions)
    virtual double expectedLatencyMs() const { return 1.0; }
};

} // namespace holo
