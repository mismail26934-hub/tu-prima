"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { EditIcon, TrashIcon } from "@/components/ActionIcons";
import { DragScroll } from "@/components/DragScroll";
import { JOB_HANDOVER_COLUMN_LABEL_KEY } from "@/components/JobHandoverColumnSettings";
import { useT } from "@/i18n/useT";
import { planMpLabel, prevMpLabel } from "@/lib/handover-form-format";
import {
  resolveJobHandoverDisplayColumns,
  stickyLeftFromWidths,
  type JobHandoverColumnId,
} from "@/lib/job-handover-columns";
import type { JobWithDetails, Technician } from "@/lib/types";
import { useJobHandoverColumnsStore } from "@/store/jobHandoverColumnsStore";

export type JobHandoverNoteRow = {
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
  job: JobWithDetails;
  rows: JobHandoverNoteRow[];
  boardTechnicians?: Technician[];
  busy?: boolean;
  actionMode: "none" | "edit" | "delete";
  onEdit: (row: JobHandoverNoteRow) => void;
  onDelete: (row: JobHandoverNoteRow) => void;
};

function stickyStyle(
  id: JobHandoverColumnId,
  stickyLeft: Partial<Record<JobHandoverColumnId, number>>,
  frozenEdgeId: JobHandoverColumnId | null
): CSSProperties | undefined {
  if (!(id in stickyLeft)) return undefined;
  return {
    position: "sticky",
    left: stickyLeft[id],
    zIndex: id === frozenEdgeId ? 3 : 2,
  };
}

function frozenClassName(
  id: JobHandoverColumnId,
  stickyLeft: Partial<Record<JobHandoverColumnId, number>>,
  frozenEdgeId: JobHandoverColumnId | null
): string {
  if (!(id in stickyLeft)) return "";
  return id === frozenEdgeId ? "is-frozen-col is-frozen-edge" : "is-frozen-col";
}

export function JobHandoverNotesTable({
  job,
  rows,
  boardTechnicians = [],
  busy = false,
  actionMode,
  onEdit,
  onDelete,
}: Props) {
  const t = useT();
  const tableRef = useRef<HTMLTableElement>(null);
  const order = useJobHandoverColumnsStore((s) => s.order);
  const hidden = useJobHandoverColumnsStore((s) => s.hidden);
  const frozen = useJobHandoverColumnsStore((s) => s.frozen);
  const prevMp = prevMpLabel(job) || "—";

  const { columns, frozenIds } = useMemo(
    () =>
      resolveJobHandoverDisplayColumns(
        { order, hidden, frozen },
        { includeActions: actionMode !== "none" }
      ),
    [order, hidden, frozen, actionMode]
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
      const widths: Partial<Record<JobHandoverColumnId, number>> = {};
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
  }, [frozenIds, columns, rows.length]);

  function renderCell(id: JobHandoverColumnId, row: JobHandoverNoteRow): ReactNode {
    switch (id) {
      case "no":
        return row.order;
      case "shiftDate":
        return row.shift_date || "—";
      case "from":
        return row.from_name || "—";
      case "to":
        return row.to_name || "—";
      case "progress":
        return (
          <textarea
            className="handover-input handover-cell-textarea"
            rows={3}
            readOnly
            tabIndex={-1}
            value={row.progress_text || ""}
            placeholder="—"
            aria-label={t("job.progressText")}
          />
        );
      case "handover":
        return (
          <textarea
            className="handover-input handover-cell-textarea"
            rows={3}
            readOnly
            tabIndex={-1}
            value={row.handover_text || ""}
            placeholder="—"
            aria-label={t("job.handoverText")}
          />
        );
      case "prevMp":
        return (
          <span className="job-handover-mp-text">
            {prevMp}
          </span>
        );
      case "planMp": {
        const label =
          planMpLabel(row.plan_technician_ids, [
            ...(job.technician_index || []),
            ...(job.technicians || []),
            ...boardTechnicians,
            job.technician || null,
          ]) || "—";
        return <span className="job-handover-mp-text">{label}</span>;
      }
      case "done":
        return row.done ? "Yes" : "No";
      case "actions":
        if (actionMode === "edit") {
          return (
            <button
              type="button"
              className="btn btn-sm btn-icon"
              disabled={busy}
              aria-label="Ubah"
              title="Ubah"
              onClick={() => onEdit(row)}
            >
              <EditIcon />
            </button>
          );
        }
        if (actionMode === "delete") {
          return (
            <button
              type="button"
              className="btn btn-sm btn-danger btn-icon"
              disabled={busy}
              aria-label="Hapus"
              title="Hapus"
              onClick={() => onDelete(row)}
            >
              <TrashIcon />
            </button>
          );
        }
        return null;
      default:
        return null;
    }
  }

  function dataLabel(id: JobHandoverColumnId): string {
    if (id === "actions") return "Aksi";
    return t(JOB_HANDOVER_COLUMN_LABEL_KEY[id]);
  }

  return (
    <DragScroll
      className="handover-table-wrap job-handover-notes-wrap"
      panOnCells
    >
      <table
        ref={tableRef}
        className="handover-table job-handover-notes-table"
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
                {col.id === "actions"
                  ? null
                  : t(JOB_HANDOVER_COLUMN_LABEL_KEY[col.id])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.done ? "is-done" : undefined}>
              {columns.map((col) => (
                <td
                  key={col.id}
                  data-label={dataLabel(col.id)}
                  className={[
                    col.tdClassName,
                    frozenClassName(col.id, stickyLeft, frozenEdgeId),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={stickyStyle(col.id, stickyLeft, frozenEdgeId)}
                >
                  {renderCell(col.id, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScroll>
  );
}
