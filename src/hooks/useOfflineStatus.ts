"use client";

import { useEffect, useState } from "react";
import { isBrowserOnline } from "@/lib/offline/network";
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
    applyOnline();
    window.addEventListener("online", applyOnline);
    window.addEventListener("offline", applyOnline);
    const unsubSync = subscribeSync(setSync);
    return () => {
      window.removeEventListener("online", applyOnline);
      window.removeEventListener("offline", applyOnline);
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
