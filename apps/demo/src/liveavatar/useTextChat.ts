import { useCallback } from "react";
import { useLiveAvatarContext } from "./context";

export const useTextChat = (mode: "FULL" | "CUSTOM") => {
  const { sessionRef } = useLiveAvatarContext();

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message || message.trim() === "") {
        return;
      }
      if (mode === "FULL") {
        return sessionRef.current.message(message);
      } else if (mode === "CUSTOM") {
        const response = await fetch("/api/openai-chat-complete", {
          method: "POST",
          body: JSON.stringify({ message }),
        });
        if (!response.ok) {
          console.error("Chat completion failed", await response.text());
          return;
        }
        const { response: chatResponseText } = await response.json();

        if (!chatResponseText) {
          console.error("No response from chat completion");
          return;
        }

        const res = await fetch("/api/elevenlabs-text-to-speech", {
          method: "POST",
          body: JSON.stringify({ text: chatResponseText }),
        });
        if (!res.ok) {
          console.error("Text to speech failed", await res.text());
          return;
        }
        const data = await res.json();
        const { audio } = data;

        if (audio) {
          // Have the avatar repeat the audio
          return sessionRef.current.repeatAudio(audio);
        }
      }
    },
    [sessionRef, mode],
  );

  return {
    sendMessage,
  };
};
