"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DashboardData,
  JobWithDetails,
  Technician,
  TechnicianStatus,
} from "@/lib/types";
import { calcElapsedSec, calcStepElapsedSec, formatDuration } from "@/lib/duration";

type Modal =
  | null
  | { type: "create" }
  | { type: "edit"; job: JobWithDetails }
  | { type: "assign"; job: JobWithDetails };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="pill">
      <span className={`dot ${status}`} />
      {status.replace("_", " ")}
    </span>
  );
}

function LiveTimer({ job }: { job: JobWithDetails }) {
  const [sec, setSec] = useState(() => calcElapsedSec(job));
  useEffect(() => {
    setSec(calcElapsedSec(job));
    if (!["in_progress", "paused"].includes(job.status)) return;
    const id = setInterval(() => setSec(calcElapsedSec(job)), 1000);
    return () => clearInterval(id);
  }, [job]);
  return <div className="timer">{formatDuration(sec)}</div>;
}

function StepDuration({ step, running }: { step: JobWithDetails["steps"][0]; running: boolean }) {
  const [sec, setSec] = useState(() => calcStepElapsedSec(step));
  useEffect(() => {
    setSec(calcStepElapsedSec(step));
    if (!running || step.status !== "in_progress") return;
    const id = setInterval(() => setSec(calcStepElapsedSec(step)), 1000);
    return () => clearInterval(id);
  }, [step, running]);
  if (step.status === "pending") return <span style={{ color: "var(--muted)" }}>—</span>;
  return <span>{formatDuration(sec)}</span>;
}

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const [form, setForm] = useState({
    title: "",
    unit: "",
    description: "",
    estimated_minutes: "90",
    steps: "Diagnosis\nPerbaikan\nTest & QC",
  });
  const [assignTechIds, setAssignTechIds] = useState<string[]>([]);
  const [assignSearch, setAssignSearch] = useState("");

  function emptyForm() {
    return {
      title: "",
      unit: "",
      description: "",
      estimated_minutes: "90",
      steps: "Diagnosis\nPerbaikan\nTest & QC",
    };
  }

  function openCreate() {
    setForm(emptyForm());
    setModal({ type: "create" });
  }

  function openEdit(job: JobWithDetails) {
    setForm({
      title: job.title,
      unit: job.unit,
      description: job.description,
      estimated_minutes: String(job.estimated_minutes || 60),
      steps: job.steps.map((s) => s.name).join("\n"),
    });
    setModal({ type: "edit", job });
  }

  function parseSteps(text: string): string[] {
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const load = useCallback(async () => {
    try {
      const d = await api<DashboardData>("/api/dashboard");
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as "light" | "dark") ||
      "dark";
    setTheme(current);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("tus-theme", next);
    } catch {
      /* ignore */
    }
  }

  const availableTechs = useMemo(
    () => data?.technicians.filter((t) => t.status === "available") || [],
    [data]
  );

  const techGroups = useMemo(() => {
    const groups: Record<TechnicianStatus, Technician[]> = {
      available: [],
      busy: [],
      offline: [],
    };
    data?.technicians.forEach((t) => groups[t.status].push(t));
    return groups;
  }, [data]);

  const activeJobs = useMemo(
    () =>
      (data?.jobs || []).filter((j) =>
        ["in_progress", "paused", "assigned"].includes(j.status)
      ),
    [data]
  );
  const queuedJobs = useMemo(
    () => (data?.jobs || []).filter((j) => j.status === "queued"),
    [data]
  );
  const historyJobs = useMemo(
    () =>
      (data?.jobs || []).filter((j) => ["done", "cancelled"].includes(j.status)),
    [data]
  );

  async function runAction(
    jobId: string,
    action: string,
    payload?: Record<string, unknown>
  ) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/jobs/${jobId}/action`, {
        method: "POST",
        body: JSON.stringify({ action, ...payload }),
      });
      await load();
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aksi gagal");
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {
    setBusy(true);
    setError("");
    try {
      await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          unit: form.unit,
          description: form.description,
          estimated_minutes: Number(form.estimated_minutes) || 60,
          steps: parseSteps(form.steps),
        }),
      });
      setForm(emptyForm());
      setModal(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal buat job");
    } finally {
      setBusy(false);
    }
  }

  async function saveEditJob() {
    if (modal?.type !== "edit") return;
    setBusy(true);
    setError("");
    try {
      const canEditSteps = ["queued", "assigned"].includes(modal.job.status);
      await api(`/api/jobs/${modal.job.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.title,
          unit: form.unit,
          description: form.description,
          estimated_minutes: Number(form.estimated_minutes) || 60,
          steps: canEditSteps ? parseSteps(form.steps) : undefined,
        }),
      });
      setModal(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal update job");
    } finally {
      setBusy(false);
    }
  }

  async function removeJob(job: JobWithDetails) {
    if (!confirm(`Hapus job "${job.title}" permanen dari Excel?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus job");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTech(tech: Technician) {
    if (tech.status === "busy") return;
    const next: TechnicianStatus =
      tech.status === "available" ? "offline" : "available";
    setBusy(true);
    try {
      await api(`/api/technicians/${tech.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal update teknisi");
    } finally {
      setBusy(false);
    }
  }

  function renderJob(job: JobWithDetails) {
    const jobMap = Object.fromEntries((data?.jobs || []).map((j) => [j.id, j]));
    return (
      <article className="job" key={job.id}>
        <div className="job-head">
          <div>
            <div className="job-title">{job.title}</div>
            <div className="job-unit">
              {job.unit}
            </div>
            <div className="tech-names">
              {job.technicians?.length
                ? job.technicians.map((t) => t.name).join(", ")
                : job.technician?.name || "Belum diassign"}
              {job.technicians?.length > 1 ? ` (${job.technicians.length} teknisi)` : ""}
            </div>
            <div style={{ marginTop: 6 }}>
              <StatusPill status={job.status} />
              <span style={{ color: "var(--muted)", marginLeft: 10, fontSize: "0.85rem" }}>
                Est. {job.estimated_minutes} mnt · Progress {job.progress_pct}%
              </span>
            </div>
          </div>
          {["in_progress", "paused", "done"].includes(job.status) && (
            <LiveTimer job={jobMap[job.id] || job} />
          )}
        </div>

        {job.description && (
          <p style={{ color: "var(--muted)", margin: "10px 0 0", fontSize: "0.92rem" }}>
            {job.description}
          </p>
        )}

        <div className="progress">
          <span style={{ width: `${job.progress_pct}%` }} />
        </div>

        <ul className="steps">
          {job.steps.map((s) => (
            <li key={s.id}>
              <span className={`mark ${s.status}`} />
              <span>
                {s.order}. {s.name}
                {s.status === "in_progress" ? " (aktif)" : ""}
              </span>
              <StepDuration step={s} running={job.status === "in_progress"} />
            </li>
          ))}
        </ul>

        <div className="actions">
          {(job.status === "queued" || job.status === "assigned") && (
            <button
              className="btn btn-primary"
              disabled={busy || (job.status === "queued" && availableTechs.length === 0)}
              onClick={() => {
                const preselected =
                  job.technicians?.map((t) => t.id) ||
                  (job.technician_id ? [job.technician_id] : []);
                setAssignTechIds(
                  preselected.length
                    ? preselected
                    : availableTechs[0]
                      ? [availableTechs[0].id]
                      : []
                );
                setAssignSearch("");
                setModal({ type: "assign", job });
              }}
            >
              {job.status === "assigned" ? "Ubah teknisi" : "Assign teknisi"}
            </button>
          )}
          {job.status === "assigned" && (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => runAction(job.id, "start")}
            >
              Start job
            </button>
          )}
          {job.status === "in_progress" && (
            <>
              <button
                className="btn"
                disabled={busy || !job.current_step}
                onClick={() => runAction(job.id, "complete_step")}
              >
                Selesai step
              </button>
              <button className="btn" disabled={busy} onClick={() => runAction(job.id, "pause")}>
                Pause
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => runAction(job.id, "complete")}
              >
                Complete job
              </button>
            </>
          )}
          {job.status === "paused" && (
            <>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => runAction(job.id, "resume")}
              >
                Resume
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => runAction(job.id, "complete")}
              >
                Complete job
              </button>
            </>
          )}
          {!["done", "cancelled"].includes(job.status) && (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => runAction(job.id, "cancel")}
            >
              Cancel
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => openEdit(job)}>
            Edit
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => removeJob(job)}
          >
            Hapus
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="brand">
            PRIMA
            <span>Progress Report &amp; Inspection for Mechanic Allocation</span>
          </div>
        </div>
        <div className="top-actions">
          <button
            className="btn btn-icon"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
              </svg>
            )}
          </button>
          <button className="btn" disabled={busy} onClick={load}>
            Refresh
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={openCreate}>
            + Job baru
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {loading || !data ? (
        <p style={{ color: "var(--muted)" }}>Memuat data dari Excel...</p>
      ) : (
        <>
          <section className="summary">
            <div className="stat">
              <div className="label">Available</div>
              <div className="value" style={{ color: "var(--green)" }}>
                {data.summary.available}
              </div>
            </div>
            <div className="stat">
              <div className="label">Busy</div>
              <div className="value" style={{ color: "var(--amber)" }}>
                {data.summary.busy}
              </div>
            </div>
            <div className="stat">
              <div className="label">Job aktif</div>
              <div className="value">{data.summary.active_jobs}</div>
            </div>
            <div className="stat">
              <div className="label">Antrian</div>
              <div className="value">{data.summary.queued_jobs}</div>
            </div>
            <div className="stat">
              <div className="label">Selesai hari ini</div>
              <div className="value">{data.summary.done_today}</div>
            </div>
          </section>

          <div className="grid">
            <section className="panel">
              <h2>Teknisi</h2>
              <div className="tech-cols">
                {(["available", "busy", "offline"] as TechnicianStatus[]).map((status) => (
                  <div className="tech-col" key={status}>
                    <h3>
                      {status} ({techGroups[status].length})
                    </h3>
                    {techGroups[status].map((t) => {
                      const job = data.jobs.find((j) => j.id === t.current_job_id);
                      return (
                        <div className="tech" key={t.id}>
                          <div className="name">{t.name}</div>
                          <div className="meta">
                            {t.skill}
                            {job ? ` · ${job.title}` : ""}
                          </div>
                          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                            <StatusPill status={t.status} />
                            {t.status !== "busy" && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                                disabled={busy}
                                onClick={() => toggleTech(t)}
                              >
                                {t.status === "available" ? "Set offline" : "Set available"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {techGroups[status].length === 0 && (
                      <div className="meta">Tidak ada</div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>Job aktif & progress</h2>
              {activeJobs.length === 0 && (
                <p style={{ color: "var(--muted)" }}>Tidak ada job aktif.</p>
              )}
              {activeJobs.map(renderJob)}

              <h2 style={{ marginTop: 22 }}>Antrian</h2>
              {queuedJobs.length === 0 && (
                <p style={{ color: "var(--muted)" }}>Antrian kosong.</p>
              )}
              {queuedJobs.map(renderJob)}

              {historyJobs.length > 0 && (
                <>
                  <h2 style={{ marginTop: 22 }}>Riwayat</h2>
                  {historyJobs.map(renderJob)}
                </>
              )}
            </section>
          </div>

          <p className="db-path">
            Database Excel: <code>data/workshop.xlsx</code> (sheet Technicians, Jobs, JobSteps, JobEvents)
          </p>
        </>
      )}

      {(modal?.type === "create" || modal?.type === "edit") && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.type === "create" ? "Job baru" : "Edit job"}</h3>
            <div className="form">
              <label>
                Judul
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Mis. Ganti oli mesin"
                />
              </label>
              <label>
                Unit / kendaraan
                <input
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="Mis. Avanza B 1234 ABC"
                />
              </label>
              <label>
                Deskripsi
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label>
                Estimasi (menit)
                <input
                  type="number"
                  value={form.estimated_minutes}
                  onChange={(e) =>
                    setForm({ ...form, estimated_minutes: e.target.value })
                  }
                />
              </label>
              {(modal.type === "create" ||
                ["queued", "assigned"].includes(modal.job.status)) && (
                <label>
                  Tahapan (satu baris per step)
                  <textarea
                    rows={4}
                    value={form.steps}
                    onChange={(e) => setForm({ ...form, steps: e.target.value })}
                    placeholder={"Diagnosis\nPerbaikan\nTest & QC"}
                  />
                </label>
              )}
              {modal.type === "edit" &&
                !["queued", "assigned"].includes(modal.job.status) && (
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                    Tahapan tidak bisa diubah karena job sudah berjalan.
                  </p>
                )}
              <div className="actions">
                <button className="btn" onClick={() => setModal(null)}>
                  Batal
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !form.title || !form.unit}
                  onClick={modal.type === "create" ? createJob : saveEditJob}
                >
                  {modal.type === "create" ? "Simpan" : "Update"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "assign" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Assign teknisi</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — pilih satu atau lebih
            </p>
            <div className="form">
              <label>
                Cari teknisi
                <input
                  type="search"
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Nama atau skill..."
                  autoFocus
                />
              </label>
              <div className="check-list">
                {(() => {
                  const q = assignSearch.trim().toLowerCase();
                  const selectable =
                    data?.technicians.filter(
                      (t) =>
                        (t.status === "available" ||
                          t.current_job_id === modal.job.id ||
                          assignTechIds.includes(t.id)) &&
                        (!q ||
                          t.name.toLowerCase().includes(q) ||
                          t.skill.toLowerCase().includes(q))
                    ) || [];
                  if (selectable.length === 0) {
                    return (
                      <span style={{ color: "var(--muted)" }}>
                        {q
                          ? "Tidak ada teknisi yang cocok"
                          : "Tidak ada teknisi available"}
                      </span>
                    );
                  }
                  return selectable.map((t) => {
                    const checked = assignTechIds.includes(t.id);
                    return (
                      <label className="check-item" key={t.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setAssignTechIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id]
                            );
                          }}
                        />
                        <span>
                          {t.name}
                          <span style={{ color: "var(--muted)" }}> — {t.skill}</span>
                          {t.id === assignTechIds[0] ? " · lead" : ""}
                        </span>
                      </label>
                    );
                  });
                })()}
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                Teknisi pertama yang dicentang menjadi lead. Dipilih: {assignTechIds.length}
              </p>
              <div className="actions">
                <button className="btn" onClick={() => setModal(null)}>
                  Batal
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || assignTechIds.length === 0}
                  onClick={() =>
                    runAction(modal.job.id, "assign", {
                      technician_ids: assignTechIds,
                    })
                  }
                >
                  Assign ({assignTechIds.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
