/* eslint-disable no-control-regex */
import { NextRequest } from "next/server";

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up expired entries periodically
setInterval(
  () => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetTime) {
        rateLimitStore.delete(key);
      }
    }
  },
  5 * 60 * 1000,
).unref?.();

export function checkRateLimit(
  req: NextRequest | Request,
  limit: number,
  windowMs: number,
): boolean {
  try {
    let ip = "127.0.0.1";
    if (req && "headers" in req && req.headers) {
      const forwarded = req.headers.get("x-forwarded-for");
      const realIp = req.headers.get("x-real-ip");
      const cfIp = req.headers.get("cf-connecting-ip");
      const firstForwarded = forwarded ? forwarded.split(",")[0]?.trim() : null;
      ip = firstForwarded || realIp || cfIp || "127.0.0.1";
    }

    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || now > record.resetTime) {
      rateLimitStore.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      return true;
    }

    if (record.count >= limit) {
      return false;
    }

    record.count += 1;
    return true;
  } catch (err) {
    console.error("Rate limit check error:", err);
    return true;
  }
}

const ALLOWED_LANGUAGES = new Set([
  "en",
  "english",
  "es",
  "spanish",
  "fr",
  "french",
  "de",
  "german",
  "it",
  "italian",
  "pt",
  "portuguese",
  "hi",
  "hindi",
  "ja",
  "japanese",
  "ko",
  "korean",
  "zh",
  "chinese",
  "kn",
  "kannada",
  "te",
  "telugu",
  "ta",
  "tamil",
]);

export function isValidLanguage(language: string): boolean {
  if (!language || typeof language !== "string") return false;
  const trimmed = language.trim();
  if (ALLOWED_LANGUAGES.has(trimmed.toLowerCase())) {
    return true;
  }
  // Standard BCP-47 or single alphabetic language name
  const safeLangRegex = /^[a-zA-Z]{2,15}(-[a-zA-Z0-9]{2,8})?$/;
  return safeLangRegex.test(trimmed);
}

export function sanitizeInput(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}
