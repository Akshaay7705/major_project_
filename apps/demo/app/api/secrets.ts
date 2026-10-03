// Server-side configuration - these values are read from environment variables
// Make sure to set them in .env.local file

import fs from "fs";
import path from "path";

function readEnvFile(fileName: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const fullPath = path.resolve(process.cwd(), fileName);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const k = trimmed.substring(0, eqIdx).trim();
            const v = trimmed.substring(eqIdx + 1).trim();
            result[k] = v;
          }
        }
      }
    }
  } catch (_) {}
  return result;
}

const diskEnv = {
  ...readEnvFile("../../.env"),
  ...readEnvFile(".env.local"),
};

function getEnvVar(key: string, defaultValue: string): string {
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  if (diskEnv[key]) {
    return diskEnv[key];
  }
  return defaultValue;
}

export const API_KEY = getEnvVar("HEYGEN_API_KEY", "YOUR_API_KEY");
export const API_URL = getEnvVar(
  "HEYGEN_API_URL",
  "https://api.liveavatar.com",
);
export const AVATAR_ID = getEnvVar(
  "HEYGEN_AVATAR_ID",
  "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a",
);

// FULL MODE Customizations
// Wayne's avatar voice and context
export const VOICE_ID = getEnvVar("HEYGEN_VOICE_ID", "");
export const CONTEXT_ID = getEnvVar("HEYGEN_CONTEXT_ID", "");
export const LANGUAGE = getEnvVar("HEYGEN_LANGUAGE", "en");

// CUSTOM MODE Customizations
export const ELEVENLABS_API_KEY = getEnvVar(
  "ELEVENLABS_API_KEY",
  "YOUR_ELEVENLABS_API_KEY",
);
export const OPENAI_API_KEY = getEnvVar(
  "OPENAI_API_KEY",
  "YOUR_OPENAI_API_KEY",
);
export const GEMINI_API_KEY = getEnvVar(
  "GEMINI_API_KEY",
  "YOUR_GEMINI_API_KEY",
);
export const GEMINI_MODEL = getEnvVar("GEMINI_MODEL", "gemini-3.7-flash");

export const GROQ_API_KEY = getEnvVar("GROQ_API_KEY", "YOUR_API_KEY");
export const GROQ_MODEL = getEnvVar("GROQ_MODEL", "openai/gpt-oss-120b");

export const LOCAL_LLM_URL = getEnvVar(
  "LOCAL_LLM_URL",
  "http://localhost:11434/v1/chat/completions",
);
export const LOCAL_LLM_MODEL = getEnvVar("LOCAL_LLM_MODEL", "llama3");
