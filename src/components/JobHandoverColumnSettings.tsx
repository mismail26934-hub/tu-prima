"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageKey } from "@/i18n/messages";
import { useT } from "@/i18n/useT";
import { useAnchoredPanelStyle } from "@/hooks/useAnchoredPanelStyle";
import {
  JOB_HANDOVER_COLUMN_DEFS,
  JOB_HANDOVER_COLUMN_IDS,
  type JobHandoverColumnId,
} from "@/lib/job-handover-columns";
import { useJobHandoverColumnsStore } from "@/store/jobHandoverColumnsStore";

const LABEL_KEY: Record<JobHandoverColumnId, MessageKey> = {
  no: "master.col.no",
  shiftDate: "job.shiftDate",
  from: "job.handoverFrom",
  to: "job.handoverTo",
  progress: "job.progressText",
  handover: "job.handoverText",
  prevMp: "job.prevMp",
  planMp: "job.planMp",
  done: "master.col.done",
  actions: "master.col.actions",
};

export function JobHandoverColumnSettings() {
  const t = useT();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const order = useJobHandoverColumnsStore((s) => s.order);
  const hidden = useJobHandoverColumnsStore((s) => s.hidden);
  const frozen = useJobHandoverColumnsStore((s) => s.frozen);
  const setHidden = useJobHandoverColumnsStore((s) => s.setHidden);
  const setFrozen = useJobHandoverColumnsStore((s) => s.setFrozen);
  const move = useJobHandoverColumnsStore((s) => s.move);
  const reset = useJobHandoverColumnsStore((s) => s.reset);

  const hiddenSet = new Set(hidden);
  const frozenSet = new Set(frozen);
  const ids = order.length ? order : [...JOB_HANDOVER_COLUMN_IDS];
  const panelStyle = useAnchoredPanelStyle({ open, rootRef });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const panel =
    open && mounted && panelStyle
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            className="master-col-settings-panel"
            role="dialog"
            aria-label={t("master.col.settings")}
            style={panelStyle}
          >
            <div className="master-col-settings-head">
              <strong>{t("master.col.settings")}</strong>
              <button type="button" className="btn btn-sm" onClick={() => reset()}>
                {t("master.col.reset")}
              </button>
            </div>
            <p className="master-col-settings-hint">{t("master.col.hint")}</p>
            <ul className="master-col-settings-list">
              {ids.map((id, index) => {
                const def = JOB_HANDOVER_COLUMN_DEFS[id];
                const isHidden = hiddenSet.has(id);
                const isFrozen = frozenSet.has(id);
                return (
                  <li key={id} className={isHidden ? "is-hidden-col" : undefined}>
                    <div className="master-col-settings-move">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={index === 0}
                        aria-label={t("master.col.moveUp")}
                        onClick={() => move(id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={index === ids.length - 1}
                        aria-label={t("master.col.moveDown")}
                        onClick={() => move(id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                    <span className="master-col-settings-name">
                      {t(LABEL_KEY[id])}
                    </span>
                    <label className="master-col-settings-check">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        disabled={Boolean(def.required)}
                        onChange={(e) => setHidden(id, !e.target.checked)}
                      />
                      <span>{t("master.col.show")}</span>
                    </label>
                    <label className="master-col-settings-check">
                      <input
                        type="checkbox"
                        checked={isFrozen}
                        disabled={isHidden}
                        onChange={(e) => setFrozen(id, e.target.checked)}
                      />
                      <span>{t("master.col.freeze")}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="master-col-settings" ref={rootRef}>
      <button
        type="button"
        className="btn btn-sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">☰</span>
        <span className="btn-label">{t("master.col.settings")}</span>
      </button>
      {panel}
    </div>
  );
}

export { LABEL_KEY as JOB_HANDOVER_COLUMN_LABEL_KEY };
