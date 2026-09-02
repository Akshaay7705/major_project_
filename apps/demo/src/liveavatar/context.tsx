import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  ConnectionQuality,
  LiveAvatarSession,
  SessionState,
  SessionEvent,
  VoiceChatEvent,
  VoiceChatState,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";
import { LiveAvatarSessionMessage } from "./types";

// Client-side API URL configuration
// If you need to override this, set NEXT_PUBLIC_HEYGEN_API_URL in .env.local
const API_URL =
  (typeof window !== "undefined" &&
    (window as any).NEXT_PUBLIC_HEYGEN_API_URL) ||
  process.env.NEXT_PUBLIC_HEYGEN_API_URL ||
  "https://api.liveavatar.com";

type LiveAvatarContextProps = {
  sessionRef: React.RefObject<LiveAvatarSession>;

  isMuted: boolean;
  voiceChatState: VoiceChatState;

  sessionState: SessionState;
  isStreamReady: boolean;
  connectionQuality: ConnectionQuality;

  isUserTalking: boolean;
  isAvatarTalking: boolean;

  messages: LiveAvatarSessionMessage[];

  // Voice transcription callbacks
  onUserTranscription?: (text: string) => void;
  onAvatarTranscription?: (text: string) => void;
};

export const LiveAvatarContext = createContext<LiveAvatarContextProps>({
  sessionRef: {
    current: null,
  } as unknown as React.RefObject<LiveAvatarSession>,
  connectionQuality: ConnectionQuality.UNKNOWN,
  isMuted: true,
  voiceChatState: VoiceChatState.INACTIVE,
  sessionState: SessionState.DISCONNECTED,
  isStreamReady: false,
  isUserTalking: false,
  isAvatarTalking: false,
  messages: [],
  onUserTranscription: undefined,
  onAvatarTranscription: undefined,
});

type LiveAvatarContextProviderProps = {
  children: React.ReactNode;
  sessionAccessToken: string;
};

const useSessionState = (sessionRef: React.RefObject<LiveAvatarSession>) => {
  const [sessionState, setSessionState] = useState<SessionState>(
    sessionRef.current?.state || SessionState.INACTIVE,
  );
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(
    sessionRef.current?.connectionQuality || ConnectionQuality.UNKNOWN,
  );
  const [isStreamReady, setIsStreamReady] = useState<boolean>(false);

  useEffect(() => {
    if (sessionRef.current) {
      sessionRef.current.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
        setSessionState(state);
        if (state === SessionState.DISCONNECTED) {
          sessionRef.current.removeAllListeners();
          sessionRef.current.voiceChat.removeAllListeners();
          setIsStreamReady(false);
        }
      });
      sessionRef.current.on(SessionEvent.SESSION_STREAM_READY, () => {
        setIsStreamReady(true);
      });
      sessionRef.current.on(
        SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED,
        setConnectionQuality,
      );
    }
  }, [sessionRef]);

  return { sessionState, isStreamReady, connectionQuality };
};

const useVoiceChatState = (sessionRef: React.RefObject<LiveAvatarSession>) => {
  const [isMuted, setIsMuted] = useState(true);
  const [voiceChatState, setVoiceChatState] = useState<VoiceChatState>(
    sessionRef.current?.voiceChat.state || VoiceChatState.INACTIVE,
  );

  useEffect(() => {
    if (sessionRef.current) {
      sessionRef.current.voiceChat.on(VoiceChatEvent.MUTED, () => {
        setIsMuted(true);
      });
      sessionRef.current.voiceChat.on(VoiceChatEvent.UNMUTED, () => {
        setIsMuted(false);
      });
      sessionRef.current.voiceChat.on(
        VoiceChatEvent.STATE_CHANGED,
        setVoiceChatState,
      );
    }
  }, [sessionRef]);

  return { isMuted, voiceChatState };
};

const useTalkingState = (sessionRef: React.RefObject<LiveAvatarSession>) => {
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);

  useEffect(() => {
    if (sessionRef.current) {
      sessionRef.current.on(AgentEventsEnum.USER_SPEAK_STARTED, () => {
        setIsUserTalking(true);
      });
      sessionRef.current.on(AgentEventsEnum.USER_SPEAK_ENDED, () => {
        setIsUserTalking(false);
      });
      sessionRef.current.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        setIsAvatarTalking(true);
      });
      sessionRef.current.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        setIsAvatarTalking(false);
      });
    }
  }, [sessionRef]);

  return { isUserTalking, isAvatarTalking };
};

const useVoiceTranscription = (
  sessionRef: React.RefObject<LiveAvatarSession>,
  onUserTranscription?: (text: string) => void,
  onAvatarTranscription?: (text: string) => void,
) => {
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    const handleUserTranscription = (event: any) => {
      // Logic based on provided context (1).tsx
      if (onUserTranscription && event) {
        // SDK event structure might be event.text directly or inside data object
        const text = event.text || event.data?.text || event.message;
        if (text) onUserTranscription(text);
      }
    };

    const handleAvatarTranscription = (event: any) => {
      if (onAvatarTranscription && event) {
        const text = event.text || event.data?.text || event.message;
        if (text) onAvatarTranscription(text);
      }
    };

    if (onUserTranscription) {
      session.on(AgentEventsEnum.USER_TRANSCRIPTION, handleUserTranscription);
    }

    if (onAvatarTranscription) {
      session.on(
        AgentEventsEnum.AVATAR_TRANSCRIPTION,
        handleAvatarTranscription,
      );
    }

    return () => {
      if (onUserTranscription) {
        session.off(
          AgentEventsEnum.USER_TRANSCRIPTION,
          handleUserTranscription,
        );
      }
      if (onAvatarTranscription) {
        session.off(
          AgentEventsEnum.AVATAR_TRANSCRIPTION,
          handleAvatarTranscription,
        );
      }
    };
  }, [sessionRef, onUserTranscription, onAvatarTranscription]);
};

// const useChatHistoryState = (
//   sessionRef: React.RefObject<LiveAvatarSession>
// ) => {
//   const [messages, setMessages] = useState<LiveAvatarSessionMessage[]>([]);
//   const currentSenderRef = useRef<MessageSender | null>(null);

//   // useEffect(() => {
//   //   if (sessionRef.current) {
//   //     const handleMessage = (
//   //       sender: MessageSender,
//   //       { task_id, message }: { task_id: string; message: string }
//   //     ) => {
//   //       if (currentSenderRef.current === sender) {
//   //         setMessages((prev) => [
//   //           ...prev.slice(0, -1),
//   //           {
//   //             ...prev[prev.length - 1]!,
//   //             message: [prev[prev.length - 1]!.message, message].join(""),
//   //           },
//   //         ]);
//   //       } else {
//   //         currentSenderRef.current = sender;
//   //         setMessages((prev) => [
//   //           ...prev,
//   //           {
//   //             id: task_id,
//   //             sender: sender,
//   //             message,
//   //             timestamp: Date.now(),
//   //           },
//   //         ]);
//   //       }
//   //     };

//   //     sessionRef.current.on(
//   //       AgentEventsEnum.USER_SPEAK_STARTED,
//   //       (data) => console.log("USER_SPEAK_STARTED", data)
//   //       handleMessage(MessageSender.USER, {
//   //   task_id: data.,
//   //   message: data.text || "",
//   // })
//   //     );
//   //   }
//   // }, [sessionRef]);

//   return { messages };
// };

export const LiveAvatarContextProvider = ({
  children,
  sessionAccessToken,
  onUserTranscription,
  onAvatarTranscription,
}: LiveAvatarContextProviderProps & {
  onUserTranscription?: (text: string) => void;
  onAvatarTranscription?: (text: string) => void;
}) => {
  // Default voice chat on
  const config = {
    voiceChat: true,
    apiUrl: API_URL,
  };
  const sessionRef = useRef<LiveAvatarSession>(
    new LiveAvatarSession(sessionAccessToken, config),
  );

  const { sessionState, isStreamReady, connectionQuality } =
    useSessionState(sessionRef);

  const { isMuted, voiceChatState } = useVoiceChatState(sessionRef);
  const { isUserTalking, isAvatarTalking } = useTalkingState(sessionRef);

  // Hook up voice transcription
  useVoiceTranscription(sessionRef, onUserTranscription, onAvatarTranscription);
  // const { messages } = useChatHistoryState(sessionRef);

  return (
    <LiveAvatarContext.Provider
      value={{
        sessionRef,
        sessionState,
        isStreamReady,
        connectionQuality,
        isMuted,
        voiceChatState,
        isUserTalking,
        isAvatarTalking,
        messages: [], // TODO - properly implement chat history
        onUserTranscription,
        onAvatarTranscription,
      }}
    >
      {children}
    </LiveAvatarContext.Provider>
  );
};

export const useLiveAvatarContext = () => {
  return useContext(LiveAvatarContext);
};
