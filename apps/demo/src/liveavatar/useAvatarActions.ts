import { useCallback } from "react";
import { useLiveAvatarContext } from "./context";

export const useAvatarActions = (mode: "FULL" | "CUSTOM") => {
  const { sessionRef } = useLiveAvatarContext();

  const interrupt = useCallback(() => {
    return sessionRef.current.interrupt();
  }, [sessionRef]);

  const repeat = useCallback(
    async (message: string) => {
      if (!message || message.trim() === "") {
        return;
      }
      if (mode === "FULL") {
        return sessionRef.current.repeat(message);
      } else if (mode === "CUSTOM") {
        const res = await fetch("/api/elevenlabs-text-to-speech", {
          method: "POST",
          body: JSON.stringify({ text: message }),
        });
        if (!res.ok) {
          console.error("Text to speech failed", await res.text());
          return;
        }
        const data = await res.json();
        if (data.audio) {
          return sessionRef.current.repeatAudio(data.audio);
        }
      }
    },
    [sessionRef, mode],
  );

  const startListening = useCallback(() => {
    return sessionRef.current.startListening();
  }, [sessionRef]);

  const stopListening = useCallback(() => {
    return sessionRef.current.stopListening();
  }, [sessionRef]);

  return {
    interrupt,
    repeat,
    startListening,
    stopListening,
  };
};
