"use client";

import { memo } from "react";
import type { Technician } from "@/lib/types";

type TechRow = Technician & { current_job_title?: string };

function StatusPill({ status }: { status: string }) {
  return (
    <span className="pill">
      <span className={`dot ${status}`} />
      {status.replace("_", " ")}
    </span>
  );
}

type TechnicianCardProps = {
  tech: TechRow;
  busy: boolean;
  canSetTechPresence: boolean;
  onStatus: (tech: TechRow) => void;
};

export const TechnicianCard = memo(function TechnicianCard({
  tech,
  busy,
  canSetTechPresence,
  onStatus,
}: TechnicianCardProps) {
  return (
    <div className="tech">
      <div className="name">{tech.name}</div>
      <div className="meta">
        {tech.sn}
        {tech.current_job_title ? ` · ${tech.current_job_title}` : ""}
      </div>
      <div className="tech-actions">
        <StatusPill status={tech.status} />
        {tech.status !== "busy" && (
          <button
            className="btn btn-ghost tech-presence-btn"
            disabled={busy || !canSetTechPresence}
            onClick={() => onStatus(tech)}
          >
            {tech.status === "available" ? "Set offline" : "Set available"}
          </button>
        )}
      </div>
    </div>
  );
});
