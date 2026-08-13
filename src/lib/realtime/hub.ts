const OPEN = 1;

type RealtimeClient = {
  readyState: number;
  send: (data: string) => void;
};

const clients = new Set<RealtimeClient>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function realtimeAdd(client: RealtimeClient) {
  clients.add(client);
}

export function realtimeRemove(client: RealtimeClient) {
  clients.delete(client);
}

export function realtimeClientCount() {
  return clients.size;
}

function flushDashboardChanged() {
  flushTimer = null;
  const payload = JSON.stringify({
    type: "dashboard-changed",
    at: new Date().toISOString(),
  });
  for (const client of clients) {
    try {
      if (client.readyState === OPEN) client.send(payload);
    } catch {
      clients.delete(client);
    }
  }
}

/** Coalesce bursts of Excel writes into one ping. */
export function broadcastDashboardChanged() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushDashboardChanged, 40);
}
