"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DashboardData,
  JobWithDetails,
  Technician,
  TechnicianStatus,
  Unit,
} from "@/lib/types";
import { calcElapsedSec, calcStepElapsedSec, formatDuration } from "@/lib/duration";
import { useAssignStore } from "@/store/assignStore";
import { useJobFormStore } from "@/store/jobFormStore";
import { useTechnicianBoardStore } from "@/store/technicianBoardStore";
import { useJobBoardStore } from "@/store/jobBoardStore";

type Modal =
  | null
  | { type: "create" }
  | { type: "edit"; job: JobWithDetails }
  | { type: "assign"; job: JobWithDetails }
  | {
      type: "tech-status";
      tech: Technician;
      nextStatus: Exclude<TechnicianStatus, "busy">;
    }
  | { type: "cancel-job"; job: JobWithDetails }
  | { type: "delete-job"; job: JobWithDetails }
  | { type: "confirm-assign"; job: JobWithDetails; techIds: string[] }
  | { type: "units" }
  | {
      type: "unit-form";
      mode: "create" | "edit";
      unit?: Unit;
    }
  | { type: "delete-unit"; unit: Unit };

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
  const [unitForm, setUnitForm] = useState({ code: "", name: "", active: "1" });

  function openUnitCreate() {
    setUnitForm({ code: "", name: "", active: "1" });
    setModal({ type: "unit-form", mode: "create" });
  }

  function openUnitEdit(unit: Unit) {
    setUnitForm({ code: unit.code, name: unit.name, active: unit.active });
    setModal({ type: "unit-form", mode: "edit", unit });
  }

  async function saveUnit() {
    if (modal?.type !== "unit-form") return;
    setBusy(true);
    setError("");
    try {
      if (modal.mode === "create") {
        await api("/api/units", {
          method: "POST",
          body: JSON.stringify({ code: unitForm.code, name: unitForm.name }),
        });
      } else if (modal.unit) {
        await api(`/api/units/${modal.unit.id}`, {
          method: "PATCH",
          body: JSON.stringify(unitForm),
        });
      }
      setModal({ type: "units" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan unit");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteUnit() {
    if (modal?.type !== "delete-unit") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/units/${modal.unit.id}`, { method: "DELETE" });
      setModal({ type: "units" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus unit");
    } finally {
      setBusy(false);
    }
  }

  const form = useJobFormStore((s) => s.form);
  const setForm = useJobFormStore((s) => s.setForm);
  const resetForm = useJobFormStore((s) => s.resetForm);
  const loadForm = useJobFormStore((s) => s.loadForm);

  const assignTechIds = useAssignStore((s) => s.techIds);
  const assignDraft = useAssignStore((s) => s.draft);
  const assignQuery = useAssignStore((s) => s.query);
  const openAssignStore = useAssignStore((s) => s.openForJob);
  const setAssignDraft = useAssignStore((s) => s.setDraft);
  const applyAssignSearch = useAssignStore((s) => s.applySearch);
  const clearAssignSearch = useAssignStore((s) => s.clearSearch);
  const toggleAssignTech = useAssignStore((s) => s.toggleTech);
  const resetAssign = useAssignStore((s) => s.reset);

  const techDraft = useTechnicianBoardStore((s) => s.draft);
  const techQuery = useTechnicianBoardStore((s) => s.query);
  const setTechDraft = useTechnicianBoardStore((s) => s.setDraft);
  const applyTechSearch = useTechnicianBoardStore((s) => s.applySearch);
  const clearTechSearch = useTechnicianBoardStore((s) => s.clearSearch);

  const jobDraft = useJobBoardStore((s) => s.draft);
  const jobQuery = useJobBoardStore((s) => s.query);
  const setJobDraft = useJobBoardStore((s) => s.setDraft);
  const applyJobSearch = useJobBoardStore((s) => s.applySearch);
  const clearJobSearch = useJobBoardStore((s) => s.clearSearch);

  function openCreate() {
    resetForm();
    setModal({ type: "create" });
  }

  function openEdit(job: JobWithDetails) {
    loadForm({
      title: job.title,
      unit_id: job.unit_id || "",
      description: job.description,
      estimated_minutes: String(job.estimated_minutes || 60),
      steps: job.steps.map((s) => s.name).join("\n"),
    });
    setModal({ type: "edit", job });
  }

  function openAssign(job: JobWithDetails) {
    const existing =
      job.technicians?.map((t) => t.id) ||
      (job.technician_id ? [job.technician_id] : []);
    openAssignStore(job.id, existing);
    setModal({ type: "assign", job });
  }

  function closeModal() {
    resetAssign();
    setModal(null);
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
    const q = techQuery.toLowerCase();
    data?.technicians.forEach((t) => {
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !t.skill.toLowerCase().includes(q)
      ) {
        return;
      }
      groups[t.status].push(t);
    });
    return groups;
  }, [data, techQuery]);

  const matchJob = useCallback(
    (j: JobWithDetails) => {
      const q = jobQuery.toLowerCase();
      if (!q) return true;
      const techNames = (j.technicians || [])
        .map((t) => t.name)
        .join(" ")
        .toLowerCase();
      return (
        j.title.toLowerCase().includes(q) ||
        j.unit.toLowerCase().includes(q) ||
        j.description.toLowerCase().includes(q) ||
        j.status.toLowerCase().includes(q) ||
        techNames.includes(q) ||
        (j.technician?.name || "").toLowerCase().includes(q)
      );
    },
    [jobQuery]
  );

  const activeJobs = useMemo(
    () =>
      (data?.jobs || []).filter(
        (j) =>
          ["in_progress", "paused", "assigned"].includes(j.status) && matchJob(j)
      ),
    [data, matchJob]
  );
  const queuedJobs = useMemo(
    () =>
      (data?.jobs || []).filter((j) => j.status === "queued" && matchJob(j)),
    [data, matchJob]
  );
  const historyJobs = useMemo(
    () =>
      (data?.jobs || []).filter(
        (j) => ["done", "cancelled"].includes(j.status) && matchJob(j)
      ),
    [data, matchJob]
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
      closeModal();
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
          unit_id: form.unit_id,
          description: form.description,
          estimated_minutes: Number(form.estimated_minutes) || 60,
          steps: parseSteps(form.steps),
        }),
      });
      resetForm();
      closeModal();
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
          unit_id: form.unit_id,
          description: form.description,
          estimated_minutes: Number(form.estimated_minutes) || 60,
          steps: canEditSteps ? parseSteps(form.steps) : undefined,
        }),
      });
      closeModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal update job");
    } finally {
      setBusy(false);
    }
  }

  async function removeJob() {
    if (modal?.type !== "delete-job") return;
    const job = modal.job;
    setBusy(true);
    setError("");
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      closeModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus job");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancelJob() {
    if (modal?.type !== "cancel-job") return;
    await runAction(modal.job.id, "cancel");
  }

  async function confirmTechStatus() {
    if (modal?.type !== "tech-status") return;
    const { tech, nextStatus } = modal;
    setBusy(true);
    setError("");
    try {
      await api(`/api/technicians/${tech.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      closeModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal update teknisi");
    } finally {
      setBusy(false);
    }
  }

  function openTechStatusModal(tech: Technician) {
    if (tech.status === "busy") return;
    const nextStatus: Exclude<TechnicianStatus, "busy"> =
      tech.status === "available" ? "offline" : "available";
    setModal({ type: "tech-status", tech, nextStatus });
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
              onClick={() => openAssign(job)}
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
              onClick={() => setModal({ type: "cancel-job", job })}
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
            onClick={() => setModal({ type: "delete-job", job })}
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
          <button
            className="btn"
            disabled={busy}
            onClick={() => setModal({ type: "units" })}
          >
            Master Unit
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
          <div className="summary-wrap">
            <section className="summary-group">
              <h3 className="summary-title">Teknisi</h3>
              <div className="summary">
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
                  <div className="label">Offline</div>
                  <div className="value" style={{ color: "var(--steel)" }}>
                    {data.summary.offline}
                  </div>
                </div>
              </div>
            </section>
            <section className="summary-group">
              <h3 className="summary-title">Job</h3>
              <div className="summary">
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
              </div>
            </section>
          </div>

          <div className="grid">
            <section className="panel">
              <div className="panel-head">
                <h2>Teknisi</h2>
                <div className="panel-search-row">
                  <input
                    className="panel-search"
                    type="search"
                    value={techDraft}
                    onChange={(e) => setTechDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyTechSearch();
                      }
                    }}
                    placeholder="Cari nama atau skill..."
                    aria-label="Cari teknisi"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={applyTechSearch}
                  >
                    Cari
                  </button>
                  {techQuery && (
                    <button
                      type="button"
                      className="btn"
                      onClick={clearTechSearch}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
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
                                onClick={() => openTechStatusModal(t)}
                              >
                                {t.status === "available" ? "Set offline" : "Set available"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {techGroups[status].length === 0 && (
                      <div className="meta">
                        {techQuery ? "Tidak cocok" : "Tidak ada"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Job aktif & progress</h2>
                <div className="panel-search-row">
                  <input
                    className="panel-search"
                    type="search"
                    value={jobDraft}
                    onChange={(e) => setJobDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyJobSearch();
                      }
                    }}
                    placeholder="Cari job, unit, teknisi..."
                    aria-label="Cari job"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={applyJobSearch}
                  >
                    Cari
                  </button>
                  {jobQuery && (
                    <button
                      type="button"
                      className="btn"
                      onClick={clearJobSearch}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              {activeJobs.length === 0 && (
                <p style={{ color: "var(--muted)" }}>
                  {jobQuery ? "Tidak ada job aktif yang cocok." : "Tidak ada job aktif."}
                </p>
              )}
              {activeJobs.map(renderJob)}

              <h2 style={{ marginTop: 22 }}>Antrian</h2>
              {queuedJobs.length === 0 && (
                <p style={{ color: "var(--muted)" }}>
                  {jobQuery ? "Tidak ada antrian yang cocok." : "Antrian kosong."}
                </p>
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
            Database Excel: <code>data/workshop.xlsx</code> (sheet Technicians, Units, Jobs, JobSteps, JobEvents)
          </p>
        </>
      )}

      {(modal?.type === "create" || modal?.type === "edit") && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.type === "create" ? "Job baru" : "Edit job"}</h3>
            <div className="form">
              <label>
                Judul
                <input
                  value={form.title}
                  onChange={(e) => setForm({ title: e.target.value })}
                  placeholder="Mis. Ganti oli mesin"
                />
              </label>
              <label>
                Unit / kendaraan
                <select
                  value={form.unit_id}
                  onChange={(e) => setForm({ unit_id: e.target.value })}
                >
                  <option value="">— Pilih unit —</option>
                  {(data?.units || [])
                    .filter(
                      (u) =>
                        u.active === "1" ||
                        (modal.type === "edit" && u.id === form.unit_id)
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} — {u.name}
                        {u.active !== "1" ? " (nonaktif)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Deskripsi
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ description: e.target.value })}
                />
              </label>
              <label>
                Estimasi (menit)
                <input
                  type="number"
                  value={form.estimated_minutes}
                  onChange={(e) =>
                    setForm({ estimated_minutes: e.target.value })
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
                    onChange={(e) => setForm({ steps: e.target.value })}
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
                <button className="btn" onClick={closeModal}>
                  Batal
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !form.title || !form.unit_id}
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
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Assign teknisi</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — pilih satu atau lebih
            </p>
            <div className="form">
              <label>
                Cari teknisi
                <div className="panel-search-row" style={{ justifyContent: "stretch", marginTop: 4 }}>
                  <input
                    className="panel-search"
                    style={{ maxWidth: "none" }}
                    type="search"
                    value={assignDraft}
                    onChange={(e) => setAssignDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyAssignSearch();
                      }
                    }}
                    placeholder="Nama atau skill..."
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={applyAssignSearch}
                  >
                    Cari
                  </button>
                  {assignQuery && (
                    <button
                      type="button"
                      className="btn"
                      onClick={clearAssignSearch}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </label>
              <div className="check-list">
                {(() => {
                  const q = assignQuery.toLowerCase();
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
                          onChange={() => toggleAssignTech(t.id)}
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
                <button className="btn" onClick={closeModal}>
                  Batal
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || assignTechIds.length === 0}
                  onClick={() =>
                    setModal({
                      type: "confirm-assign",
                      job: modal.job,
                      techIds: [...assignTechIds],
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

      {modal?.type === "tech-status" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ubah status teknisi</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.tech.name} — {modal.tech.skill}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Ubah status dari{" "}
              <strong>{modal.tech.status}</strong> menjadi{" "}
              <strong>{modal.nextStatus}</strong>?
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={confirmTechStatus}
              >
                Ya, set {modal.nextStatus}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "confirm-assign" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "assign", job: modal.job })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Konfirmasi assign</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              Assign {modal.techIds.length} teknisi ke job ini?
            </p>
            <ul style={{ margin: "0 0 16px", paddingLeft: 18, color: "var(--muted)" }}>
              {modal.techIds.map((id, index) => {
                const tech = data?.technicians.find((t) => t.id === id);
                return (
                  <li key={id}>
                    {tech?.name || id}
                    {tech?.skill ? ` — ${tech.skill}` : ""}
                    {index === 0 ? " · lead" : ""}
                  </li>
                );
              })}
            </ul>
            <div className="actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => setModal({ type: "assign", job: modal.job })}
              >
                Kembali
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  runAction(modal.job.id, "assign", {
                    technician_ids: modal.techIds,
                  })
                }
              >
                Ya, assign ({modal.techIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "cancel-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Cancel job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Batalkan job ini? Status menjadi <strong>cancelled</strong>.
              Teknisi yang terpasang akan dilepas.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmCancelJob}
              >
                Ya, cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Hapus job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus job ini <strong>permanen</strong> dari Excel? Tindakan ini
              tidak bisa dibatalkan.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={removeJob}
              >
                Ya, hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "units" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" style={{ width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3>Master Unit</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Data unit dipilih saat buat/edit job (tidak ketik manual).
            </p>
            <div className="check-list" style={{ maxHeight: 280, marginBottom: 12 }}>
              {(data?.units || []).length === 0 && (
                <span style={{ color: "var(--muted)" }}>Belum ada unit.</span>
              )}
              {(data?.units || []).map((u) => (
                <div
                  key={u.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom: "1px dashed var(--line-dashed)",
                  }}
                >
                  <div>
                    <strong>{u.code}</strong>
                    <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                      {u.name}
                      {u.active !== "1" ? " · nonaktif" : ""}
                    </div>
                  </div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy}
                      onClick={() => openUnitEdit(u)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy}
                      onClick={() => setModal({ type: "delete-unit", unit: u })}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={openUnitCreate}>
                + Unit baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "unit-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "units" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.mode === "create" ? "Unit baru" : "Edit unit"}</h3>
            <div className="form">
              <label>
                Kode
                <input
                  value={unitForm.code}
                  onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value })}
                  placeholder="Mis. E448"
                />
              </label>
              <label>
                Nama
                <input
                  value={unitForm.name}
                  onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                  placeholder="Mis. GOH Unit Rental"
                />
              </label>
              {modal.mode === "edit" && (
                <label>
                  Status
                  <select
                    value={unitForm.active}
                    onChange={(e) =>
                      setUnitForm({ ...unitForm, active: e.target.value })
                    }
                  >
                    <option value="1">Aktif</option>
                    <option value="0">Nonaktif</option>
                  </select>
                </label>
              )}
              <div className="actions">
                <button className="btn" onClick={() => setModal({ type: "units" })}>
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !unitForm.code || !unitForm.name}
                  onClick={saveUnit}
                >
                  Simpan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-unit" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "units" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Hapus unit</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.unit.code} — {modal.unit.name}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus unit ini permanen? Jika masih dipakai job, penghapusan
              akan ditolak — nonaktifkan lewat Edit jika perlu.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setModal({ type: "units" })}>
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteUnit}
              >
                Ya, hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
