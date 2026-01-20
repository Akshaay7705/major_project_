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
import { Mic, MicOff, MessageSquare, Power, Square, X, ChevronLeft, ChevronRight, Send } from "lucide-react";

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
          ${variant === "danger"
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
  voiceCommandHandlerRef: React.MutableRefObject<((text: string) => void) | null>;
  avatarTranscriptHandlerRef?: React.MutableRefObject<((text: string) => void) | null>;
}> = ({ mode, language, onSessionStopped, voiceCommandHandlerRef, avatarTranscriptHandlerRef }) => {
  const [showTranscript, setShowTranscript] = useState(true);
  const [isOpen, setIsOpen] = useState(true); // Default sidebar open
  const [showChatInput, setShowChatInput] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ sender: "User" | "Agent"; text: string }[]>([]);
  const [inputMessage, setInputMessage] = useState("");
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

  const { interrupt, startListening, stopListening, repeat } = useAvatarActions(mode);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (sessionState === SessionState.DISCONNECTED) {
      onSessionStopped();
      isSessionStarting.current = false; // Reset guard
    }
  }, [sessionState, onSessionStopped]);

  useEffect(() => {
    if (isStreamReady && videoRef.current) {
      attachElement(videoRef.current);
    }
  }, [attachElement, isStreamReady]);

  useEffect(() => {
    if (sessionState === SessionState.INACTIVE && mode === "FULL" && !isSessionStarting.current) {
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

  // Auto-start voice chat for FULL mode
  useEffect(() => {
    if (
      mode === "FULL" &&
      !isActive &&
      !isLoading &&
      sessionState === SessionState.CONNECTED &&
      !isUserTalking &&
      !isAvatarTalking
    ) {
      // Delay starting voice chat by 2 seconds
      const timer = setTimeout(() => {
        start();
      }, 5000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sessionState]);

  // Capture all avatar speech (including greetings)
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

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
    if (mode === "FULL" && sessionState === SessionState.CONNECTED) {
      if (isAvatarTalking) {
        // console.log("DEBUG: Avatar talking - Muting mic");
        mute().catch(() => { });
      } else {
        // console.log("DEBUG: Avatar stopped - Unmuting mic");
        unmute().catch(() => { });
      }
    }
  }, [isAvatarTalking, mode, sessionState, mute, unmute]);

  // Auto-scroll to bottom of transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, showTranscript]);

  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false); // Ref for synchronous locking to prevent races

  // Handle voice commands from SDK
  const handleVoiceCommand = useCallback(async (userText: string) => {
    console.log("DEBUG: Voice Interaction Triggered:", userText, "isProcessing:", isProcessing);
    const now = Date.now();

    // 1. Basic Validation
    if (!userText || !userText.trim()) return;

    // 2. State-based Lock (Ref for immediate race protection)
    if (processingRef.current) return;

    // 3. Strict Debounce & Rate Limiting (Ref-based)
    // Normalize text (remove punctuation, lowercase) for comparison
    const normalize = (t: string) => t.toLowerCase().replace(/[^\w\s]|_/g, "").trim();
    const normalizedUserText = normalize(userText);
    const normalizedLastText = normalize(lastProcessedText.current);

    // Prevent duplicate commands (fuzzy match) within 3 seconds
    if (normalizedUserText === normalizedLastText && now - lastProcessedTime.current < 3000) {
      console.log("DEBUG: Ignoring duplicate voice command:", userText);
      return;
    }
    // Prevent ANY command within 2 seconds (Rate Limit)
    if (now - lastProcessedTime.current < 2000) {
      console.log("DEBUG: Ignoring rapid voice command (rate limit):", userText);
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

    try {
      // Validate response through knowledge bank
      const response = await fetch("/api/openai-chat-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, language: languageFullName }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn("DEBUG: Rate limit hit (429)");
        }
        throw new Error(`API call failed: ${response.status}`);
      }

      const data = await response.json();
      const agentResponse = data.response;

      // Add validated response to transcript (prevent duplicates)
      setChatMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.sender === "Agent" && lastMsg.text === agentResponse) {
          return prev;
        }
        return [...prev, { sender: "Agent", text: agentResponse }];
      });

      // Make avatar speak the validated response
      if (repeat) {
        console.log("DEBUG: Calling repeat with:", agentResponse.substring(0, 50) + "...");
        await repeat(agentResponse);
      }
    } catch (error) {
      console.error("DEBUG: Failed to process voice command:", error);
    } finally {
      // Small cooldown before allowing next processing state (UI feedback)
      // Small cooldown before allowing next processing state (UI feedback)
      setTimeout(() => {
        setIsProcessing(false);
        processingRef.current = false;
      }, 500);
    }
  }, [repeat, isProcessing, language]);

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

    const messageToSend = inputMessage;
    setInputMessage("");
    setChatMessages((prev) => [...prev, { sender: "User", text: messageToSend }]);

    try {
      const response = await fetch("/api/openai-chat-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend }),
      });

      if (!response.ok) throw new Error("API call failed");

      const data = await response.json();
      const agentResponse = data.response;

      setChatMessages((prev) => [...prev, { sender: "Agent", text: agentResponse }]);

      if (repeat) {
        await repeat(agentResponse);
      }

    } catch (error) {
      console.error("Failed to process message:", error);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-neutral-900 overflow-hidden">
      {/* Video Container - Full Screen */}
      <div className="absolute inset-0 w-full h-full">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      </div>

      {/* Connection Status Indicator */}
      <div className="absolute top-8 md:top-6 left-6 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/10">
        <div
          className={`w-2 h-2 rounded-full ${sessionState === SessionState.CONNECTED ? "bg-green-500 animate-pulse" : "bg-yellow-500"
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
          <ChevronLeft className={`w-6 h-6 transition-transform duration-700 ease-in-out ${isOpen ? "rotate-180" : ""}`} />
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
              if (isActive) { stop(); } else { start(); }
            }}
            active={isActive}
            icon={isActive ? <Mic className="w-4 h-4 md:w-6 md:h-6" /> : <MicOff className="w-4 h-4 md:w-6 md:h-6" />}
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
          <div className="pt-3 md:pt-4 border-t border-white/10 mt-1 md:mt-2">
            <SidebarButton
              onClick={stopSession}
              variant="danger"
              icon={<Power className="w-4 h-4 md:w-6 md:h-6" />}
            />
          </div>
        </div>
      </div>

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
        style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 100%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 100%)' }}
      >
        <div
          className="flex flex-col gap-2 max-h-[25vh] md:max-h-[200px] overflow-y-auto pb-1 pr-1 pt-4"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {chatMessages.length === 0 ? null : (
            chatMessages.map((msg, idx, arr) => {
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
                  <div className={`
                    inline-block px-3 py-2 md:px-4 md:py-2.5 rounded-2xl text-xs md:text-sm leading-relaxed
                    ${msg.sender === "User"
                      ? "bg-black/40 text-white/90 border border-white/10 rounded-tr-sm backdrop-blur-md"
                      : "bg-black/70 text-white border border-white/20 shadow-lg rounded-tl-sm backdrop-blur-xl"
                    }
                    transition-all duration-300
                  `}>
                    {msg.text}
                  </div>
                </div>
              );
            })
          )}
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
