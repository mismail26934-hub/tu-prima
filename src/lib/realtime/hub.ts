const OPEN = 1;

type RealtimeClient = {
  readyState: number;
  send: (data: string) => void;
};

type RealtimeHubState = {
  clients: Set<RealtimeClient>;
  flushTimer: ReturnType<typeof setTimeout> | null;
};

const GLOBAL_KEY = "__tuPrimaRealtimeHub";

function getHub(): RealtimeHubState {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: RealtimeHubState;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      clients: new Set<RealtimeClient>(),
      flushTimer: null,
    };
  }
  return g[GLOBAL_KEY];
}

export function realtimeAdd(client: RealtimeClient) {
  getHub().clients.add(client);
}

export function realtimeRemove(client: RealtimeClient) {
  getHub().clients.delete(client);
}

export function realtimeClientCount() {
  return getHub().clients.size;
}

function flushDashboardChanged() {
  const hub = getHub();
  hub.flushTimer = null;
  const payload = JSON.stringify({
    type: "dashboard-changed",
    at: new Date().toISOString(),
  });
  for (const client of hub.clients) {
    try {
      if (client.readyState === OPEN) client.send(payload);
    } catch {
      hub.clients.delete(client);
    }
  }
}

/** Coalesce bursts of Excel writes into one ping. */
export function broadcastDashboardChanged() {
  const hub = getHub();
  if (hub.flushTimer) return;
  hub.flushTimer = setTimeout(flushDashboardChanged, 40);
}
