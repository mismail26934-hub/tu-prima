"use client";

import { useEffect, useState } from "react";
import {
  clearBrowserUnreachable,
  isBrowserOnline,
} from "@/lib/offline/network";
import { flushOutbox, subscribeSync, type SyncState } from "@/lib/offline/sync";

export function useOfflineStatus() {
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState<SyncState>({
    syncing: false,
    pending: 0,
    error: "",
    lastSyncedAt: null,
  });

  useEffect(() => {
    const applyOnline = () => setOnline(isBrowserOnline());
    const onOnline = () => {
      // Browser says NIC is up — drop sticky DevTools-offline latch.
      clearBrowserUnreachable();
      applyOnline();
    };
    applyOnline();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", applyOnline);
    window.addEventListener("prima-connectivity", applyOnline);
    const unsubSync = subscribeSync(setSync);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", applyOnline);
      window.removeEventListener("prima-connectivity", applyOnline);
      unsubSync();
    };
  }, []);

  return {
    online,
    pending: sync.pending,
    syncing: sync.syncing,
    error: sync.error,
    lastSyncedAt: sync.lastSyncedAt,
    retry: () => void flushOutbox(),
  };
}
