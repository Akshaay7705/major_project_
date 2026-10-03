"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  LiveAvatarContextProvider,
  useSession,
  useTextChat,
  useVoiceChat,
} from "../liveavatar";
import { useLiveAvatarContext } from "../liveavatar/context";
import { SessionState, AgentEventsEnum } from "@heygen/liveavatar-web-sdk";
import { useAvatarActions } from "../liveavatar/useAvatarActions";
import {
  Mic,
  MicOff,
  MessageSquare,
  Power,
  Square,
  X,
  ChevronLeft,
  ChevronRight,
  Send,
} from "lucide-react";
import { RawVideoPipeline } from "../lib/rawVideoPipeline";
import {
  HologramCompositor,
  CalibrationPanel,
  DEFAULT_HOLOGRAM_CONFIG,
  type HologramConfig,
} from "./HologramCompositor";

const SidebarButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  icon: React.ReactNode;
  label?: string;
  variant?: "default" | "danger";
}> = ({ onClick, disabled, active, icon, label, variant = "default" }) => {
  return (
    <div className="group flex items-center justify-center gap-3 relative">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`
          flex items-center justify-center
          w-9 h-9 md:w-14 md:h-14 rounded-full backdrop-blur-md transition-all duration-200 shadow-lg border
          ${
            variant === "danger"
              ? "bg-red-500/20 border-red-500/30 hover:bg-red-500/40 text-red-50"
              : active
                ? "bg-white/30 border-white/40 text-white"
                : "bg-black/20 border-white/10 text-white/80 hover:bg-black/40 hover:text-white"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        {icon}
      </button>
    </div>
  );
};

const LiveAvatarSessionComponent: React.FC<{
  mode: "FULL" | "CUSTOM";
  language: string;
  onSessionStopped: () => void;
  voiceCommandHandlerRef: React.MutableRefObject<
    ((text: string) => void) | null
  >;
  avatarTranscriptHandlerRef?: React.MutableRefObject<
    ((text: string) => void) | null
  >;
}> = ({
  mode,
  language,
  onSessionStopped,
  voiceCommandHandlerRef,
  avatarTranscriptHandlerRef,
}) => {
  const [showTranscript, setShowTranscript] = useState(true);
  const [isOpen, setIsOpen] = useState(true);
  const [showChatInput, setShowChatInput] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    { sender: "User" | "Agent"; text: string }[]
  >([]);
  const [inputMessage, setInputMessage] = useState("");
  const [hologramConfig, setHologramConfig] = useState<HologramConfig>(
    DEFAULT_HOLOGRAM_CONFIG,
  );
  const [showCalibration, setShowCalibration] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Guard for session start
  const isSessionStarting = useRef(false);
  // Refs for debouncing
  const lastProcessedText = useRef("");
  const lastProcessedTime = useRef(0);

  const {
    sessionState,
    isStreamReady,
    startSession,
    stopSession,
    attachElement,
  } = useSession();

  const { sessionRef } = useLiveAvatarContext();

  const {
    isUserTalking,
    isAvatarTalking,
    isActive,
    isLoading,
    start,
    stop,
    mute,
    unmute,
  } = useVoiceChat();

  const { interrupt, startListening, stopListening, repeat } =
    useAvatarActions(mode);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (sessionState === SessionState.DISCONNECTED) {
      onSessionStopped();
      isSessionStarting.current = false; // Reset guard
    }
  }, [sessionState, onSessionStopped]);
  useEffect(() => {
    if (!isStreamReady || !videoRef.current) return;

    const video = videoRef.current;

    // Attach HeyGen's MediaStream to the video element for local playback
    attachElement(video);

    let cancelled = false;
    let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
    const pipeline = new RawVideoPipeline();

    const processVideo = async () => {
      // Give the video element a moment to receive srcObject
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (cancelled) return;

      const stream = video.srcObject as MediaStream | null;

      if (!stream) {
        console.error("No MediaStream found on video element");
        return;
      }

      const tracks = stream.getVideoTracks();
      if (tracks.length === 0) {
        console.error("No video track found in MediaStream");
        return;
      }

      const videoTrack = tracks[0];
      if (!videoTrack) {
        console.error("No video track found in MediaStream");
        return;
      }
      console.log(
        "[Video] Track:",
        videoTrack.label,
        "Settings:",
        videoTrack.getSettings(),
      );

      // Check browser support for MediaStreamTrackProcessor
      if (!("MediaStreamTrackProcessor" in window)) {
        console.error(
          "MediaStreamTrackProcessor is not supported in this browser",
        );
        return;
      }

      // Start C++ WebRTC DataChannel connection and signaling
      pipeline.start();

      const processor = new MediaStreamTrackProcessor({
        track: videoTrack,
      });

      reader = processor.readable.getReader();

      while (!cancelled && reader) {
        let frame: VideoFrame | undefined;
        try {
          const result = await reader.read();
          if (result.done || !result.value) {
            break;
          }
          frame = result.value;

          // Resize to 640x300 RGBA, packetize, and send over DataChannel
          await pipeline.sendRawFrame(frame);
        } catch (err) {
          if (!cancelled) {
            console.error("[WebRTC] Error processing frame loop:", err);
          }
          break;
        } finally {
          // REQUIREMENT 7: Always close VideoFrame to prevent memory leaks
          if (frame) {
            frame.close();
          }
        }
      }
    };

    processVideo();

    return () => {
      cancelled = true;
      pipeline.stop();

      if (reader) {
        reader.cancel().catch(() => {});
        reader = null;
      }
    };
  }, [attachElement, isStreamReady]);

  useEffect(() => {
    if (
      sessionState === SessionState.INACTIVE &&
      mode === "FULL" &&
      !isSessionStarting.current
    ) {
      isSessionStarting.current = true;
      console.log("DEBUG: Auto-starting session...");
      startSession().catch((e) => {
        console.error("DEBUG: Session start failed", e);
        // We generally don't reset isSessionStarting here to prevent infinite retry loops in strict mode,
        // unless we know it's safe. But strict mode double-invoke usually happens fast.
        // Let's reset it after a delay if needed, or rely on DISCONNECTED state to reset it.
        // For now, let's keep it true to prevent the immediate second call.
      });
    }
  }, [startSession, sessionState, mode]);

  const isGreetingSpoken = useRef(false);

  // Intercept HeyGen's built-in greeting and replace with NIE-Bot greeting
  useEffect(() => {
    if (sessionState === SessionState.CONNECTED && !isGreetingSpoken.current) {
      isGreetingSpoken.current = true;
      const greetingText =
        "Welcome to The National Institute of Engineering, Mysuru! I am NIE-Bot, your virtual assistant. How can I assist you with admissions, courses, or campus life today?";
      setChatMessages([{ sender: "Agent", text: greetingText }]);

      // Step 1: Interrupt HeyGen's auto-play business greeting
      try {
        interrupt();
      } catch (_) {}

      // Step 2: After interrupt settles, speak NIE greeting
      const timer = setTimeout(() => {
        try {
          const result = repeat(greetingText);
          if (result && typeof result.catch === "function")
            result.catch(() => {});
        } catch (_) {}
      }, 1200);
      return () => clearTimeout(timer);
    }
    if (sessionState === SessionState.DISCONNECTED) {
      isGreetingSpoken.current = false;
    }
  }, [sessionState, interrupt, repeat]);

  // Capture all avatar speech (including greetings)
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    console.log(session);

    const handleAvatarTranscript = (event: any) => {
      // console.log("DEBUG: Avatar Transcript Event:", event);
      const text = event.text || event.message;
      if (text) {
        setChatMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          // Deduplicate: If the last message is from Agent and is identical, ignore
          if (lastMsg && lastMsg.sender === "Agent" && lastMsg.text === text) {
            return prev;
          }
          return [...prev, { sender: "Agent", text }];
        });
      }
    };

    session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, handleAvatarTranscript);
    return () => {
      session.off(AgentEventsEnum.AVATAR_TRANSCRIPTION, handleAvatarTranscript);
    };
  }, [sessionRef]);

  // Antigravity Fix: Auto-mute mic when avatar is talking to prevent echo (self-hearing)
  useEffect(() => {
    if (
      mode === "FULL" &&
      sessionState === SessionState.CONNECTED &&
      isActive
    ) {
      if (isAvatarTalking) {
        mute().catch(() => {});
      } else {
        unmute().catch(() => {});
      }
    }
  }, [isAvatarTalking, mode, sessionState, isActive, mute, unmute]);

  // Auto-scroll to bottom of transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, showTranscript]);

  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false); // Ref for synchronous locking to prevent races

  // --- Meeting Scheduling Flow ---
  const meetingFlowRef = useRef<null | "awaiting_name" | "awaiting_email">(
    null,
  );
  const pendingMeetingName = useRef<string>("");

  const SCHEDULE_TRIGGERS = [
    "schedule",
    "book",
    "appointment",
    "meet with",
    "talk to admissions",
    "visit",
    "counsell",
    "consult",
    "meet someone",
    "speak to someone",
  ];

  function isScheduleIntent(text: string) {
    const lower = text.toLowerCase();
    return SCHEDULE_TRIGGERS.some((t) => lower.includes(t));
  }

  // Handle voice commands from SDK
  const handleVoiceCommand = useCallback(
    async (userText: string) => {
      console.log(
        "DEBUG: Voice Interaction Triggered:",
        userText,
        "isProcessing:",
        isProcessing,
      );
      const now = Date.now();

      // 1. Basic Validation
      if (!userText || !userText.trim()) return;

      // 2. State-based Lock (Ref for immediate race protection)
      if (processingRef.current) return;

      // 3. Strict Debounce & Rate Limiting (Ref-based)
      // Normalize text (remove punctuation, lowercase) for comparison
      const normalize = (t: string) =>
        t
          .toLowerCase()
          .replace(/[^\w\s]|_/g, "")
          .trim();
      const normalizedUserText = normalize(userText);
      const normalizedLastText = normalize(lastProcessedText.current);

      // Prevent duplicate commands (fuzzy match) within 3 seconds
      if (
        normalizedUserText === normalizedLastText &&
        now - lastProcessedTime.current < 3000
      ) {
        console.log("DEBUG: Ignoring duplicate voice command:", userText);
        return;
      }
      // Prevent ANY command within 2 seconds (Rate Limit)
      if (now - lastProcessedTime.current < 2000) {
        console.log(
          "DEBUG: Ignoring rapid voice command (rate limit):",
          userText,
        );
        return;
      }

      // Update Refs
      lastProcessedText.current = userText;
      lastProcessedTime.current = now;

      setIsProcessing(true);
      processingRef.current = true;

      // Add user's voice command to transcript (prevent duplicates)
      setChatMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.sender === "User" && lastMsg.text === userText) {
          return prev;
        }
        return [...prev, { sender: "User", text: userText }];
      });

      try {
        // ---- MEETING SCHEDULING FLOW ----
        if (meetingFlowRef.current === "awaiting_name") {
          pendingMeetingName.current = userText.trim();
          meetingFlowRef.current = "awaiting_email";
          const prompt = `Thank you, ${pendingMeetingName.current}! Could you please share your email address so I can send you the meeting invite?`;
          setChatMessages((prev) => [
            ...prev,
            { sender: "Agent", text: prompt },
          ]);
          try {
            await interrupt();
            await repeat(prompt);
          } catch (e) {
            console.error("Repeat error:", e);
          }
          return;
        }

        if (meetingFlowRef.current === "awaiting_email") {
          const userEmail = userText.trim().replace(/\s+/g, "").toLowerCase();
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(userEmail)) {
            const prompt =
              "I didn't catch a valid email address. Could you please say your email again?";
            setChatMessages((prev) => [
              ...prev,
              { sender: "Agent", text: prompt },
            ]);
            try {
              await interrupt();
              await repeat(prompt);
            } catch (e) {
              console.error("Repeat error:", e);
            }
            return;
          }

          meetingFlowRef.current = null;
          const bookingMsg =
            "Please hold on while I schedule your meeting with the NIE Mysuru Admissions Office...";
          setChatMessages((prev) => [
            ...prev,
            { sender: "Agent", text: bookingMsg },
          ]);
          try {
            await interrupt();
            await repeat(bookingMsg);
          } catch (e) {
            console.error("Repeat error:", e);
          }

          const schedRes = await fetch("/api/schedule-meeting", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userName: pendingMeetingName.current,
              userEmail,
            }),
          });

          const schedData = await schedRes.json();
          const avatarResponse =
            schedData.avatarResponse ||
            (schedData.error
              ? `Sorry, I couldn't schedule the meeting: ${schedData.error}`
              : "Your meeting has been scheduled!");
          setChatMessages((prev) => [
            ...prev,
            { sender: "Agent", text: avatarResponse },
          ]);
          try {
            await interrupt();
            await repeat(avatarResponse);
          } catch (e) {
            console.error("Repeat error:", e);
          }
          return;
        }

        // Detect scheduling intent from user's voice
        if (isScheduleIntent(userText)) {
          meetingFlowRef.current = "awaiting_name";
          const prompt =
            "Of course! I'd be happy to schedule a meeting with the NIE Mysuru Admissions Office for you. Could you please tell me your full name?";
          setChatMessages((prev) => [
            ...prev,
            { sender: "Agent", text: prompt },
          ]);
          try {
            await interrupt();
            await repeat(prompt);
          } catch (e) {
            console.error("Repeat error:", e);
          }
          return;
        }
        // ---- END MEETING FLOW ----

        const languageNames: Record<string, string> = {
          en: "English",
          es: "Spanish",
          fr: "French",
          de: "German",
          it: "Italian",
          pt: "Portuguese",
          hi: "Hindi",
          ja: "Japanese",
          ko: "Korean",
          zh: "Chinese",
        };
        const languageFullName = languageNames[language] || language;
        console.log("DEBUG: Sending request with language:", languageFullName);

        // Validate response through knowledge bank
        const response = await fetch("/api/openai-chat-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userText,
            language: languageFullName,
          }),
        });

        if (!response.ok) {
          const errorJson = await response.json().catch(() => ({}));
          const errorMsg =
            errorJson.error || `API call failed: ${response.status}`;
          console.error(
            `DEBUG: OpenAI Chat API error (${response.status}):`,
            errorMsg,
          );
          setChatMessages((prev) => [
            ...prev,
            {
              sender: "Agent",
              text: `⚠️ API Error (${response.status}): ${errorMsg}`,
            },
          ]);
          return;
        }

        const data = await response.json();
        const agentResponse = data.response;

        // Add validated response to transcript (prevent duplicates)
        setChatMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (
            lastMsg &&
            lastMsg.sender === "Agent" &&
            lastMsg.text === agentResponse
          ) {
            return prev;
          }
          return [...prev, { sender: "Agent", text: agentResponse }];
        });

        // Make avatar speak the validated response
        if (repeat) {
          console.log(
            "DEBUG: Calling repeat with:",
            agentResponse.substring(0, 50) + "...",
          );

          await repeat(agentResponse);
        }
      } catch (error) {
        console.error("DEBUG: Failed to process voice command:", error);
      } finally {
        // Small cooldown before allowing next processing state (UI feedback)
        setTimeout(() => {
          setIsProcessing(false);
          processingRef.current = false;
        }, 500);
      }
    },
    [repeat, isProcessing, language],
  );

  // Connect voice command handler to ref
  useEffect(() => {
    voiceCommandHandlerRef.current = handleVoiceCommand;
  }, [voiceCommandHandlerRef, handleVoiceCommand]);

  // Connect avatar transcription handler
  useEffect(() => {
    if (avatarTranscriptHandlerRef) {
      avatarTranscriptHandlerRef.current = (text: string) => {
        // Ignored to prevent duplicates.
        // We rely on the validated API response being manually added.
      };
    }
  }, [avatarTranscriptHandlerRef]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    const messageToSend = inputMessage.trim();
    setInputMessage("");
    setChatMessages((prev) => [
      ...prev,
      { sender: "User", text: messageToSend },
    ]);

    try {
      // Check meeting flow for typed messages
      if (meetingFlowRef.current === "awaiting_name") {
        pendingMeetingName.current = messageToSend;
        meetingFlowRef.current = "awaiting_email";
        const prompt = `Thank you, ${pendingMeetingName.current}! Could you please share your email address so I can send you the meeting invite?`;
        setChatMessages((prev) => [...prev, { sender: "Agent", text: prompt }]);
        try {
          await interrupt();
          await repeat(prompt);
        } catch (_) {}
        return;
      }

      if (meetingFlowRef.current === "awaiting_email") {
        const userEmail = messageToSend.replace(/\s+/g, "").toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userEmail)) {
          const prompt =
            "Please enter a valid email address so I can send the invite.";
          setChatMessages((prev) => [
            ...prev,
            { sender: "Agent", text: prompt },
          ]);
          try {
            await interrupt();
            await repeat(prompt);
          } catch (e) {
            console.error("Repeat error:", e);
          }
          return;
        }

        meetingFlowRef.current = null;
        const bookingMsg =
          "Please hold on while I schedule your meeting with the NIE Mysuru Admissions Office...";
        setChatMessages((prev) => [
          ...prev,
          { sender: "Agent", text: bookingMsg },
        ]);
        try {
          await interrupt();
          await repeat(bookingMsg);
        } catch (_) {}

        const schedRes = await fetch("/api/schedule-meeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName: pendingMeetingName.current,
            userEmail,
          }),
        });

        const schedData = await schedRes.json();
        const avatarResponse =
          schedData.avatarResponse ||
          (schedData.error
            ? `Sorry, I couldn't schedule the meeting: ${schedData.error}`
            : "Your meeting has been scheduled!");
        setChatMessages((prev) => [
          ...prev,
          { sender: "Agent", text: avatarResponse },
        ]);
        try {
          await interrupt();
          await repeat(avatarResponse);
        } catch (_) {}
        return;
      }

      if (isScheduleIntent(messageToSend)) {
        meetingFlowRef.current = "awaiting_name";
        const prompt =
          "Of course! I'd be happy to schedule a meeting with the NIE Mysuru Admissions Office for you. What is your full name?";
        setChatMessages((prev) => [...prev, { sender: "Agent", text: prompt }]);
        try {
          await interrupt();
          await repeat(prompt);
        } catch (_) {}
        return;
      }

      const response = await fetch("/api/openai-chat-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        const errorMsg =
          errorJson.error || `API call failed (${response.status})`;
        setChatMessages((prev) => [
          ...prev,
          {
            sender: "Agent",
            text: `⚠️ API Error (${response.status}): ${errorMsg}`,
          },
        ]);
        return;
      }

      const data = await response.json();
      const agentResponse = data.response;

      setChatMessages((prev) => [
        ...prev,
        { sender: "Agent", text: agentResponse },
      ]);

      if (repeat) {
        try {
          const res = repeat(agentResponse);
          if (res && typeof res.catch === "function") res.catch(() => {});
        } catch (_) {}
      }
    } catch (error) {
      console.error("Failed to process message:", error);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      {/* Hidden video element – HeyGen attaches the MediaStream here */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute opacity-0 pointer-events-none w-0 h-0"
      />

      {/* Hologram 4-view compositor – replaces raw video display */}
      <HologramCompositor videoRef={videoRef} config={hologramConfig} />

      {/* Connection Status Indicator */}
      <div className="absolute top-8 md:top-6 left-6 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/10">
        <div
          className={`w-2 h-2 rounded-full ${
            sessionState === SessionState.CONNECTED
              ? "bg-green-500 animate-pulse"
              : "bg-yellow-500"
          }`}
        />
        <span className="text-xs font-medium text-white/80 uppercase tracking-wider">
          {sessionState}
        </span>
      </div>

      {/* Floating Sidebar Controls */}
      <div className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 flex flex-row items-center gap-2 md:gap-4 z-20">
        {/* Toggle Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 rounded-full bg-black/20 backdrop-blur-md border border-white/10 text-white/80 hover:bg-black/40 hover:text-white transition-all shadow-lg"
        >
          <ChevronLeft
            className={`w-6 h-6 transition-transform duration-700 ease-in-out ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {/* Collapsible Control Panel */}
        <div
          className={`
            flex flex-col items-center gap-4 md:gap-6 p-2 md:p-3 rounded-full bg-black/20 backdrop-blur-md border border-white/10 transition-all duration-700 ease-in-out origin-right
            ${isOpen ? "opacity-100 translate-x-0 scale-100" : "opacity-0 translate-x-8 scale-95 pointer-events-none absolute right-0"}
          `}
        >
          <SidebarButton
            onClick={() => {
              if (isActive) {
                stop();
              } else {
                start();
              }
            }}
            active={isActive}
            icon={
              isActive ? (
                <Mic className="w-4 h-4 md:w-6 md:h-6" />
              ) : (
                <MicOff className="w-4 h-4 md:w-6 md:h-6" />
              )
            }
            label={isActive ? "Stop Listening" : "Start Listening"}
          />
          <SidebarButton
            onClick={interrupt}
            icon={<Square className="w-3 h-3 md:w-5 md:h-5 fill-current" />}
            label="Interrupt"
          />
          <SidebarButton
            onClick={() => setShowTranscript(!showTranscript)}
            active={showTranscript}
            icon={<MessageSquare className="w-4 h-4 md:w-6 md:h-6" />}
            label="Transcript"
          />
          <div className="pt-3 md:pt-4 border-t border-white/10 mt-1 md:mt-2 flex flex-col gap-4">
            <SidebarButton
              onClick={() => setShowCalibration((s) => !s)}
              active={showCalibration}
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4 md:w-5 md:h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                </svg>
              }
              label="Calibrate"
            />
            <SidebarButton
              onClick={stopSession}
              variant="danger"
              icon={<Power className="w-4 h-4 md:w-6 md:h-6" />}
            />
          </div>
        </div>
      </div>

      {/* Calibration Panel */}
      {showCalibration && (
        <CalibrationPanel
          config={hologramConfig}
          onChange={setHologramConfig}
          onClose={() => setShowCalibration(false)}
        />
      )}

      {/* Center Bottom Chat Toggle & Input */}
      <div className="absolute bottom-6 md:bottom-8 left-1/2 -translate-x-1/2 z-30 w-[calc(100vw-2rem)] md:w-full max-w-xl px-0 md:px-4 flex justify-center">
        {!showChatInput ? (
          <button
            onClick={() => setShowChatInput(true)}
            className="p-3 md:p-4 rounded-full bg-black/20 backdrop-blur-md border border-white/10 text-white/80 hover:bg-black/40 hover:text-white transition-all shadow-lg hover:scale-105"
          >
            <MessageSquare className="w-4 h-4 md:w-6 md:h-6" />
          </button>
        ) : (
          <div className="relative w-full animate-in fade-in zoom-in duration-300">
            <div className="relative flex items-center bg-black/40 backdrop-blur-xl rounded-full p-2 shadow-2xl">
              <input
                type="text"
                autoFocus
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => !inputMessage && setShowChatInput(false)}
                placeholder="Type your question..."
                className="flex-1 bg-transparent border-none text-white placeholder-white/50 px-4 md:px-6 py-2 md:py-3 focus:ring-0 text-xs md:text-base font-light"
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim()}
                className="p-2 md:p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all disabled:opacity-30 disabled:hover:bg-white/10"
              >
                <Send className="w-3 h-3 md:w-5 md:h-5" />
              </button>
            </div>
            {/* Close button for chat */}
            <button
              onClick={() => setShowChatInput(false)}
              className="absolute -right-8 md:-right-12 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white"
            >
              <X className="w-4 h-4 md:w-6 md:h-6" />
            </button>
          </div>
        )}
      </div>

      {/* Subtitles / Transcript Overlay */}
      <div
        className={`
          absolute left-4 bottom-20 md:bottom-4 
          w-[200px] md:w-[200px] 
          flex flex-col justify-end gap-2 transition-all duration-500 ease-in-out z-20 
          ${showTranscript ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}
        `}
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 100%)",
        }}
      >
        <div
          className="flex flex-col gap-2 max-h-[25vh] md:max-h-[200px] overflow-y-auto pb-1 pr-1 pt-4"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {chatMessages.length === 0
            ? null
            : chatMessages.map((msg, idx, arr) => {
                const isLast = idx === arr.length - 1;
                return (
                  <div
                    key={idx}
                    className={`
                    transition-all duration-500 ease-out
                    ${msg.sender === "User" ? "text-right pl-6" : "text-left pr-6"}
                    ${isLast ? "opacity-100 scale-100" : "opacity-60 scale-95 hover:opacity-100"}
                  `}
                  >
                    <div
                      className={`
                    inline-block px-3 py-2 md:px-4 md:py-2.5 rounded-2xl text-xs md:text-sm leading-relaxed
                    ${
                      msg.sender === "User"
                        ? "bg-black/40 text-white/90 border border-white/10 rounded-tr-sm backdrop-blur-md"
                        : "bg-black/70 text-white border border-white/20 shadow-lg rounded-tl-sm backdrop-blur-xl"
                    }
                    transition-all duration-300
                  `}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })}
          <div ref={transcriptEndRef} />
        </div>
      </div>
    </div>
  );
};

export const LiveAvatarSession: React.FC<{
  mode: "FULL" | "CUSTOM";
  sessionAccessToken: string;
  language: string;
  onSessionStopped: () => void;
}> = ({ mode, sessionAccessToken, language, onSessionStopped }) => {
  const voiceHandlerRef = useRef<((text: string) => void) | null>(null);
  const avatarTranscriptRef = useRef<((text: string) => void) | null>(null);

  return (
    <LiveAvatarContextProvider
      sessionAccessToken={sessionAccessToken}
      onUserTranscription={(text) => {
        if (voiceHandlerRef.current) {
          voiceHandlerRef.current(text);
        }
      }}
      onAvatarTranscription={(text) => {
        if (avatarTranscriptRef.current) {
          avatarTranscriptRef.current(text);
        }
      }}
    >
      <LiveAvatarSessionComponent
        mode={mode}
        language={language}
        onSessionStopped={onSessionStopped}
        voiceCommandHandlerRef={voiceHandlerRef}
        avatarTranscriptHandlerRef={avatarTranscriptRef}
      />
    </LiveAvatarContextProvider>
  );
};
