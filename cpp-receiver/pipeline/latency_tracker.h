#pragma once

#include <chrono>
#include <string>
#include <vector>
#include <iostream>
#include <iomanip>
#include <numeric>

namespace holo {

/// Per-frame latency measurement with stage-level breakdown.
/// Tracks rolling averages and prints formatted stats.
///
/// Usage:
///   tracker.frameStart();
///   // ... do preprocessing ...
///   tracker.stageDone("preprocess");
///   // ... generate views ...
///   tracker.stageDone("viewgen");
///   tracker.frameEnd();
///   tracker.printStats(60);  // Print every 60 frames
class LatencyTracker {
public:
    using Clock = std::chrono::steady_clock;
    using TimePoint = Clock::time_point;

    void frameStart() {
        m_frameStart = Clock::now();
        m_stages.clear();
        m_lastStageEnd = m_frameStart;
    }

    void stageDone(const char* stageName) {
        auto now = Clock::now();
        double ms = std::chrono::duration<double, std::milli>(now - m_lastStageEnd).count();
        m_stages.push_back({stageName, ms});
        m_lastStageEnd = now;
    }

    void frameEnd() {
        auto now = Clock::now();
        double totalMs = std::chrono::duration<double, std::milli>(now - m_frameStart).count();
        m_frameCount++;

        // Update rolling averages (exponential moving average, alpha=0.05)
        constexpr double alpha = 0.05;
        if (m_frameCount == 1) {
            m_avgTotalMs = totalMs;
            m_avgStages.clear();
            for (const auto& s : m_stages) {
                m_avgStages.push_back({s.name, s.ms});
            }
        } else {
            m_avgTotalMs = m_avgTotalMs * (1.0 - alpha) + totalMs * alpha;
            // Update per-stage averages
            for (size_t i = 0; i < m_stages.size() && i < m_avgStages.size(); ++i) {
                m_avgStages[i].ms = m_avgStages[i].ms * (1.0 - alpha) + m_stages[i].ms * alpha;
            }
        }

        m_lastTotalMs = totalMs;

        // Track min/max
        if (totalMs < m_minTotalMs) m_minTotalMs = totalMs;
        if (totalMs > m_maxTotalMs) m_maxTotalMs = totalMs;
    }

    /// Print stats every N frames. Returns true if stats were printed.
    bool printStats(uint64_t everyNFrames = 60) {
        if (m_frameCount == 0 || m_frameCount % everyNFrames != 0) {
            return false;
        }

        std::cout << "[Hologram Pipeline] Frame #" << m_frameCount
                  << " | Total: " << std::fixed << std::setprecision(2)
                  << m_avgTotalMs << "ms avg"
                  << " (last: " << m_lastTotalMs << "ms"
                  << ", min: " << m_minTotalMs << "ms"
                  << ", max: " << m_maxTotalMs << "ms)"
                  << " | ~" << std::setprecision(1)
                  << (m_avgTotalMs > 0.001 ? 1000.0 / m_avgTotalMs : 9999.0) << " fps capacity";

        // Print stage breakdown
        if (!m_avgStages.empty()) {
            std::cout << " | Stages:";
            for (const auto& s : m_avgStages) {
                std::cout << " " << s.name << "=" << std::setprecision(2) << s.ms << "ms";
            }
        }

        std::cout << std::endl;

        // Reset min/max periodically
        m_minTotalMs = 999999.0;
        m_maxTotalMs = 0.0;

        return true;
    }

    uint64_t frameCount() const { return m_frameCount; }
    double lastTotalMs() const { return m_lastTotalMs; }
    double avgTotalMs() const { return m_avgTotalMs; }

private:
    struct StageTime {
        const char* name;
        double ms;
    };

    TimePoint m_frameStart;
    TimePoint m_lastStageEnd;
    std::vector<StageTime> m_stages;
    std::vector<StageTime> m_avgStages;

    uint64_t m_frameCount = 0;
    double m_lastTotalMs = 0.0;
    double m_avgTotalMs = 0.0;
    double m_minTotalMs = 999999.0;
    double m_maxTotalMs = 0.0;
};

} // namespace holo
