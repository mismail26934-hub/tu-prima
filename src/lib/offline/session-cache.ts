const KEY = "tu-prima-session";

export type CachedSession = {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    level?: string;
  };
  expires?: string;
};

export function readCachedSession(): CachedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession;
    if (parsed?.expires && Date.parse(parsed.expires) < Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedSession(session: CachedSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (!session?.user) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* ignore quota */
  }
}
