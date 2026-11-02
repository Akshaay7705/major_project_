/**
 * Lightweight in-process cache for Next.js API routes.
 *
 * - TTL-based expiry (configurable per entry)
 * - Max-size cap with LRU-style eviction (oldest insertion removed first)
 * - Zero dependencies, works in the Node.js edge/server runtime
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // ms timestamp
}

class TTLCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    // Evict oldest entry when at capacity
    if (!this.store.has(key) && this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Remove all entries whose TTL has expired */
  purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton caches — one process, shared across all request handlers
// ---------------------------------------------------------------------------

/** Cache for LLM / RAG chat responses. TTL: 10 minutes */
export const chatCache = new TTLCache<string>(300);
export const CHAT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

/** Cache for full timetable API responses. TTL: 30 seconds (live clock data refreshes frequently) */
export const timetableCache = new TTLCache<unknown>(50);
export const TIMETABLE_CACHE_TTL_MS = 30 * 1000; // 30 s

/** Cache for RAG retrieval context (vector DB results). TTL: 5 minutes */
export const ragCache = new TTLCache<string>(200);
export const RAG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Normalise a chat query to a stable cache key:
 * - lowercase, collapse whitespace, strip trailing punctuation
 * - append language tag so different-language requests get separate entries
 */
export function chatCacheKey(message: string, language = "en"): string {
  const normalised = message
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.,;:]+$/, "")
    .trim();
  return `${language}::${normalised}`;
}

/** RAG retrieval cache key — just the normalised query */
export function ragCacheKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Timetable cache key — combines the query params */
export function timetableCacheKey(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}
