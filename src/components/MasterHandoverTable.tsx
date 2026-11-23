"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { EditIcon } from "@/components/ActionIcons";
import { DragScroll } from "@/components/DragScroll";
import { MASTER_HANDOVER_COLUMN_LABEL_KEY } from "@/components/MasterHandoverColumnSettings";
import { useT } from "@/i18n/useT";
import {
  planMpLabel,
  prevMpLabel,
  formatHandoverDate,
  unitNoFromJob,
} from "@/lib/handover-form-format";
import {
  resolveMasterHandoverDisplayColumns,
  stickyLeftFromWidths,
  type MasterHandoverColumnId,
} from "@/lib/master-handover-columns";
import type { JobWithDetails, Technician } from "@/lib/types";
import { useMasterHandoverColumnsStore } from "@/store/masterHandoverColumnsStore";

export type MasterHandoverLocalRow = {
  key: string;
  id?: string;
  title: string;
  shift_date: string;
  to_name: string;
  to_user_id: string;
  from_name: string;
  from_user_id: string;
  note: string;
  progress_text: string;
  handover_text: string;
  plan_technician_ids: string[];
  done: boolean;
  order: number;
};

type Props = {
  jobs: JobWithDetails[];
  boardTechnicians: Technician[];
  busy: boolean;
  canNotesWriteForJob: (job: JobWithDetails) => boolean;
  onAdd: (job: JobWithDetails) => void;
  onEdit: (job: JobWithDetails, row: MasterHandoverLocalRow) => void;
};

function stickyStyle(
  id: MasterHandoverColumnId,
  stickyLeft: Partial<Record<MasterHandoverColumnId, number>>,
  frozenEdgeId: MasterHandoverColumnId | null
): CSSProperties | undefined {
  if (!(id in stickyLeft)) return undefined;
  return {
    position: "sticky",
    left: stickyLeft[id],
    zIndex: id === frozenEdgeId ? 3 : 2,
  };
}

function frozenClassName(
  id: MasterHandoverColumnId,
  stickyLeft: Partial<Record<MasterHandoverColumnId, number>>,
  frozenEdgeId: MasterHandoverColumnId | null
): string {
  if (!(id in stickyLeft)) return "";
  return id === frozenEdgeId ? "is-frozen-col is-frozen-edge" : "is-frozen-col";
}

export function MasterHandoverTable({
  jobs,
  boardTechnicians,
  busy,
  canNotesWriteForJob,
  onAdd,
  onEdit,
}: Props) {
  const t = useT();
  const tableRef = useRef<HTMLTableElement>(null);
  const order = useMasterHandoverColumnsStore((s) => s.order);
  const hidden = useMasterHandoverColumnsStore((s) => s.hidden);
  const frozen = useMasterHandoverColumnsStore((s) => s.frozen);

  const { columns, frozenIds } = useMemo(
    () => resolveMasterHandoverDisplayColumns({ order, hidden, frozen }),
    [order, hidden, frozen]
  );
  const frozenEdgeId = frozenIds.length ? frozenIds[frozenIds.length - 1]! : null;

  const [stickyLeft, setStickyLeft] = useState(() =>
    stickyLeftFromWidths(frozenIds, {})
  );

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || !frozenIds.length) {
      setStickyLeft({});
      return;
    }

    const measure = () => {
      const widths: Partial<Record<MasterHandoverColumnId, number>> = {};
      for (const id of frozenIds) {
        const th = table.querySelector(
          `thead th[data-col-id="${id}"]`
        ) as HTMLTableCellElement | null;
        if (th) widths[id] = th.getBoundingClientRect().width;
      }
      setStickyLeft(stickyLeftFromWidths(frozenIds, widths));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    for (const id of frozenIds) {
      const th = table.querySelector(`thead th[data-col-id="${id}"]`);
      if (th) ro.observe(th);
    }
    return () => ro.disconnect();
  }, [frozenIds, columns, jobs.length]);

  return (
    <DragScroll className="backup-table-wrap master-handover-table-wrap">
      <table
        ref={tableRef}
        className="backup-table master-handover-table"
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                data-col-id={col.id}
                className={[
                  col.thClassName,
                  frozenClassName(col.id, stickyLeft, frozenEdgeId),
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={stickyStyle(col.id, stickyLeft, frozenEdgeId)}
              >
                {t(MASTER_HANDOVER_COLUMN_LABEL_KEY[col.id])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(() => {
            let rowNo = 0;
            return jobs.flatMap((job) => {
              const writeOk = canNotesWriteForJob(job);
              const unitNo = unitNoFromJob(job);
              const unitIn =
                formatHandoverDate(String(job.arrived_at || "")) || "—";
              const customer = String(job.customer || "").trim() || "—";
              const jobLabel = [job.title, job.priority, job.status]
                .map((p) => String(p || "").trim())
                .filter(Boolean)
                .join(" · ");
              const prevMp = prevMpLabel(job) || "—";
              const handovers = [...(job.handovers || [])].sort(
                (a, b) => a.order - b.order
              );

              const addBtn = (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || !writeOk}
                  title={
                    writeOk
                      ? t("job.handoverFormCreateTitle")
                      : t("master.handoverNeedStart")
                  }
                  aria-label="+ Tambah"
                  onClick={() => onAdd(job)}
                >
                  <span aria-hidden="true">+</span>
                  <span className="btn-label">Tambah</span>
                </button>
              );

              const jobCell = (id: MasterHandoverColumnId) => {
                switch (id) {
                  case "no":
                    return rowNo;
                  case "unitNo":
                    return <strong>{unitNo}</strong>;
                  case "unitIn":
                    return unitIn;
                  case "customer":
                    return customer;
                  case "description":
                    return (
                      <span className="master-handover-job-label">
                        {jobLabel}
                      </span>
                    );
                  default:
                    return null;
                }
              };

              if (!handovers.length) {
                rowNo += 1;
                let emptyMsgPlaced = false;
                return [
                  <tr key={`${job.id}-empty`}>
                    {columns.map((col) => {
                      const style = stickyStyle(
                        col.id,
                        stickyLeft,
                        frozenEdgeId
                      );
                      const frozenClass = frozenClassName(
                        col.id,
                        stickyLeft,
                        frozenEdgeId
                      );
                      if (col.kind === "job") {
                        return (
                          <td
                            key={col.id}
                            className={[col.tdClassName, frozenClass]
                              .filter(Boolean)
                              .join(" ")}
                            style={style}
                          >
                            {jobCell(col.id)}
                          </td>
                        );
                      }
                      if (col.kind === "actions") {
                        return (
                          <td
                            key={col.id}
                            className={[col.tdClassName, frozenClass]
                              .filter(Boolean)
                              .join(" ")}
                            style={style}
                          >
                            <div className="master-handover-actions">
                              {addBtn}
                            </div>
                          </td>
                        );
                      }
                      const showMsg = !emptyMsgPlaced;
                      emptyMsgPlaced = true;
                      return (
                        <td
                          key={col.id}
                          className={[
                            showMsg ? "master-handover-empty" : "",
                            col.tdClassName,
                            frozenClass,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          style={style}
                        >
                          {showMsg ? t("master.handoverNoRows") : "—"}
                        </td>
                      );
                    })}
                  </tr>,
                ];
              }

              return handovers.map((h, idx) => {
                rowNo += 1;
                const localRow: MasterHandoverLocalRow = {
                  key: h.id,
                  id: h.id,
                  order: h.order,
                  title: h.title || "",
                  shift_date: h.shift_date || "",
                  from_name: h.from_name || "",
                  from_user_id: h.from_user_id || "",
                  to_name: h.to_name || "",
                  to_user_id: h.to_user_id || "",
                  note: h.note || "",
                  progress_text: h.progress_text || "",
                  handover_text: h.handover_text || "",
                  plan_technician_ids: h.plan_technician_ids || [],
                  done: h.done === "1",
                };
                const planMp =
                  planMpLabel(h.plan_technician_ids, [
                    ...(job.technician_index || []),
                    ...(job.technicians || []),
                    ...boardTechnicians,
                    job.technician || null,
                  ]) || "—";

                const handoverCell = (id: MasterHandoverColumnId) => {
                  switch (id) {
                    case "shiftDate":
                      return h.shift_date || "—";
                    case "from":
                      return h.from_name || "—";
                    case "to":
                      return h.to_name || "—";
                    case "progress":
                      return h.progress_text || "—";
                    case "handover":
                      return h.handover_text || "—";
                    case "prevMp":
                      return prevMp;
                    case "planMp":
                      return planMp;
                    case "done":
                      return h.done === "1" ? "Yes" : "No";
                    default:
                      return null;
                  }
                };

                return (
                  <tr
                    key={h.id}
                    className={h.done === "1" ? "is-done" : undefined}
                  >
                    {columns.map((col) => {
                      const style = stickyStyle(
                        col.id,
                        stickyLeft,
                        frozenEdgeId
                      );
                      const frozenClass = frozenClassName(
                        col.id,
                        stickyLeft,
                        frozenEdgeId
                      );
                      if (col.kind === "job") {
                        return (
                          <td
                            key={col.id}
                            className={[col.tdClassName, frozenClass]
                              .filter(Boolean)
                              .join(" ")}
                            style={style}
                          >
                            {col.id === "no" ? rowNo : jobCell(col.id)}
                          </td>
                        );
                      }
                      if (col.kind === "handover") {
                        return (
                          <td
                            key={col.id}
                            className={[col.tdClassName, frozenClass]
                              .filter(Boolean)
                              .join(" ")}
                            style={style}
                          >
                            {handoverCell(col.id)}
                          </td>
                        );
                      }
                      return (
                        <td
                          key={col.id}
                          className={[col.tdClassName, frozenClass]
                            .filter(Boolean)
                            .join(" ")}
                          style={style}
                        >
                          <div className="master-handover-actions">
                            {idx === 0 ? addBtn : null}
                            <button
                              type="button"
                              className="btn btn-sm btn-edit"
                              disabled={busy || !writeOk}
                              onClick={() => onEdit(job, localRow)}
                            >
                              <EditIcon />
                              <span className="btn-label">Ubah</span>
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              });
            });
          })()}
        </tbody>
      </table>
    </DragScroll>
  );
}
