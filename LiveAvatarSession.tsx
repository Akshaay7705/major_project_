"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  LiveAvatarContextProvider,
  useSession,
  useTextChat,
  useVoiceChat,
  useChatHistory,
} from "../liveavatar";
import { SessionState, ConnectionQuality } from "@heygen/liveavatar-web-sdk";
import { useAvatarActions } from "../liveavatar/useAvatarActions";

const Button: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, children }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-white text-black px-4 py-2 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
};

const LiveAvatarSessionComponent: React.FC<{
  mode: "FULL" | "CUSTOM";
  onSessionStopped: () => void;
}> = ({ mode, onSessionStopped }) => {
  const [message, setMessage] = useState("");
  const {
    sessionState,
    isStreamReady,
    startSession,
    stopSession,
    connectionQuality,
    keepAlive,
    attachElement,
  } = useSession();
  const {
    isAvatarTalking,
    isUserTalking,
    isMuted,
    isActive,
    isLoading,
    start,
    stop,
    mute,
    unmute,
  } = useVoiceChat();

  const { interrupt, repeat, startListening, stopListening } =
    useAvatarActions(mode);

  const { sendMessage } = useTextChat(mode);
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const messages = useChatHistory();

  useEffect(() => {
    if (sessionState === SessionState.DISCONNECTED) {
      onSessionStopped();
    }
  }, [sessionState, onSessionStopped]);

  useEffect(() => {
    if (isStreamReady && videoRef.current) {
      attachElement(videoRef.current);
    }
  }, [attachElement, isStreamReady]);

  useEffect(() => {
    if (sessionState === SessionState.INACTIVE) {
      startSession();
    }
  }, [startSession, sessionState]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  const VoiceChatComponents = (
    <>
      <p>Voice Chat Active: {isActive ? "true" : "false"}</p>
      <p>Voice Chat Loading: {isLoading ? "true" : "false"}</p>
      {isActive && <p>Muted: {isMuted ? "true" : "false"}</p>}
      <Button
        onClick={() => {
          if (isActive) {
            stop();
          } else {
            start();
          }
        }}
        disabled={isLoading}
      >
        {isActive ? "Stop Voice Chat" : "Start Voice Chat"}
      </Button>
      {isActive && (
        <Button
          onClick={() => {
            if (isMuted) {
              unmute();
            } else {
              mute();
            }
          }}
        >
          {isMuted ? "Unmute" : "Mute"}
        </Button>
      )}
    </>
  );

  return (
    <div className="w-full h-full flex flex-row items-start justify-center gap-8 py-4 px-8 box-border">
      {/* Left Column: Avatar Video */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 max-w-[800px]">
        <div className="relative w-full aspect-video overflow-hidden border border-gray-700 rounded-lg bg-black shadow-lg">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
          <button
            className="absolute bottom-4 right-4 bg-white/90 hover:bg-white text-black px-4 py-2 rounded-md z-10 font-medium transition-colors shadow-sm"
            onClick={() => stopSession()}
          >
            Stop
          </button>
        </div>

        {/* Controls */}
        <div className="w-full flex flex-col items-center justify-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex gap-6 text-sm font-medium text-gray-600">
            <p>
              State: <span className="text-gray-900">{sessionState}</span>
            </p>
            <p>
              Quality:{" "}
              <span
                className={
                  connectionQuality === ConnectionQuality.GOOD
                    ? "text-green-600"
                    : "text-yellow-600"
                }
              >
                {connectionQuality}
              </span>
            </p>
            <p>
              Activity:{" "}
              <span className="text-blue-600">
                {isAvatarTalking
                  ? "Avatar Talking"
                  : isUserTalking
                    ? "User Talking"
                    : "Idle"}
              </span>
            </p>
          </div>

          {mode === "FULL" && VoiceChatComponents}

          <div className="w-full flex flex-row items-center justify-center gap-3 flex-wrap border-t border-gray-200 pt-4">
            <Button onClick={keepAlive}>Keep Alive</Button>
            <Button onClick={startListening}>Start Listening</Button>
            <Button onClick={stopListening}>Stop Listening</Button>
            <Button onClick={interrupt}>Interrupt</Button>
          </div>

          <div className="w-full flex flex-row items-center justify-center gap-3 mt-2">
            <input
              type="text"
              placeholder="Type a message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="flex-1 bg-white text-black px-4 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  sendMessage(message);
                  setMessage("");
                }
              }}
            />
            <Button
              onClick={() => {
                sendMessage(message);
                setMessage("");
              }}
              disabled={!message.trim()}
            >
              Send
            </Button>
            <Button
              onClick={() => {
                repeat(message);
                setMessage("");
              }}
              disabled={!message.trim()}
            >
              Repeat
            </Button>
          </div>
        </div>
      </div>

      {/* Right Column: Transcript */}
      <div className="w-[400px] h-[700px] flex flex-col bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
        <div className="bg-gray-100 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
          <h3 className="font-semibold text-gray-700">Live Transcript</h3>
          <span className="text-xs text-gray-500">
            {messages.length} messages
          </span>
        </div>
        <div
          ref={transcriptRef}
          className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 bg-gray-50"
        >
          {messages.length === 0 && (
            <div className="text-center text-gray-400 text-sm mt-10 italic">
              Conversation history will appear here...
            </div>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                  msg.sender === "user"
                    ? "bg-blue-500 text-white rounded-br-none"
                    : "bg-white border border-gray-200 text-gray-800 rounded-bl-none"
                }`}
              >
                {msg.message}
              </div>
              <span className="text-[10px] text-gray-400 mt-1 mx-1">
                {msg.sender === "user" ? "You" : "Avatar"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const LiveAvatarSession: React.FC<{
  mode: "FULL" | "CUSTOM";
  sessionAccessToken: string;
  onSessionStopped: () => void;
}> = ({ mode, sessionAccessToken, onSessionStopped }) => {
  return (
    <LiveAvatarContextProvider sessionAccessToken={sessionAccessToken}>
      <LiveAvatarSessionComponent
        mode={mode}
        onSessionStopped={onSessionStopped}
      />
    </LiveAvatarContextProvider>
  );
};
