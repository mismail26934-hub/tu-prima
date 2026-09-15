const GLOBAL_KEY = "__tuPrimaLoginLockout";
const MAX_FAILURES = 3;
const LOCK_MS = 60_000;
const MAX_ENTRIES = 500;

type LockEntry = {
  failures: number;
  lockedUntil: number;
};

type Store = {
  byUser: Map<string, LockEntry>;
};

function getStore(): Store {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Store };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { byUser: new Map() };
  }
  return g[GLOBAL_KEY];
}

export function normalizeLoginUsername(username: string): string {
  return String(username || "").trim().toLowerCase();
}

function prune(store: Store, now: number) {
  if (store.byUser.size <= MAX_ENTRIES) {
    for (const [key, entry] of store.byUser) {
      if (entry.lockedUntil && entry.lockedUntil <= now && entry.failures === 0) {
        store.byUser.delete(key);
      }
    }
    return;
  }
  for (const [key, entry] of store.byUser) {
    if (!entry.lockedUntil || entry.lockedUntil <= now) {
      store.byUser.delete(key);
    }
  }
}

function liveEntry(username: string, now: number): LockEntry | null {
  const key = normalizeLoginUsername(username);
  if (!key) return null;
  const store = getStore();
  prune(store, now);
  const entry = store.byUser.get(key);
  if (!entry) return null;
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    store.byUser.delete(key);
    return null;
  }
  return entry;
}

export function getLoginLockout(username: string): {
  locked: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  const entry = liveEntry(username, now);
  if (!entry?.lockedUntil || entry.lockedUntil <= now) {
    return { locked: false, retryAfterSec: 0 };
  }
  return {
    locked: true,
    retryAfterSec: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
  };
}

export function recordLoginFailure(username: string): {
  locked: boolean;
  retryAfterSec: number;
} {
  const key = normalizeLoginUsername(username);
  if (!key) return { locked: false, retryAfterSec: 0 };
  const now = Date.now();
  const store = getStore();
  prune(store, now);
  const current = liveEntry(key, now);
  if (current?.lockedUntil && current.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((current.lockedUntil - now) / 1000)),
    };
  }
  const failures = (current?.failures || 0) + 1;
  if (failures >= MAX_FAILURES) {
    store.byUser.set(key, { failures: 0, lockedUntil: now + LOCK_MS });
    return { locked: true, retryAfterSec: Math.ceil(LOCK_MS / 1000) };
  }
  store.byUser.set(key, { failures, lockedUntil: 0 });
  return { locked: false, retryAfterSec: 0 };
}

export function clearLoginLockout(username: string) {
  const key = normalizeLoginUsername(username);
  if (!key) return;
  getStore().byUser.delete(key);
}
