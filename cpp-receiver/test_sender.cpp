#include <iostream>
#include <vector>
#include <memory>
#include <chrono>
#include <thread>
#include <cstring>
#include <cmath>

#include <rtc/rtc.hpp>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

#pragma pack(push, 1)
struct FrameHeader {
    uint32_t width;
    uint32_t height;
    uint32_t pixelFormat;
    uint32_t frameSize;
    uint64_t timestamp;
    uint32_t frameId;
    uint32_t chunkIndex;
    uint32_t totalChunks;
};
#pragma pack(pop)

int main() {
    std::cout << "[Test Sender] Starting mock WebRTC sender..." << std::endl;

    rtc::Configuration rtcConfig;
    rtcConfig.iceServers.emplace_back("stun:stun.l.google.com:19302");

    auto ws = std::make_shared<rtc::WebSocket>();
    std::shared_ptr<rtc::PeerConnection> pc;
    std::shared_ptr<rtc::DataChannel> dc;
    std::atomic<bool> channelOpen(false);

    std::vector<rtc::Candidate> pendingCandidates;
    bool hasRemoteDescription = false;

    auto initPeerConnection = [&]() {
        pc = std::make_shared<rtc::PeerConnection>(rtcConfig);

        pc->onLocalDescription([ws](rtc::Description description) {
            std::cout << "[Test Sender] Sending SDP Offer: " << description.typeString() << std::endl;
            json msg = {{"type", "offer"}, {"sdp", std::string(description)}};
            if (ws && ws->isOpen()) {
                ws->send(msg.dump());
            }
        });

        pc->onLocalCandidate([ws](rtc::Candidate candidate) {
            json cand = {{"candidate", candidate.candidate()}, {"sdpMid", candidate.mid()}};
            json msg = {{"type", "candidate"}, {"candidate", cand}};
            if (ws && ws->isOpen()) {
                ws->send(msg.dump());
            }
        });

        rtc::DataChannelInit dcInit;
        dcInit.reliability.unordered = true;
        dcInit.reliability.maxRetransmits = 0;
        dc = pc->createDataChannel("raw-video", dcInit);

        dc->onOpen([&channelOpen]() {
            std::cout << "[Test Sender] DataChannel open!" << std::endl;
            channelOpen = true;
        });

        std::cout << "[Test Sender] Creating local offer..." << std::endl;
        pc->setLocalDescription();
    };

    ws->onOpen([ws]() {
        std::cout << "[Test Sender] Connected to signaling server" << std::endl;
        ws->send(json{{"type", "register"}, {"role", "browser"}}.dump());
    });

    ws->onMessage([&](rtc::message_variant data) {
        if (!std::holds_alternative<std::string>(data)) return;
        auto msg = json::parse(std::get<std::string>(data));
        std::string type = msg.value("type", "");

        if (type == "cpp-ready") {
            std::cout << "[Test Sender] Peer cpp-ready received, creating offer..." << std::endl;
            initPeerConnection();
        } else if (type == "answer") {
            std::cout << "[Test Sender] Received SDP Answer from C++ receiver" << std::endl;
            if (pc) {
                pc->setRemoteDescription(rtc::Description(msg["sdp"], "answer"));
                hasRemoteDescription = true;
                for (const auto& cand : pendingCandidates) {
                    pc->addRemoteCandidate(cand);
                }
                pendingCandidates.clear();
            }
        } else if (type == "candidate") {
            if (msg.contains("candidate") && msg["candidate"].is_object()) {
                auto c = msg["candidate"];
                std::string candStr = c.value("candidate", "");
                std::string mid = c.value("sdpMid", "");
                if (!candStr.empty()) {
                    rtc::Candidate cand(candStr, mid);
                    if (pc && hasRemoteDescription) {
                        pc->addRemoteCandidate(cand);
                    } else {
                        pendingCandidates.push_back(cand);
                    }
                }
            }
        }
    });

    ws->open("ws://localhost:8088");

    // Wait for DataChannel to open (up to 10 seconds)
    for (int i = 0; i < 100 && !channelOpen; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    if (!channelOpen) {
        std::cerr << "[Test Sender] Timeout waiting for DataChannel to open" << std::endl;
        return 1;
    }

    // Generate 640x300 RGBA frame (768,000 bytes)
    const uint32_t width = 640;
    const uint32_t height = 300;
    const uint32_t totalSize = width * height * 4;
    const uint32_t chunkPayloadSize = 16000;
    const uint32_t totalChunks = static_cast<uint32_t>(std::ceil(static_cast<double>(totalSize) / chunkPayloadSize));

    std::vector<uint8_t> frameBuffer(totalSize);
    // Fill with pattern: Red=255, Green=128, Blue=64, Alpha=255
    for (size_t i = 0; i < totalSize; i += 4) {
        frameBuffer[i] = 255;
        frameBuffer[i + 1] = 128;
        frameBuffer[i + 2] = 64;
        frameBuffer[i + 3] = 255;
    }

    std::cout << "[Test Sender] Sending 5 test frames (" << totalSize << " bytes each in " << totalChunks << " chunks)..." << std::endl;

    for (uint32_t frameId = 1; frameId <= 5; ++frameId) {
        uint64_t timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();

        for (uint32_t chunkIdx = 0; chunkIdx < totalChunks; ++chunkIdx) {
            size_t offset = chunkIdx * chunkPayloadSize;
            size_t currentPayload = std::min(static_cast<size_t>(chunkPayloadSize), totalSize - offset);

            std::vector<std::byte> packet(sizeof(FrameHeader) + currentPayload);
            FrameHeader* header = reinterpret_cast<FrameHeader*>(packet.data());
            header->width = width;
            header->height = height;
            header->pixelFormat = 0; // RGBA
            header->frameSize = totalSize;
            header->timestamp = timestamp;
            header->frameId = frameId;
            header->chunkIndex = chunkIdx;
            header->totalChunks = totalChunks;

            std::memcpy(packet.data() + sizeof(FrameHeader), frameBuffer.data() + offset, currentPayload);

            dc->send(packet);
        }

        std::cout << "[Test Sender] Sent frame #" << frameId << std::endl;
        std::this_thread::sleep_for(std::chrono::milliseconds(33)); // ~30 fps
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
    std::cout << "[Test Sender] Test completed successfully!" << std::endl;
    return 0;
}
