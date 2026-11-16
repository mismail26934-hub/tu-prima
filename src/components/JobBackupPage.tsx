"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useJobBackups } from "@/hooks/useMasterQueries";
import { SearchIcon } from "@/components/SearchIcon";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { JobChangeBackup } from "@/lib/types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

const ACTION_LABEL: Record<string, string> = {
  create: "Tambah",
  update: "Ubah",
  delete: "Hapus",
  complete: "Selesai",
  cancel: "Batal",
  assign: "Assign",
  start: "Mulai",
  pause: "Jeda",
  resume: "Lanjut",
  start_steps: "Mulai step",
  complete_step: "Selesai step",
  reopen: "Buka lagi",
};

const ENTITY_LABEL: Record<string, string> = {
  job: "Job",
  job_handover: "Handover",
  job_part_loan: "Part loan",
};

const PAGE_SIZE = 10;

function actionLabel(action: string): string {
  const key = action.trim().toLowerCase();
  if (ACTION_LABEL[key]) return ACTION_LABEL[key];
  if (!key) return "—";
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function entityLabel(entity: string): string {
  const key = entity.trim().toLowerCase();
  return ENTITY_LABEL[key] || entity || "—";
}

function formatWhen(value: string): string {
  const raw = (value || "").trim();
  if (!raw) return "—";
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw.replace("T", " ").slice(0, 16);
  const day = String(date.getDate()).padStart(2, "0");
  const month = MONTHS[date.getMonth()];
  const year = String(date.getFullYear()).slice(2);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hour}:${minute}`;
}

function dataLabel(summary: string): string {
  const text = (summary || "").trim();
  if (!text) return "—";
  const parts = text
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^status\s/i.test(last)) {
      return parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    }
    if (/\bjob\b/i.test(text)) return last;
  }
  return (
    text
      .replace(/^(Tambah|Update|Hapus|Buat)\s+(handover|part loan|job)\s+/i, "")
      .trim() || text
  );
}

function snapshotFields(row: JobChangeBackup): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: unknown) => {
    const text = String(value ?? "").trim();
    if (text) fields.push({ label, value: text });
  };
  push("Ringkasan", row.summary);
  const bundle = readBundle(row.after_json) || readBundle(row.before_json);
  const job = bundle?.job;
  if (job) {
    push("Judul", job.title);
    push("Unit", job.unit);
    push("Status", job.status);
    push("Prioritas", job.priority);
  }
  const handover = bundle?.handover;
  if (handover) push("Handover", handover.title);
  const loan = bundle?.part_loan;
  if (loan) push("Part", loan.part_name);
  if (row.job_id) push("Job", row.job_id);
  if (row.undone === "1") push("Undo", "Sudah di-undo");
  return fields;
}

function readBundle(raw: string | undefined): {
  job?: { title?: string; unit?: string; status?: string; priority?: string } | null;
  handover?: { title?: string } | null;
  part_loan?: { part_name?: string } | null;
} | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as {
      job?: { title?: string; unit?: string; status?: string; priority?: string } | null;
      handover?: { title?: string } | null;
      part_loan?: { part_name?: string } | null;
    };
  } catch {
    return null;
  }
}

export function JobBackupPage({
  embedded = false,
  onBack,
}: {
  embedded?: boolean;
  onBack?: () => void;
} = {}) {
  const queryClient = useQueryClient();
  const [includeUndone, setIncludeUndone] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [undoAlert, setUndoAlert] = useState<
    | { phase: "confirm"; row: JobChangeBackup }
    | { phase: "loading"; row: JobChangeBackup }
    | { phase: "success"; message: string }
    | { phase: "error"; message: string }
    | null
  >(null);
  const backupsQuery = useJobBackups(includeUndone, true);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const backups = backupsQuery.data || [];
    if (!needle) return backups;
    return backups.filter((item) =>
      [
        actionLabel(item.action),
        entityLabel(item.entity),
        dataLabel(item.summary),
        item.summary,
        item.user_name,
        item.user_level,
        formatWhen(item.at),
      ]
        .join("\n")
        .toLowerCase()
        .includes(needle)
    );
  }, [backupsQuery.data, search]);
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(totalPages, 1));
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function showPage(next: number) {
    setPage(next);
    setOpenId(null);
  }

  function applySearch(next: string) {
    setSearch(next);
    setPage(1);
    setOpenId(null);
  }

  async function undoRow(row: JobChangeBackup) {
    setUndoAlert({ phase: "loading", row });
    try {
      await api("/api/backups/jobs", {
        method: "POST",
        body: JSON.stringify({ id: row.id }),
      });
      setOpenId(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      await queryClient.invalidateQueries({ queryKey: queryKeys.board.all });
      setUndoAlert({
        phase: "success",
        message: `Perubahan ${actionLabel(row.action).toLowerCase()} pada ${dataLabel(row.summary)} sudah dikembalikan.`,
      });
    } catch (err) {
      setUndoAlert({
        phase: "error",
        message: err instanceof Error ? err.message : "Gagal undo",
      });
    }
  }

  return (
    <main className={embedded ? "backup-screen backup-screen--embedded" : "app backup-screen"}>
      <section className="panel">
        <div className="panel-head">
          <h2>BACKUP DATA</h2>
          <div className="panel-actions">
            {onBack ? (
              <button type="button" className="btn" aria-label="Kembali" onClick={onBack}>
                <BackIcon />
                <span className="backup-btn-label">Kembali</span>
              </button>
            ) : (
              <Link className="btn" href="/" aria-label="Kembali">
                <BackIcon />
                <span className="backup-btn-label">Kembali</span>
              </Link>
            )}
            <div className="search-pair backup-search-pair">
              <input
                className="backup-search"
                type="search"
                placeholder="Cari data atau pengguna"
                value={searchDraft}
                onChange={(event) => {
                  const next = event.target.value;
                  setSearchDraft(next);
                  if (!next.trim()) applySearch("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applySearch(searchDraft.trim());
                  }
                }}
              />
              <button
                className="btn"
                type="button"
                aria-label="Cari"
                onClick={() => applySearch(searchDraft.trim())}
              >
                <SearchIcon />
                <span className="btn-label">Cari</span>
              </button>
            </div>
          </div>
        </div>
        <div className="backup-table-wrap">
          <table className="backup-table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Aksi</th>
                <th>Jenis</th>
                <th>Data</th>
                <th>Pengguna</th>
                <th>Isi</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td className="backup-empty" colSpan={6}>
                    {backupsQuery.isSuccess
                      ? search
                        ? "Tidak ada data yang cocok."
                        : "Belum ada backup."
                      : "Memuat…"}
                  </td>
                </tr>
              ) : (
                pageRows.map((item) => {
                  const open = openId === item.id;
                  const fields = snapshotFields(item);
                  return (
                    <Fragment key={item.id}>
                      <tr className={open ? "is-selected" : undefined}>
                        <td>{formatWhen(item.at)}</td>
                        <td className={item.action === "delete" ? "is-over" : undefined}>
                          {actionLabel(item.action)}
                        </td>
                        <td>{entityLabel(item.entity)}</td>
                        <td>{dataLabel(item.summary)}</td>
                        <td>
                          <div className="backup-user">
                            {item.user_name || "—"}
                            {item.user_level && item.user_level !== item.user_name ? (
                              <small>{item.user_level}</small>
                            ) : null}
                          </div>
                        </td>
                        <td className="col-act">
                          <button
                            className="btn btn-sm"
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : item.id)}
                          >
                            {open ? "Tutup" : "Lihat"}
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="backup-detail">
                          <td colSpan={6}>
                            {fields.length === 0 ? (
                              "Tidak ada isi data."
                            ) : (
                              <dl className="backup-fields">
                                {fields.map((field) => (
                                  <div key={field.label}>
                                    <dt>{field.label}</dt>
                                    <dd>{field.value}</dd>
                                  </div>
                                ))}
                                {item.undone !== "1" ? (
                                  <div className="backup-detail-actions">
                                    <button
                                      className="btn btn-danger btn-sm"
                                      type="button"
                                      onClick={() =>
                                        setUndoAlert({ phase: "confirm", row: item })
                                      }
                                    >
                                      Undo
                                    </button>
                                  </div>
                                ) : null}
                              </dl>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager page={currentPage} totalPages={totalPages} onChange={showPage} />
        <label className="backup-foot">
          <input
            type="checkbox"
            checked={includeUndone}
            disabled={backupsQuery.isFetching}
            onChange={(event) => {
              setIncludeUndone(event.target.checked);
              setPage(1);
              setOpenId(null);
            }}
          />
          Tampilkan yang sudah di-undo
        </label>
      </section>
      {undoAlert ? (
        <div
          className="modal-backdrop manage-dialog"
          onClick={
            undoAlert.phase === "loading"
              ? undefined
              : () => setUndoAlert(null)
          }
        >
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="undo-alert-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="undo-alert-title">
              {undoAlert.phase === "success"
                ? "Undo berhasil"
                : undoAlert.phase === "error"
                  ? "Undo gagal"
                  : "Undo perubahan"}
            </h3>
            {undoAlert.phase === "loading" ? (
              <div className="process-alert-loading" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                <p style={{ margin: 0, textAlign: "center" }}>
                  Mengembalikan data {dataLabel(undoAlert.row.summary)}…
                </p>
                <span className="step-hint">Mohon tunggu...</span>
              </div>
            ) : undoAlert.phase === "confirm" ? (
              <>
                <p style={{ color: "var(--muted)", marginTop: 0 }}>
                  {formatWhen(undoAlert.row.at)} · {actionLabel(undoAlert.row.action)} ·{" "}
                  {dataLabel(undoAlert.row.summary)}
                </p>
                <p style={{ margin: "0 0 16px" }}>
                  Data akan dikembalikan ke kondisi sebelum perubahan ini. Lanjutkan undo?
                </p>
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setUndoAlert(null)}
                  >
                    Batal
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => void undoRow(undoAlert.row)}
                  >
                    Undo
                  </button>
                </div>
              </>
            ) : (
              <>
                <p
                  style={{
                    margin: "0 0 16px",
                    whiteSpace: "pre-line",
                    color:
                      undoAlert.phase === "error" ? "var(--red)" : "var(--green)",
                  }}
                >
                  {undoAlert.message}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setUndoAlert(null)}
                  >
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function getPagerItems(current: number, total: number): Array<number | "…"> {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1);
  const items: Array<number | "…"> = [];
  const pushUnique = (item: number | "…") => {
    if (items[items.length - 1] !== item) items.push(item);
  };
  if (current <= 3) {
    for (let i = 1; i <= 4; i++) pushUnique(i);
    pushUnique("…");
    pushUnique(total);
  } else if (current >= total - 2) {
    pushUnique(1);
    pushUnique("…");
    for (let i = total - 3; i <= total; i++) pushUnique(i);
  } else {
    pushUnique(1);
    pushUnique("…");
    pushUnique(current);
    pushUnique("…");
    pushUnique(total);
  }
  return items;
}

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const items = getPagerItems(page, totalPages);
  return (
    <nav className="pager" aria-label="Halaman backup">
      <button
        className="btn pager-nav"
        type="button"
        disabled={page <= 1}
        aria-label="Halaman sebelumnya"
        onClick={() => onChange(page - 1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div className="pager-pages">
        {items.map((item, index) =>
          item === "…" ? (
            <span key={`ellipsis-${index}`} className="pager-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              className={item === page ? "btn pager-page is-active" : "btn pager-page"}
              type="button"
              aria-label={`Halaman ${item}`}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onChange(item)}
            >
              {item}
            </button>
          )
        )}
      </div>
      <button
        className="btn pager-nav"
        type="button"
        disabled={page >= totalPages}
        aria-label="Halaman berikutnya"
        onClick={() => onChange(page + 1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </nav>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}
