#include <iostream>
#include <vector>
#include <memory>
#include <chrono>
#include <thread>
#include <atomic>
#include <csignal>
#include <cstring>
#include <mutex>

#include <rtc/rtc.hpp>
#include <nlohmann/json.hpp>

// Holographic processing pipeline
#include "pipeline/processing_pipeline.h"
#include "pipeline/simple_view_generator.h"

using json = nlohmann::json;

#pragma pack(push, 1)
struct FrameHeader {
    uint32_t width;        // Expected: 640
    uint32_t height;       // Expected: 300
    uint32_t pixelFormat;  // Expected: 0 (RGBA)
    uint32_t frameSize;    // Expected: 768000
    uint64_t timestamp;    // Microseconds / millisecond timestamp
    uint32_t frameId;      // Incremental frame counter
    uint32_t chunkIndex;   // 0 .. totalChunks - 1
    uint32_t totalChunks;  // Total chunks for this frame
};
#pragma pack(pop)

static_assert(sizeof(FrameHeader) == 36, "FrameHeader must be exactly 36 bytes");

// Global pipeline instance — receives frames from WebRTC and processes them
static std::unique_ptr<holo::ProcessingPipeline> g_pipeline;

// Forward frames from WebRTC reassembly into the holographic pipeline
void processFrame(const uint8_t* pixels, uint32_t width, uint32_t height, uint32_t frameId) {
    if (g_pipeline) {
        g_pipeline->submitFrame(pixels, width, height, frameId);
    }
}

class FrameReassembler {
public:
    void handlePacket(const uint8_t* data, size_t size) {
        if (size < sizeof(FrameHeader)) {
            std::cerr << "[C++ Receiver] Received undersized packet: " << size << " bytes" << std::endl;
            return;
        }

        const FrameHeader* header = reinterpret_cast<const FrameHeader*>(data);
        const uint8_t* payload = data + sizeof(FrameHeader);
        size_t payloadSize = size - sizeof(FrameHeader);

        // Validation against expected 640x300 RGBA format
        if (header->width != 640 || header->height != 300 || header->pixelFormat != 0 || header->frameSize != 768000) {
            std::cerr << "[C++ Receiver] Invalid frame spec: "
                      << header->width << "x" << header->height
                      << " format=" << header->pixelFormat
                      << " size=" << header->frameSize << std::endl;
            return;
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        // REQUIREMENT 6: Real-time low-latency frame dropping
        // If an older frame chunk arrives after a newer frame has already started, discard it.
        if (m_hasCurrentFrame && header->frameId < m_currentFrameId) {
            return;
        }

        // If a new frame arrived, reset assembly buffer and drop any incomplete older frame
        if (!m_hasCurrentFrame || header->frameId > m_currentFrameId) {
            m_currentFrameId = header->frameId;
            m_hasCurrentFrame = true;
            m_totalChunks = header->totalChunks;
            m_receivedChunks = 0;
            m_chunkReceived.assign(m_totalChunks, false);
            m_pixels.assign(header->frameSize, 0);
        }

        // Validate chunk index
        if (header->chunkIndex >= m_totalChunks) {
            return;
        }

        // Avoid duplicate chunks
        if (!m_chunkReceived[header->chunkIndex]) {
            // In our TypeScript framing protocol, chunk size is 16,000 bytes
            size_t chunkPayloadSize = 16000;
            size_t offset = static_cast<size_t>(header->chunkIndex) * chunkPayloadSize;

            if (offset + payloadSize <= m_pixels.size()) {
                std::memcpy(m_pixels.data() + offset, payload, payloadSize);
                m_chunkReceived[header->chunkIndex] = true;
                m_receivedChunks++;
            }
        }

        // Check if all chunks have arrived
        if (m_receivedChunks == m_totalChunks) {
            // Reconstructed complete frame — forward to holographic pipeline
            processFrame(m_pixels.data(), header->width, header->height, header->frameId);
            m_hasCurrentFrame = false; // Ready for next frame
        }
    }

private:
    std::mutex m_mutex;
    bool m_hasCurrentFrame = false;
    uint32_t m_currentFrameId = 0;
    uint32_t m_totalChunks = 0;
    uint32_t m_receivedChunks = 0;
    std::vector<bool> m_chunkReceived;
    std::vector<uint8_t> m_pixels;
};

std::atomic<bool> g_running(true);

void signalHandler(int) {
    std::cout << "\n[C++ WebRTC] Shutting down..." << std::endl;
    g_running = false;
}

int main(int argc, char** argv) {
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    // ---- Parse command-line arguments ----
    std::string signalingUrl = "ws://localhost:8088";
    float viewAngle = 15.0f;    // Side view angle in degrees
    float topAngle = 10.0f;     // Top view angle in degrees

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--angle" && i + 1 < argc) {
            viewAngle = std::stof(argv[++i]);
        } else if (arg == "--top-angle" && i + 1 < argc) {
            topAngle = std::stof(argv[++i]);
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: raw_video_receiver [OPTIONS] [signaling_url]\n"
                      << "  --angle <deg>      Side view angle (default: 15)\n"
                      << "  --top-angle <deg>  Top view angle (default: 10)\n"
                      << "  --help             Show this help\n";
            return 0;
        } else if (arg[0] != '-') {
            signalingUrl = arg;
        }
    }

    std::cout << "=================================================" << std::endl;
    std::cout << " HeyGen Holographic Video Processor (M1 Apple Silicon)" << std::endl;
    std::cout << " Input:  640x300 RGBA (768,000 bytes per frame)" << std::endl;
    std::cout << " Output: 4 views (Front/Left/Right/Top)" << std::endl;
    std::cout << " Angles: side=" << viewAngle << "° top=" << topAngle << "°" << std::endl;
    std::cout << " Signaling: " << signalingUrl << std::endl;
    std::cout << "=================================================" << std::endl;

    // ---- Create holographic processing pipeline ----
    auto viewGen = std::make_unique<holo::SimpleViewGenerator>(viewAngle, topAngle);
    g_pipeline = std::make_unique<holo::ProcessingPipeline>(std::move(viewGen));
    g_pipeline->start();

    FrameReassembler reassembler;

    rtc::Configuration rtcConfig;
    rtcConfig.iceServers.emplace_back("stun:stun.l.google.com:19302");

    std::shared_ptr<rtc::PeerConnection> pc;
    std::shared_ptr<rtc::DataChannel> videoChannel;
    auto ws = std::make_shared<rtc::WebSocket>();

    auto setupPeerConnection = [&]() {
        pc = std::make_shared<rtc::PeerConnection>(rtcConfig);

        pc->onStateChange([](rtc::PeerConnection::State state) {
            std::cout << "[C++ WebRTC] PeerConnection State: " << state << std::endl;
        });

        pc->onGatheringStateChange([](rtc::PeerConnection::GatheringState state) {
            std::cout << "[C++ WebRTC] Gathering State: " << state << std::endl;
        });

        pc->onLocalDescription([ws](rtc::Description description) {
            std::cout << "[C++ WebRTC] Generated SDP " << description.typeString() << std::endl;
            json msg = {
                {"type", description.typeString()},
                {"sdp", std::string(description)}
            };
            if (ws && ws->isOpen()) {
                ws->send(msg.dump());
            }
        });

        pc->onLocalCandidate([ws](rtc::Candidate candidate) {
            json cand = {
                {"candidate", candidate.candidate()},
                {"sdpMid", candidate.mid()}
            };
            json msg = {
                {"type", "candidate"},
                {"candidate", cand}
            };
            if (ws && ws->isOpen()) {
                ws->send(msg.dump());
            }
        });

        // Listen for incoming DataChannel from React client
        pc->onDataChannel([&reassembler, &videoChannel](std::shared_ptr<rtc::DataChannel> dc) {
            std::cout << "[C++ WebRTC] DataChannel incoming: " << dc->label() << std::endl;
            videoChannel = dc;

            dc->onOpen([]() {
                std::cout << "[C++ WebRTC] DataChannel open! Ready for raw video stream." << std::endl;
            });

            dc->onClosed([]() {
                std::cout << "[C++ WebRTC] DataChannel closed." << std::endl;
            });

            dc->onError([](std::string error) {
                std::cerr << "[C++ WebRTC] DataChannel error: " << error << std::endl;
            });

            dc->onMessage([&reassembler](rtc::message_variant data) {
                if (std::holds_alternative<rtc::binary>(data)) {
                    const auto& message = std::get<rtc::binary>(data);
                    reassembler.handlePacket(reinterpret_cast<const uint8_t*>(message.data()), message.size());
                }
            });
        });
    };

    setupPeerConnection();

    ws->onOpen([ws]() {
        std::cout << "[C++ WebRTC] Signaling connected to server" << std::endl;
        json reg = {
            {"type", "register"},
            {"role", "cpp"}
        };
        ws->send(reg.dump());
    });

    std::vector<rtc::Candidate> pendingCandidates;
    bool hasRemoteDescription = false;

    ws->onMessage([&](rtc::message_variant data) {
        if (!std::holds_alternative<std::string>(data)) return;

        std::string raw = std::get<std::string>(data);
        try {
            auto msg = json::parse(raw);
            std::string type = msg.value("type", "");

            if (type == "offer") {
                std::cout << "[C++ WebRTC] Received SDP Offer from Browser" << std::endl;
                std::string sdp = msg["sdp"];
                pc->setRemoteDescription(rtc::Description(sdp, "offer"));
                hasRemoteDescription = true;
                for (const auto& cand : pendingCandidates) {
                    pc->addRemoteCandidate(cand);
                }
                pendingCandidates.clear();
            } else if (type == "candidate") {
                if (msg.contains("candidate") && msg["candidate"].is_object()) {
                    auto candObj = msg["candidate"];
                    std::string candStr = candObj.value("candidate", "");
                    std::string mid = candObj.value("sdpMid", "");
                    if (!candStr.empty()) {
                        rtc::Candidate cand(candStr, mid);
                        if (hasRemoteDescription) {
                            pc->addRemoteCandidate(cand);
                        } else {
                            pendingCandidates.push_back(cand);
                        }
                    }
                }
            }
        } catch (const std::exception& e) {
            std::cerr << "[C++ WebRTC] JSON parse error: " << e.what() << std::endl;
        }
    });

    ws->onError([](std::string error) {
        std::cerr << "[C++ WebRTC] Signaling WebSocket error: " << error << std::endl;
    });

    ws->onClosed([]() {
        std::cout << "[C++ WebRTC] Signaling WebSocket closed" << std::endl;
    });

    std::cout << "[C++ WebRTC] Connecting to signaling server..." << std::endl;
    ws->open(signalingUrl);

    // Main event loop
    while (g_running) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    // ---- Graceful shutdown ----
    std::cout << "[C++ WebRTC] Cleaning up..." << std::endl;
    g_pipeline->stop();
    g_pipeline.reset();
    if (pc) pc->close();
    if (ws) ws->close();

    return 0;
}
