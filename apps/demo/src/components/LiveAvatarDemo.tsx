"use client";

import { useState } from "react";
import { LiveAvatarSession } from "./LiveAvatarSession";
import { ChevronDown } from "lucide-react";

export const LiveAvatarDemo = () => {
  const [sessionToken, setSessionToken] = useState("");
  const [mode, setMode] = useState<"FULL" | "CUSTOM">("FULL");
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("en");
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);

  const languages = [
    { name: "English", value: "en" },
    { name: "Spanish", value: "es" },
    { name: "French", value: "fr" },
    { name: "German", value: "de" },
    { name: "Italian", value: "it" },
    { name: "Portuguese", value: "pt" },
    { name: "Hindi", value: "hi" },
    { name: "Japanese", value: "ja" },
    { name: "Korean", value: "ko" },
    { name: "Chinese", value: "zh" },
  ];

  const handleStart = async () => {
    try {
      const res = await fetch("/api/start-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ language }),
      });
      if (!res.ok) {
        const error = await res.json();
        setError(error.error);
        return;
      }
      const { session_token } = await res.json();
      setSessionToken(session_token);
      setMode("FULL");
    } catch (error: unknown) {
      setError((error as Error).message);
    }
  };

  const handleStartCustom = async () => {
    const res = await fetch("/api/start-custom-session", {
      method: "POST",
    });
    if (!res.ok) {
      const error = await res.json();
      setError(error.error);
      return;
    }
    const { session_token } = await res.json();
    setSessionToken(session_token);
    setMode("CUSTOM");
  };

  const onSessionStopped = () => {
    // Reset the FE state
    setSessionToken("");
  };

  return (

    <div className="w-screen h-screen flex flex-col items-center justify-center gap-4 bg-neutral-900 overflow-hidden">
      {!sessionToken ? (
        <div
          onClick={handleStart}
          className="relative w-full h-full cursor-pointer group"
        >
          {/* Background Video - Desktop / Laptop (Landscape) */}
          <video
            src="/home-bg.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="hidden md:block absolute inset-0 w-full h-full object-cover"
          />

          {/* Background Video - Mobile (9:16 Portrait) */}
          <video
            src="/home-bg-portrait.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="block md:hidden absolute inset-0 w-full h-full object-cover"
          />

          {/* Optional Overlay/Tint */}
          <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors duration-500" />

          {/* Language Selector (Top Right) */}
          <div className="absolute top-8 right-8 z-30" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              {/* Dropdown Trigger */}
              <button
                onClick={() => setIsLanguageOpen(!isLanguageOpen)}
                className="flex items-center gap-2 bg-black/40 backdrop-blur-md text-white border border-white/20 rounded-lg pl-4 pr-3 py-2 hover:bg-black/60 transition-all font-light shadow-xl text-sm md:text-base min-w-[140px] justify-between"
              >
                <span>{languages.find(l => l.value === language)?.name}</span>
                <ChevronDown className={`w-4 h-4 text-white/70 transition-transform duration-300 ${isLanguageOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Custom Dropdown Menu */}
              {isLanguageOpen && (
                <div className="absolute top-full right-0 mt-2 w-full min-w-[140px] bg-black/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[300px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/40">
                  {languages.map((lang) => (
                    <button
                      key={lang.value}
                      onClick={() => {
                        setLanguage(lang.value);
                        setIsLanguageOpen(false);
                      }}
                      className={`
                        w-full text-left px-4 py-2.5 text-sm transition-colors
                        ${language === lang.value ? "bg-white/20 text-white font-medium" : "text-white/70 hover:bg-white/10 hover:text-white"}
                      `}
                    >
                      {lang.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Click Hint (Optional) */}
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-white/50 text-sm tracking-widest uppercase font-light animate-pulse">
            Click anywhere to start
          </div>

          {/* Error Message */}
          {error && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 text-red-400 bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-red-500/30 shadow-2xl">
              {error}
            </div>
          )}
        </div>
      ) : (
        <LiveAvatarSession
          mode="FULL"
          language={language}
          sessionAccessToken={sessionToken}
          onSessionStopped={onSessionStopped}
        />
      )}
    </div>
  );
};
