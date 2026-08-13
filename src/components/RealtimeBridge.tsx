"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { isBrowserOnline } from "@/lib/offline/network";
import { shouldHoldServerRefresh } from "@/lib/offline/sync";

export function RealtimeBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const schedule = (ms: number) => {
      if (stopped || retry) return;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, ms);
    };

    const connect = () => {
      if (stopped || !isBrowserOnline()) return;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as { type?: string };
          if (msg.type !== "dashboard-changed") return;
          if (shouldHoldServerRefresh()) return;
          void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.templates.all,
          });
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        socket = null;
        if (!stopped && isBrowserOnline()) schedule(2000);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();
    const onOnline = () => {
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      connect();
    };
    const onOffline = () => {
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      socket?.close();
      socket = null;
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      socket?.close();
    };
  }, [queryClient]);

  return null;
}
