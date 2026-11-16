"use client";

import { useEffect } from "react";

/** Backup lives on the board so the side navbar stays available. */
export default function BackupRoute() {
  useEffect(() => {
    window.location.replace("/?manage=backup");
  }, []);
  return null;
}
