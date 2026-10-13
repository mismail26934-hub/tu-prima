"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { JobBackupPage } from "@/components/JobBackupPage";

export default function BackupRoute() {
  const { data: session, status } = useSession();
  const level = String(session?.user?.level || "");

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated") {
      window.location.replace("/sign-in?callbackUrl=/backup");
      return;
    }
    if (level !== "superuser") window.location.replace("/");
  }, [level, status]);

  if (status !== "authenticated" || level !== "superuser") return null;
  return <JobBackupPage />;
}
