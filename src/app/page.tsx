"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import type {
  AppUserPublic,
  Attendance,
  AttendanceStatus,
  DashboardData,
  JobWithDetails,
  Technician,
  TechnicianStatus,
  Unit,
  UserLevel,
} from "@/lib/types";
import { USER_LEVELS } from "@/lib/types";
import {
  canAccess,
  canAssignJob,
  canManageJobProgress,
} from "@/lib/permissions";
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
  | { type: "pause-job"; job: JobWithDetails }
  | { type: "resume-job"; job: JobWithDetails }
  | { type: "complete-step"; job: JobWithDetails }
  | { type: "complete-job"; job: JobWithDetails }
  | { type: "confirm-assign"; job: JobWithDetails; techIds: string[] }
  | { type: "units" }
  | {
      type: "unit-form";
      mode: "create" | "edit";
      unit?: Unit;
    }
  | { type: "delete-unit"; unit: Unit }
  | { type: "techs" }
  | {
      type: "tech-form";
      mode: "create" | "edit";
      tech?: Technician;
    }
  | { type: "delete-tech"; tech: Technician }
  | { type: "attendance" }
  | {
      type: "attendance-form";
      mode: "create" | "edit";
      row?: Attendance;
    }
  | { type: "delete-attendance"; row: Attendance }
  | { type: "users" }
  | {
      type: "user-form";
      mode: "create" | "edit";
      user?: AppUserPublic;
    }
  | { type: "delete-user"; user: AppUserPublic }
  | { type: "change-password" }
  | { type: "logout" }
  | { type: "settings" };

const HIDE_TECH_PANEL_KEY = "tus-hide-tech-panel";
const HIDE_JOB_PANEL_KEY = "tus-hide-job-panel";

function readBoolFlag(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

function writeBoolFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  const isForm =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isForm && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
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

function PanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}

function BusyOverlay({ label = "Memproses..." }: { label?: string }) {
  return (
    <div className="modal-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function BusyLabel({
  busy,
  idle,
  pending = "Memproses...",
}: {
  busy: boolean;
  idle: string;
  pending?: string;
}) {
  if (!busy) return <>{idle}</>;
  return (
    <span className="btn-busy">
      <span className="spinner spinner--sm" aria-hidden="true" />
      {pending}
    </span>
  );
}

/** Build page list like: 1 2 3 … 100 or 1 … 4 5 6 … 100 */
function getPagerItems(current: number, total: number): Array<number | "…"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: Array<number | "…"> = [];
  const pushUnique = (n: number | "…") => {
    if (items[items.length - 1] !== n) items.push(n);
  };

  pushUnique(1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pushUnique("…");
  for (let i = start; i <= end; i++) pushUnique(i);
  if (end < total - 1) pushUnique("…");
  pushUnique(total);
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
    <div className="pager">
      <button
        type="button"
        className="btn pager-nav"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Halaman sebelumnya"
        title="Prev"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div className="pager-pages">
        {items.map((item, idx) =>
          item === "…" ? (
            <span key={`e-${idx}`} className="pager-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`btn pager-page${item === page ? " is-active" : ""}`}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onChange(item)}
            >
              {item}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        className="btn pager-nav"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Halaman berikutnya"
        title="Next"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

export default function HomePage() {
  const { data: session, status: sessionStatus } = useSession();
  const isLoggedIn = sessionStatus === "authenticated";
  const userLevel = session?.user?.level || "guest";
  const canJobCreate = canAccess(userLevel, "job", "create");
  const canJobUpdate = canAccess(userLevel, "job", "update");
  const canJobDelete = canAccess(userLevel, "job", "delete");
  const canJobAssign = canAssignJob(userLevel);
  const canJobProgress = canManageJobProgress(userLevel);
  const canUserCreate = canAccess(userLevel, "user", "create");
  const canUserUpdate = canAccess(userLevel, "user", "update");
  const canUserDelete = canAccess(userLevel, "user", "delete");
  const canTechCreate = canAccess(userLevel, "technician", "create");
  const canTechUpdate = canAccess(userLevel, "technician", "update");
  const canTechDelete = canAccess(userLevel, "technician", "delete");
  const canUnitRead = canAccess(userLevel, "unit", "read");
  const canUnitCreate = canAccess(userLevel, "unit", "create");
  const canUnitUpdate = canAccess(userLevel, "unit", "update");
  const canUnitDelete = canAccess(userLevel, "unit", "delete");
  const canAttendanceCreate = canAccess(userLevel, "attendance", "create");
  const canAttendanceUpdate = canAccess(userLevel, "attendance", "update");
  const canAttendanceDelete = canAccess(userLevel, "attendance", "delete");
  const displayName = session?.user?.name || session?.user?.email || "";
  const displayNameShort = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return displayName;
    return parts.map((part) => part[0]?.toUpperCase() || "").join("");
  })();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [unitForm, setUnitForm] = useState({ code: "", name: "", active: "1" });
  const [unitDraft, setUnitDraft] = useState("");
  const [unitQuery, setUnitQuery] = useState("");
  const [unitImportMsg, setUnitImportMsg] = useState("");
  const [techForm, setTechForm] = useState({
    name: "",
    skill: "",
    phone: "",
    status: "available" as Exclude<TechnicianStatus, "busy">,
  });
  const [masterTechDraft, setMasterTechDraft] = useState("");
  const [masterTechQuery, setMasterTechQuery] = useState("");
  const [techImportMsg, setTechImportMsg] = useState("");
  const [appUsers, setAppUsers] = useState<AppUserPublic[]>([]);
  const [userForm, setUserForm] = useState({
    username: "",
    password: "",
    name: "",
    level: "teknisi" as UserLevel,
    active: "1",
  });
  const [masterUserDraft, setMasterUserDraft] = useState("");
  const [masterUserQuery, setMasterUserQuery] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordChangeMsg, setPasswordChangeMsg] = useState("");
  const [hideTechPanel, setHideTechPanel] = useState(false);
  const [hideJobPanel, setHideJobPanel] = useState(false);
  const topbarRef = useRef<HTMLElement>(null);
  const manageRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!manageOpen) return;
    function onDocClick(e: MouseEvent) {
      if (manageRef.current && !manageRef.current.contains(e.target as Node)) {
        setManageOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setManageOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [manageOpen]);

  useEffect(() => {
    if (!sessionOpen || mobileMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (sessionRef.current && !sessionRef.current.contains(e.target as Node)) {
        setSessionOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSessionOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [sessionOpen, mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) {
      setManageOpen(false);
      setSessionOpen(false);
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (modal) {
      setManageOpen(false);
      setSessionOpen(false);
    }
  }, [modal]);

  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const sync = () => {
      const bottom = Math.ceil(el.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty(
        "--topbar-offset",
        `${bottom + 8}px`
      );
      el.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync);
    };
  }, []);

  useEffect(() => {
    const open = modal != null;
    document.documentElement.classList.toggle("modal-open", open);
    const el = topbarRef.current;
    if (open && el) {
      const bottom = Math.ceil(el.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty(
        "--topbar-offset",
        `${bottom + 8}px`
      );
    }
    return () => {
      document.documentElement.classList.remove("modal-open");
    };
  }, [modal]);

  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", mobileMenuOpen);
    if (mobileMenuOpen && topbarRef.current) {
      const bottom = Math.ceil(topbarRef.current.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty(
        "--topbar-offset",
        `${bottom + 8}px`
      );
    }
    return () => {
      document.documentElement.classList.remove("menu-open");
    };
  }, [mobileMenuOpen]);

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

  async function importUnitsFile(file: File) {
    setBusy(true);
    setError("");
    setUnitImportMsg("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api<{
        imported: number;
        updated: number;
        skipped: string[];
      }>("/api/units/import", { method: "POST", body: formData });
      setUnitImportMsg(
        `Import OK: ${result.imported} baru, ${result.updated} diupdate` +
          (result.skipped.length
            ? ` · ${result.skipped.length} baris dilewati`
            : "")
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import unit gagal");
    } finally {
      setBusy(false);
    }
  }

  function openTechCreate() {
    setTechForm({ name: "", skill: "", phone: "", status: "available" });
    setModal({ type: "tech-form", mode: "create" });
  }

  function openTechEdit(tech: Technician) {
    setTechForm({
      name: tech.name,
      skill: tech.skill,
      phone: tech.phone || "",
      status: tech.status === "offline" ? "offline" : "available",
    });
    setModal({ type: "tech-form", mode: "edit", tech });
  }

  async function saveTech() {
    if (modal?.type !== "tech-form") return;
    if (!techForm.name.trim() || !techForm.skill.trim() || !techForm.phone.trim()) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: techForm.name,
        skill: techForm.skill,
        phone: techForm.phone,
        ...(modal.tech?.status === "busy" ? {} : { status: techForm.status }),
      };
      if (modal.mode === "create") {
        await api("/api/technicians", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (modal.tech) {
        await api(`/api/technicians/${modal.tech.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setModal({ type: "techs" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan teknisi");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteTech() {
    if (modal?.type !== "delete-tech") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/technicians/${modal.tech.id}`, { method: "DELETE" });
      setModal({ type: "techs" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus teknisi");
    } finally {
      setBusy(false);
    }
  }

  async function importTechniciansFile(file: File) {
    setBusy(true);
    setError("");
    setTechImportMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api<{
        imported: number;
        updated: number;
        skipped: string[];
      }>("/api/technicians/import", { method: "POST", body: fd });
      setTechImportMsg(
        `Import OK: ${result.imported} baru, ${result.updated} diupdate` +
          (result.skipped.length
            ? ` · ${result.skipped.length} baris dilewati`
            : "")
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import teknisi gagal");
    } finally {
      setBusy(false);
    }
  }

  async function loadUsers() {
    const users = await api<AppUserPublic[]>("/api/users");
    setAppUsers(users);
  }

  async function openUsersMaster() {
    setError("");
    setMasterUserDraft("");
    setMasterUserQuery("");
    setBusy(true);
    try {
      await loadUsers();
      setModal({ type: "users" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat user");
    } finally {
      setBusy(false);
    }
  }

  function openUserCreate() {
    setUserForm({
      username: "",
      password: "",
      name: "",
      level: "teknisi",
      active: "1",
    });
    setModal({ type: "user-form", mode: "create" });
  }

  function openUserEdit(user: AppUserPublic) {
    setUserForm({
      username: user.username,
      password: "",
      name: user.name,
      level: user.level,
      active: user.active,
    });
    setModal({ type: "user-form", mode: "edit", user });
  }

  async function saveUser() {
    if (modal?.type !== "user-form") return;
    if (!userForm.username.trim()) return;
    if (modal.mode === "create" && !userForm.password) return;
    setBusy(true);
    setError("");
    try {
      if (modal.mode === "create") {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username: userForm.username,
            password: userForm.password,
            name: userForm.name,
            level: userForm.level,
            active: userForm.active,
          }),
        });
      } else if (modal.user) {
        await api(`/api/users/${modal.user.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            username: userForm.username,
            name: userForm.name,
            level: userForm.level,
            active: userForm.active,
            ...(userForm.password ? { password: userForm.password } : {}),
          }),
        });
      }
      await loadUsers();
      setModal({ type: "users" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan user");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteUser() {
    if (modal?.type !== "delete-user") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/users/${modal.user.id}`, { method: "DELETE" });
      await loadUsers();
      setModal({ type: "users" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus user");
    } finally {
      setBusy(false);
    }
  }

  function openAttendanceCreate() {
    const today = new Date().toISOString().slice(0, 10);
    setAttendanceForm({
      date: attendanceDateFilter || today,
      technician_id: "",
      technician_name: "",
      pernr: "",
      status: "hadir",
      dws: "",
      check_in: "",
      check_out: "",
      absence: "",
      note: "",
    });
    setModal({ type: "attendance-form", mode: "create" });
  }

  function openAttendanceEdit(row: Attendance) {
    setAttendanceForm({
      date: row.date,
      technician_id: row.technician_id,
      technician_name: row.technician_name,
      pernr: row.pernr,
      status: row.status,
      dws: row.dws,
      check_in: row.check_in,
      check_out: row.check_out,
      absence: row.absence,
      note: row.note,
    });
    setModal({ type: "attendance-form", mode: "edit", row });
  }

  async function saveAttendance() {
    if (modal?.type !== "attendance-form") return;
    if (!attendanceForm.date || !attendanceForm.technician_name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...attendanceForm,
        technician_name: attendanceForm.technician_name.trim(),
        pernr: attendanceForm.pernr.trim(),
      };
      if (modal.mode === "create") {
        await api("/api/attendance", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (modal.row) {
        await api(`/api/attendance/${modal.row.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setModal({ type: "attendance" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan daftar hadir");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteAttendance() {
    if (modal?.type !== "delete-attendance") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/attendance/${modal.row.id}`, { method: "DELETE" });
      setModal({ type: "attendance" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus daftar hadir");
    } finally {
      setBusy(false);
    }
  }

  async function importAttendanceFile(file: File) {
    setBusy(true);
    setError("");
    setAttendanceImportMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append(
        "sync_tech_status",
        attendanceSyncTech && canTechUpdate ? "1" : "0"
      );
      const result = await api<{
        imported: number;
        updated: number;
        unmatched: string[];
        date: string;
      }>("/api/attendance/import", { method: "POST", body: fd });
      if (result.date) setAttendanceDateFilter(result.date);
      setAttendanceImportMsg(
        `Import OK: ${result.imported} baru, ${result.updated} diupdate` +
          (result.unmatched.length
            ? ` · ${result.unmatched.length} tidak match teknisi`
            : "")
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import gagal");
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

  const TECH_PAGE_SIZE = 10;
  const [techPage, setTechPage] = useState<Record<TechnicianStatus, number>>({
    available: 1,
    busy: 1,
    offline: 1,
  });
  const [techStatusFilter, setTechStatusFilter] = useState<
    "all" | TechnicianStatus
  >("all");
  const [jobSectionFilter, setJobSectionFilter] = useState<
    "all" | "active" | "queue" | "done"
  >("all");

  const JOB_PAGE_SIZE = 10;
  const [activeJobPage, setActiveJobPage] = useState(1);

  const MASTER_PAGE_SIZE = 10;
  const [unitMasterPage, setUnitMasterPage] = useState(1);
  const [masterTechPage, setMasterTechPage] = useState(1);
  const [masterUserPage, setMasterUserPage] = useState(1);
  const [attendancePage, setAttendancePage] = useState(1);
  const [attendanceDraft, setAttendanceDraft] = useState("");
  const [attendanceQuery, setAttendanceQuery] = useState("");
  const [attendanceDateFilter, setAttendanceDateFilter] = useState("");
  const [attendanceSyncTech, setAttendanceSyncTech] = useState(true);
  const [attendanceImportMsg, setAttendanceImportMsg] = useState("");
  const [attendanceForm, setAttendanceForm] = useState({
    date: "",
    technician_id: "",
    technician_name: "",
    pernr: "",
    status: "hadir" as AttendanceStatus,
    dws: "",
    check_in: "",
    check_out: "",
    absence: "",
    note: "",
  });

  const jobDraft = useJobBoardStore((s) => s.draft);
  const jobQuery = useJobBoardStore((s) => s.query);
  const setJobDraft = useJobBoardStore((s) => s.setDraft);
  const applyJobSearch = useJobBoardStore((s) => s.applySearch);
  const clearJobSearch = useJobBoardStore((s) => s.clearSearch);

  function openCreate() {
    if (!canJobCreate) return;
    resetForm();
    setModal({ type: "create" });
  }

  function openEdit(job: JobWithDetails) {
    if (!canJobUpdate) return;
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
    if (!canJobAssign) return;
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

  const canEditJobSteps =
    modal?.type === "create" ||
    (modal?.type === "edit" &&
      ["queued", "assigned"].includes(modal.job.status));

  const jobFormValid =
    form.title.trim().length > 0 &&
    form.unit_id.trim().length > 0 &&
    form.description.trim().length > 0 &&
    Number(form.estimated_minutes) > 0 &&
    (!canEditJobSteps || parseSteps(form.steps).length > 0);

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
    setHideTechPanel(readBoolFlag(HIDE_TECH_PANEL_KEY));
    setHideJobPanel(readBoolFlag(HIDE_JOB_PANEL_KEY));
  }, []);

  function toggleHideTechPanel() {
    setHideTechPanel((prev) => {
      const next = !prev;
      writeBoolFlag(HIDE_TECH_PANEL_KEY, next);
      return next;
    });
  }

  function toggleHideJobPanel() {
    setHideJobPanel((prev) => {
      const next = !prev;
      writeBoolFlag(HIDE_JOB_PANEL_KEY, next);
      return next;
    });
  }

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

  function handleAuthClick() {
    if (!isLoggedIn) {
      window.location.href = "/login";
      return;
    }
    openLogoutConfirm();
  }

  function openLogoutConfirm() {
    setError("");
    setSessionOpen(false);
    setMobileMenuOpen(false);
    setModal({ type: "logout" });
  }

  function openChangePassword() {
    setError("");
    setPasswordChangeMsg("");
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setModal({ type: "change-password" });
  }

  async function saveOwnPassword() {
    if (modal?.type !== "change-password") return;
    setBusy(true);
    setError("");
    setPasswordChangeMsg("");
    try {
      await api<{ ok: true }>("/api/account/password", {
        method: "POST",
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordChangeMsg("Password berhasil diperbarui.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah password");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setBusy(true);
    try {
      await signOut({ callbackUrl: "/login" });
    } catch {
      window.location.href = "/login";
    } finally {
      // Keep overlay if redirect is slow; reset if still on page
      setBusy(false);
      setLoggingOut(false);
    }
  }

  const availableTechs = useMemo(
    () => data?.technicians.filter((t) => t.status === "available") || [],
    [data]
  );

  useEffect(() => {
    if (modal?.type !== "units") {
      setUnitDraft("");
      setUnitQuery("");
      setUnitMasterPage(1);
    }
    if (modal?.type !== "techs") {
      setMasterTechDraft("");
      setMasterTechQuery("");
      setMasterTechPage(1);
    }
    if (modal?.type !== "attendance") {
      setAttendanceDraft("");
      setAttendanceQuery("");
      setAttendancePage(1);
      setAttendanceImportMsg("");
    }
  }, [modal?.type]);

  const filteredUnits = useMemo(() => {
    const units = data?.units || [];
    const q = unitQuery.trim().toLowerCase();
    if (!q) return units;
    return units.filter(
      (u) =>
        u.code.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q)
    );
  }, [data?.units, unitQuery]);

  useEffect(() => {
    setUnitMasterPage(1);
  }, [unitQuery]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredUnits.length / MASTER_PAGE_SIZE)
    );
    setUnitMasterPage((p) => (p > totalPages ? totalPages : p));
  }, [filteredUnits.length]);

  const unitMasterTotalPages = Math.max(
    1,
    Math.ceil(filteredUnits.length / MASTER_PAGE_SIZE)
  );
  const unitMasterPageSafe = Math.min(unitMasterPage, unitMasterTotalPages);
  const pagedUnits = filteredUnits.slice(
    (unitMasterPageSafe - 1) * MASTER_PAGE_SIZE,
    unitMasterPageSafe * MASTER_PAGE_SIZE
  );

  function applyUnitSearch() {
    setUnitQuery(unitDraft.trim());
  }

  function clearUnitSearch() {
    setUnitDraft("");
    setUnitQuery("");
  }

  const filteredMasterTechs = useMemo(() => {
    const techs = data?.technicians || [];
    const q = masterTechQuery.trim().toLowerCase();
    if (!q) return techs;
    return techs.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.skill.toLowerCase().includes(q) ||
        (t.phone || "").toLowerCase().includes(q)
    );
  }, [data?.technicians, masterTechQuery]);

  useEffect(() => {
    setMasterTechPage(1);
  }, [masterTechQuery]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredMasterTechs.length / MASTER_PAGE_SIZE)
    );
    setMasterTechPage((p) => (p > totalPages ? totalPages : p));
  }, [filteredMasterTechs.length]);

  const masterTechTotalPages = Math.max(
    1,
    Math.ceil(filteredMasterTechs.length / MASTER_PAGE_SIZE)
  );
  const masterTechPageSafe = Math.min(masterTechPage, masterTechTotalPages);
  const pagedMasterTechs = filteredMasterTechs.slice(
    (masterTechPageSafe - 1) * MASTER_PAGE_SIZE,
    masterTechPageSafe * MASTER_PAGE_SIZE
  );

  function applyMasterTechSearch() {
    setMasterTechQuery(masterTechDraft.trim());
  }

  function clearMasterTechSearch() {
    setMasterTechDraft("");
    setMasterTechQuery("");
  }

  const filteredMasterUsers = useMemo(() => {
    const q = masterUserQuery.trim().toLowerCase();
    if (!q) return appUsers;
    return appUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q)
    );
  }, [appUsers, masterUserQuery]);

  useEffect(() => {
    setMasterUserPage(1);
  }, [masterUserQuery]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredMasterUsers.length / MASTER_PAGE_SIZE)
    );
    setMasterUserPage((p) => (p > totalPages ? totalPages : p));
  }, [filteredMasterUsers.length]);

  const masterUserTotalPages = Math.max(
    1,
    Math.ceil(filteredMasterUsers.length / MASTER_PAGE_SIZE)
  );
  const masterUserPageSafe = Math.min(masterUserPage, masterUserTotalPages);
  const pagedMasterUsers = filteredMasterUsers.slice(
    (masterUserPageSafe - 1) * MASTER_PAGE_SIZE,
    masterUserPageSafe * MASTER_PAGE_SIZE
  );

  function applyMasterUserSearch() {
    setMasterUserQuery(masterUserDraft.trim());
  }

  function clearMasterUserSearch() {
    setMasterUserDraft("");
    setMasterUserQuery("");
  }

  const userFormValid =
    userForm.username.trim().length > 0 &&
    (modal?.type === "user-form" && modal.mode === "edit"
      ? true
      : userForm.password.length > 0);

  const filteredAttendance = useMemo(() => {
    let rows = data?.attendance || [];
    if (attendanceDateFilter) {
      rows = rows.filter((a) => a.date === attendanceDateFilter);
    }
    const q = attendanceQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (a) =>
        a.technician_name.toLowerCase().includes(q) ||
        a.pernr.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q) ||
        a.absence.toLowerCase().includes(q)
    );
  }, [data?.attendance, attendanceDateFilter, attendanceQuery]);

  useEffect(() => {
    setAttendancePage(1);
  }, [attendanceQuery, attendanceDateFilter]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredAttendance.length / MASTER_PAGE_SIZE)
    );
    setAttendancePage((p) => (p > totalPages ? totalPages : p));
  }, [filteredAttendance.length]);

  const attendanceTotalPages = Math.max(
    1,
    Math.ceil(filteredAttendance.length / MASTER_PAGE_SIZE)
  );
  const attendancePageSafe = Math.min(attendancePage, attendanceTotalPages);
  const pagedAttendance = filteredAttendance.slice(
    (attendancePageSafe - 1) * MASTER_PAGE_SIZE,
    attendancePageSafe * MASTER_PAGE_SIZE
  );

  function applyAttendanceSearch() {
    setAttendanceQuery(attendanceDraft.trim());
  }

  function clearAttendanceSearch() {
    setAttendanceDraft("");
    setAttendanceQuery("");
  }

  const attendanceDates = useMemo(() => {
    const set = new Set((data?.attendance || []).map((a) => a.date));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [data?.attendance]);

  const techFormValid =
    techForm.name.trim().length > 0 &&
    techForm.skill.trim().length > 0 &&
    techForm.phone.trim().length > 0;

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

  useEffect(() => {
    setTechPage({ available: 1, busy: 1, offline: 1 });
  }, [techQuery]);

  useEffect(() => {
    setTechPage((prev) => {
      let changed = false;
      const next = { ...prev };
      (["available", "busy", "offline"] as TechnicianStatus[]).forEach((status) => {
        const totalPages = Math.max(
          1,
          Math.ceil(techGroups[status].length / TECH_PAGE_SIZE)
        );
        if (next[status] > totalPages) {
          next[status] = totalPages;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [techGroups]);

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

  const doneTodayJobs = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return historyJobs.filter(
      (j) => j.status === "done" && j.completed_at?.startsWith(today)
    );
  }, [historyJobs]);

  useEffect(() => {
    setActiveJobPage(1);
  }, [jobQuery, jobSectionFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(activeJobs.length / JOB_PAGE_SIZE));
    setActiveJobPage((p) => (p > totalPages ? totalPages : p));
  }, [activeJobs.length]);

  const activeJobTotalPages = Math.max(
    1,
    Math.ceil(activeJobs.length / JOB_PAGE_SIZE)
  );
  const activeJobPageSafe = Math.min(activeJobPage, activeJobTotalPages);
  const pagedActiveJobs = activeJobs.slice(
    (activeJobPageSafe - 1) * JOB_PAGE_SIZE,
    activeJobPageSafe * JOB_PAGE_SIZE
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
    if (!jobFormValid) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          unit_id: form.unit_id,
          description: form.description.trim(),
          estimated_minutes: Number(form.estimated_minutes),
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
    if (modal?.type !== "edit" || !jobFormValid) return;
    setBusy(true);
    setError("");
    try {
      const canEditSteps = ["queued", "assigned"].includes(modal.job.status);
      await api(`/api/jobs/${modal.job.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.title.trim(),
          unit_id: form.unit_id,
          description: form.description.trim(),
          estimated_minutes: Number(form.estimated_minutes),
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
    if (!canTechUpdate || tech.status === "busy") return;
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
            <div className="job-title-row">
              <button
                className="btn btn-icon"
                style={{ width: 32, height: 32, minWidth: 32 }}
                disabled={busy || !canJobUpdate}
                onClick={() => openEdit(job)}
                aria-label="Edit job"
                title="Edit"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <div className="job-title">{job.title}</div>
            </div>
            <div className="job-unit">
              {job.unit}
            </div>
            <div className="job-tech-row">
              {["queued", "assigned", "in_progress", "paused"].includes(
                job.status
              ) && (
                <button
                  className="btn btn-icon"
                  style={{ width: 32, height: 32, minWidth: 32 }}
                  disabled={
                    busy ||
                    !canJobAssign ||
                    (job.status === "queued" && availableTechs.length === 0)
                  }
                  onClick={() => openAssign(job)}
                  aria-label={
                    job.status === "queued" ? "Assign teknisi" : "Ubah teknisi"
                  }
                  title={
                    !canJobAssign
                      ? "Assign hanya untuk Foreman & Superuser"
                      : job.status === "queued"
                        ? "Assign teknisi"
                        : "Ubah teknisi"
                  }
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
              <div className="tech-names">
                {job.technicians?.length
                  ? job.technicians.map((t) => t.name).join(", ")
                  : job.technician?.name || "Belum diassign"}
                {job.technicians?.length > 1 ? ` (${job.technicians.length} teknisi)` : ""}
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <StatusPill status={job.status} />
              <span style={{ color: "var(--muted)", marginLeft: 10, fontSize: "0.85rem" }}>
                Est. {job.estimated_minutes} mnt · Progress {job.progress_pct}%
              </span>
            </div>
          </div>
          {["in_progress", "paused", "done"].includes(job.status) && (
            <div className="job-timer-wrap">
              {job.status === "in_progress" && (
                <button
                  className="btn"
                  style={{ padding: "6px 10px", fontSize: "0.82rem" }}
                  disabled={busy || !canJobProgress}
                  onClick={() => setModal({ type: "pause-job", job })}
                  title={
                    canJobProgress
                      ? "Pause job"
                      : "Hanya Foreman & Superuser yang dapat pause job"
                  }
                >
                  Pause
                </button>
              )}
              {job.status === "paused" && (
                <button
                  className="btn btn-primary"
                  style={{ padding: "6px 10px", fontSize: "0.82rem" }}
                  disabled={busy || !canJobProgress}
                  onClick={() => setModal({ type: "resume-job", job })}
                  title={
                    canJobProgress
                      ? "Resume job"
                      : "Hanya Foreman & Superuser yang dapat resume job"
                  }
                >
                  Resume
                </button>
              )}
              <LiveTimer job={jobMap[job.id] || job} />
            </div>
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
          {job.status === "assigned" && (
            <button
              className="btn btn-primary"
              disabled={busy || !canJobProgress}
              onClick={() => runAction(job.id, "start")}
              title={
                canJobProgress
                  ? "Start job"
                  : "Hanya Foreman & Superuser yang dapat start job"
              }
            >
              Start job
            </button>
          )}
          {job.status === "in_progress" && (
            <div className="actions-spread">
              <button
                className="btn"
                disabled={busy || !canJobProgress || !job.current_step}
                onClick={() => setModal({ type: "complete-step", job })}
                title={
                  canJobProgress
                    ? "Selesaikan step"
                    : "Hanya Foreman & Superuser yang dapat menyelesaikan step"
                }
              >
                Selesai step
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canJobProgress}
                onClick={() => setModal({ type: "complete-job", job })}
                title={
                  canJobProgress
                    ? "Complete job"
                    : "Hanya Foreman & Superuser yang dapat complete job"
                }
              >
                Complete job
              </button>
            </div>
          )}
          {job.status === "paused" && (
            <button
              className="btn btn-primary"
              disabled={busy || !canJobProgress}
              onClick={() => setModal({ type: "complete-job", job })}
              title={
                canJobProgress
                  ? "Complete job"
                  : "Hanya Foreman & Superuser yang dapat complete job"
              }
            >
              Complete job
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <main className="app">
      <header className="topbar" ref={topbarRef}>
        <div>
          <div className="brand">
            TU-PRIMA
            <span>Progress Report &amp; Inspection for Mechanic Allocation</span>
          </div>
        </div>
        <div className="top-actions">
          <div className="top-actions-panel top-actions-panel--bar">
            <div className={`nav-manage${manageOpen ? " is-open" : ""}`} ref={manageRef}>
              <button
                className="btn"
                type="button"
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={manageOpen}
                onClick={() => {
                  setSessionOpen(false);
                  setManageOpen((o) => !o);
                }}
              >
                Kelola
                <svg
                  className="nav-manage-caret"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {manageOpen && (
                <div className="nav-manage-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy}
                    onClick={() => {
                      setManageOpen(false);
                      setModal({ type: "settings" });
                    }}
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy}
                    onClick={() => {
                      setManageOpen(false);
                      setTechImportMsg("");
                      setModal({ type: "techs" });
                    }}
                  >
                    Master Teknisi
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy}
                    onClick={() => {
                      setManageOpen(false);
                      openUsersMaster();
                    }}
                  >
                    Master User
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy || !canUnitRead}
                    onClick={() => {
                      setManageOpen(false);
                      setModal({ type: "units" });
                    }}
                  >
                    Master Unit
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy}
                    onClick={() => {
                      setManageOpen(false);
                      setModal({ type: "attendance" });
                    }}
                  >
                    Daftar Hadir
                  </button>
                </div>
              )}
            </div>
            <button className="btn" disabled={busy} onClick={() => load()}>
              Refresh
            </button>
            <div className="nav-session">
              {isLoggedIn ? (
                <div
                  className={`nav-session-menu${sessionOpen ? " is-open" : ""}`}
                  ref={sessionRef}
                >
                  <button
                    className="btn nav-account"
                    type="button"
                    disabled={busy || loggingOut}
                    aria-label="Menu akun"
                    aria-haspopup="menu"
                    aria-expanded={sessionOpen}
                    title={`${displayName} · ${userLevel}`}
                    onClick={() => {
                      setManageOpen(false);
                      setSessionOpen((open) => !open);
                    }}
                  >
                    <span className="nav-user">
                      <span className="nav-user-name">{displayNameShort}</span>
                      <span className="nav-user-level">{userLevel}</span>
                    </span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </button>
                  {sessionOpen && (
                    <div className="nav-manage-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="nav-manage-item"
                        disabled={busy || loggingOut}
                        onClick={() => {
                          setSessionOpen(false);
                          openChangePassword();
                        }}
                      >
                        Edit password
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="nav-manage-item"
                        disabled={busy || loggingOut}
                        onClick={() => {
                          setSessionOpen(false);
                          openLogoutConfirm();
                        }}
                      >
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  className="btn"
                  disabled={busy || sessionStatus === "loading" || loggingOut}
                  onClick={handleAuthClick}
                >
                  Login
                </button>
              )}
            </div>
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
            <button
              className="btn btn-primary"
              disabled={busy || !canJobCreate}
              onClick={() => openCreate()}
            >
              + Job baru
            </button>
          </div>

          <div className="top-actions-mobile">
            <button
              className="btn btn-primary"
              disabled={busy || !canJobCreate}
              onClick={() => openCreate()}
            >
              + Job
            </button>
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
            <button
              className="btn btn-icon top-menu-toggle"
              type="button"
              aria-label={mobileMenuOpen ? "Tutup menu" : "Buka menu"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((o) => !o)}
            >
              {mobileMenuOpen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <>
          <div
            className="top-menu-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="top-actions-panel top-actions-panel--float is-open">
            {displayName && (
              <div
                className="nav-user nav-user--menu"
                title={`${displayName} · ${userLevel}`}
              >
                <span className="nav-user-text">
                  <span className="nav-user-name">{displayNameShort}</span>
                  <span className="nav-user-level">{userLevel}</span>
                </span>
                {isLoggedIn && (
                  <button
                    className="btn btn-icon"
                    style={{ width: 28, height: 28, minWidth: 28 }}
                    type="button"
                    disabled={busy || loggingOut}
                    aria-label="Menu akun"
                    aria-expanded={sessionOpen}
                    title="Menu akun"
                    onClick={() => setSessionOpen((open) => !open)}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            {isLoggedIn && sessionOpen && (
              <div className="nav-session-actions">
                <button
                  className="btn"
                  disabled={busy || loggingOut}
                  onClick={() => {
                    setSessionOpen(false);
                    setMobileMenuOpen(false);
                    openChangePassword();
                  }}
                >
                  Edit password
                </button>
                <button
                  className="btn"
                  disabled={busy || loggingOut}
                  onClick={() => {
                    setSessionOpen(false);
                    setMobileMenuOpen(false);
                    openLogoutConfirm();
                  }}
                >
                  Logout
                </button>
              </div>
            )}
            <p className="nav-menu-label">Aksi</p>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                load();
              }}
            >
              Refresh
            </button>
            <p className="nav-menu-label">Kelola</p>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                setModal({ type: "settings" });
              }}
            >
              Settings
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                setTechImportMsg("");
                setModal({ type: "techs" });
              }}
            >
              Master Teknisi
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                openUsersMaster();
              }}
            >
              Master User
            </button>
            <button
              className="btn"
              disabled={busy || !canUnitRead}
              onClick={() => {
                setMobileMenuOpen(false);
                setModal({ type: "units" });
              }}
            >
              Master Unit
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                setModal({ type: "attendance" });
              }}
            >
              Daftar Hadir
            </button>
            {!isLoggedIn && (
              <button
                className="btn"
                disabled={busy || sessionStatus === "loading" || loggingOut}
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleAuthClick();
                }}
              >
                Login
              </button>
            )}
          </div>
        </>
      )}

      {loggingOut && (
        <div className="page-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>Keluar dari akun...</span>
        </div>
      )}

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

          <div
            className={`grid${hideTechPanel || hideJobPanel ? " grid--single" : ""}`}
          >
            {hideTechPanel ? (
              <section className="panel panel--collapsed">
                <div className="panel-vis-bar">
                  <span className="panel-vis-label">Panel Teknisi disembunyikan</span>
                  <button
                    type="button"
                    className="btn btn-icon panel-vis-btn"
                    onClick={toggleHideTechPanel}
                    aria-label="Tampilkan panel Teknisi"
                    title="Tampilkan"
                  >
                    <PanelToggleIcon collapsed />
                  </button>
                </div>
              </section>
            ) : (
            <section className="panel">
              <div className="panel-vis-bar">
                <label className="panel-filter">
                  <span className="panel-vis-label">Filter</span>
                  <select
                    value={techStatusFilter}
                    onChange={(e) =>
                      setTechStatusFilter(
                        e.target.value as "all" | TechnicianStatus
                      )
                    }
                    aria-label="Filter status teknisi"
                  >
                    <option value="all">All</option>
                    <option value="available">available</option>
                    <option value="busy">busy</option>
                    <option value="offline">offline</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-icon panel-vis-btn"
                  onClick={toggleHideTechPanel}
                  aria-label="Sembunyikan panel Teknisi"
                  title="Sembunyikan"
                >
                  <PanelToggleIcon collapsed={false} />
                </button>
              </div>
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
                    placeholder="Cari nama atau SN KPC..."
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
              <div
                className={`tech-cols${techStatusFilter !== "all" ? " tech-cols--single" : ""}`}
              >
                {(
                  techStatusFilter === "all"
                    ? (["available", "busy", "offline"] as TechnicianStatus[])
                    : [techStatusFilter]
                ).map((status) => {
                  const list = techGroups[status];
                  const totalPages = Math.max(1, Math.ceil(list.length / TECH_PAGE_SIZE));
                  const page = Math.min(techPage[status], totalPages);
                  const start = (page - 1) * TECH_PAGE_SIZE;
                  const pageItems = list.slice(start, start + TECH_PAGE_SIZE);
                  return (
                  <div className="tech-col" key={status}>
                    <h3>
                      {status} ({list.length})
                    </h3>
                    {pageItems.map((t) => {
                      const job = data.jobs.find((j) => j.id === t.current_job_id);
                      return (
                        <div className="tech" key={t.id}>
                          <div className="name">{t.name}</div>
                          <div className="meta">
                            {t.skill}
                            {job ? ` · ${job.title}` : ""}
                          </div>
                          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <StatusPill status={t.status} />
                            {t.status !== "busy" && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                                disabled={busy || !canTechUpdate}
                                onClick={() => openTechStatusModal(t)}
                              >
                                {t.status === "available" ? "Set offline" : "Set available"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {list.length === 0 && (
                      <div className="meta">
                        {techQuery ? "Tidak cocok" : "Tidak ada"}
                      </div>
                    )}
                    {list.length > TECH_PAGE_SIZE && (
                      <Pager
                        page={page}
                        totalPages={totalPages}
                        onChange={(next) =>
                          setTechPage((p) => ({ ...p, [status]: next }))
                        }
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            </section>
            )}

            {hideJobPanel ? (
              <section className="panel panel--collapsed">
                <div className="panel-vis-bar">
                  <span className="panel-vis-label">Panel Job disembunyikan</span>
                  <button
                    type="button"
                    className="btn btn-icon panel-vis-btn"
                    onClick={toggleHideJobPanel}
                    aria-label="Tampilkan panel Job"
                    title="Tampilkan"
                  >
                    <PanelToggleIcon collapsed />
                  </button>
                </div>
              </section>
            ) : (
            <section className="panel">
              <div className="panel-vis-bar">
                <label className="panel-filter">
                  <span className="panel-vis-label">Filter</span>
                  <select
                    value={jobSectionFilter}
                    onChange={(e) =>
                      setJobSectionFilter(
                        e.target.value as "all" | "active" | "queue" | "done"
                      )
                    }
                    aria-label="Filter section job"
                  >
                    <option value="all">All</option>
                    <option value="active">Job aktif</option>
                    <option value="queue">Antrian</option>
                    <option value="done">Selesai hari ini</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-icon panel-vis-btn"
                  onClick={toggleHideJobPanel}
                  aria-label="Sembunyikan panel Job"
                  title="Sembunyikan"
                >
                  <PanelToggleIcon collapsed={false} />
                </button>
              </div>
              <div className="panel-head">
                <h2>
                  {jobSectionFilter === "active"
                    ? "Job aktif & progress"
                    : jobSectionFilter === "queue"
                      ? "Antrian"
                      : jobSectionFilter === "done"
                        ? "Selesai hari ini"
                        : "Job aktif & progress"}
                </h2>
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
              {(jobSectionFilter === "all" || jobSectionFilter === "active") && (
                <>
                  {activeJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>
                      {jobQuery ? "Tidak ada job aktif yang cocok." : "Tidak ada job aktif."}
                    </p>
                  )}
                  {pagedActiveJobs.map(renderJob)}
                  {activeJobs.length > JOB_PAGE_SIZE && (
                    <Pager
                      page={activeJobPageSafe}
                      totalPages={activeJobTotalPages}
                      onChange={setActiveJobPage}
                    />
                  )}
                </>
              )}

              {(jobSectionFilter === "all" || jobSectionFilter === "queue") && (
                <>
                  {jobSectionFilter === "all" && (
                    <h2 style={{ marginTop: 22 }}>Antrian</h2>
                  )}
                  {queuedJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>
                      {jobQuery ? "Tidak ada antrian yang cocok." : "Antrian kosong."}
                    </p>
                  )}
                  {queuedJobs.map(renderJob)}
                </>
              )}

              {(jobSectionFilter === "all" || jobSectionFilter === "done") && (
                <>
                  {jobSectionFilter === "all" ? (
                    historyJobs.length > 0 && (
                      <>
                        <h2 style={{ marginTop: 22 }}>Riwayat</h2>
                        {historyJobs.map(renderJob)}
                      </>
                    )
                  ) : (
                    <>
                      {doneTodayJobs.length === 0 && (
                        <p style={{ color: "var(--muted)" }}>
                          {jobQuery
                            ? "Tidak ada job selesai hari ini yang cocok."
                            : "Belum ada job selesai hari ini."}
                        </p>
                      )}
                      {doneTodayJobs.map(renderJob)}
                    </>
                  )}
                </>
              )}
            </section>
            )}
          </div>

          <p className="db-path">
            Database Excel: <code>data/workshop.xlsx</code> (sheet Technicians, Units, Jobs, JobSteps, JobEvents, Users)
          </p>
        </>
      )}

      {modal?.type === "logout" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Keluar..." />}
            <h3>Logout</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {displayName ? `${displayName} · ${userLevel}` : "Akun saat ini"}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Keluar dari akun ini? Anda perlu login lagi untuk melakukan aksi
              yang memerlukan akses.
            </p>
            <div className="actions">
              <button
                className="btn"
                onClick={closeModal}
                disabled={busy || loggingOut}
              >
                Tidak
              </button>
              <button
                className="btn btn-danger"
                disabled={busy || loggingOut}
                onClick={() => void handleLogout()}
              >
                <BusyLabel
                  busy={loggingOut}
                  idle="Ya, logout"
                  pending="Keluar..."
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "change-password" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memperbarui password..." />}
            <h3>Update password</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Masukkan password saat ini dan password baru minimal 6 karakter.
            </p>
            {error && <div className="error">{error}</div>}
            {passwordChangeMsg && (
              <p style={{ color: "var(--green)", marginTop: 0 }}>
                {passwordChangeMsg}
              </p>
            )}
            <div className="form">
              <label>
                Password saat ini *
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      currentPassword: e.target.value,
                    })
                  }
                  autoComplete="current-password"
                  autoFocus
                />
              </label>
              <label>
                Password baru *
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      newPassword: e.target.value,
                    })
                  }
                  autoComplete="new-password"
                />
              </label>
              <label>
                Konfirmasi password baru *
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      confirmPassword: e.target.value,
                    })
                  }
                  autoComplete="new-password"
                />
              </label>
              {passwordForm.confirmPassword &&
                passwordForm.newPassword !== passwordForm.confirmPassword && (
                  <p className="error" style={{ margin: 0 }}>
                    Konfirmasi password baru belum cocok.
                  </p>
                )}
              <div className="actions">
                <button className="btn" onClick={closeModal} disabled={busy}>
                  Tutup
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !passwordForm.currentPassword ||
                    passwordForm.newPassword.length < 6 ||
                    passwordForm.newPassword !== passwordForm.confirmPassword
                  }
                  onClick={saveOwnPassword}
                >
                  <BusyLabel
                    busy={busy}
                    idle="Update password"
                    pending="Memperbarui..."
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(modal?.type === "create" || modal?.type === "edit") && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            {modal.type === "edit" ? (
              <div className="modal-header">
                <h3>Edit job</h3>
                <div className="modal-header-actions">
                  {!["done", "cancelled"].includes(modal.job.status) && (
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy || !canJobUpdate}
                      onClick={() =>
                        setModal({ type: "cancel-job", job: modal.job })
                      }
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={
                      busy || !canJobDelete || modal.job.status === "done"
                    }
                    onClick={() =>
                      setModal({ type: "delete-job", job: modal.job })
                    }
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ) : (
              <h3>Job baru</h3>
            )}
            <div className="form">
              <label>
                Judul *
                <input
                  value={form.title}
                  onChange={(e) => setForm({ title: e.target.value })}
                  required
                />
              </label>
              <label>
                Unit *
                <select
                  value={form.unit_id}
                  onChange={(e) => setForm({ unit_id: e.target.value })}
                  required
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
                Deskripsi *
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ description: e.target.value })}
                  required
                />
              </label>
              <label>
                Estimasi (menit) *
                <input
                  type="number"
                  min={1}
                  value={form.estimated_minutes}
                  onChange={(e) =>
                    setForm({ estimated_minutes: e.target.value })
                  }
                  required
                />
              </label>
              {(modal.type === "create" ||
                ["queued", "assigned"].includes(modal.job.status)) && (
                <label>
                  Tahapan (satu baris per step) *
                  <textarea
                    rows={4}
                    value={form.steps}
                    onChange={(e) => setForm({ steps: e.target.value })}
                    placeholder={"Diagnosis\nPerbaikan\nTest & QC"}
                    required
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
                {modal.type === "create" && (
                  <button className="btn" onClick={closeModal}>
                    Batal
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !jobFormValid ||
                    (modal.type === "edit" && modal.job.status === "done")
                  }
                  onClick={modal.type === "create" ? createJob : saveEditJob}
                >
                  <BusyLabel
                    busy={busy}
                    idle={modal.type === "create" ? "Simpan" : "Update"}
                    pending="Menyimpan..."
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "assign" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay />}
            <h3>
              {modal.job.status === "queued"
                ? "Assign teknisi"
                : "Ubah teknisi"}
            </h3>
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
                    placeholder="Nama atau SN KPC..."
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
            {busy && <BusyOverlay label="Menyimpan..." />}
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
                <BusyLabel
                  busy={busy}
                  idle={`Ya, set ${modal.nextStatus}`}
                  pending="Menyimpan..."
                />
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
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>
              {modal.job.status === "queued"
                ? "Konfirmasi assign"
                : "Konfirmasi ubah teknisi"}
            </h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              {modal.job.status === "queued"
                ? `Assign ${modal.techIds.length} teknisi ke job ini?`
                : `Ubah teknisi job ini menjadi ${modal.techIds.length} orang?`}
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
                <BusyLabel
                  busy={busy}
                  idle={
                    modal.job.status === "queued"
                      ? `Ya, assign (${modal.techIds.length})`
                      : `Ya, ubah (${modal.techIds.length})`
                  }
                  pending="Memproses..."
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "pause-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Pause job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Pause job ini? Timer akan berhenti sementara dan status menjadi{" "}
              <strong>paused</strong>.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canJobProgress}
                onClick={() => runAction(modal.job.id, "pause")}
              >
                <BusyLabel busy={busy} idle="Ya, pause" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "resume-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Resume job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Lanjutkan job ini? Status kembali menjadi{" "}
              <strong>in progress</strong> dan timer berjalan lagi.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canJobProgress}
                onClick={() => runAction(modal.job.id, "resume")}
              >
                <BusyLabel busy={busy} idle="Ya, resume" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "complete-step" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Selesai step</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Tandai step aktif{" "}
              {modal.job.current_step ? (
                <strong>{modal.job.current_step.name}</strong>
              ) : (
                "saat ini"
              )}{" "}
              sebagai selesai?
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canJobProgress}
                onClick={() => runAction(modal.job.id, "complete_step")}
              >
                <BusyLabel busy={busy} idle="Ya, selesai step" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "complete-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Complete job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Selesaikan seluruh job ini? Status menjadi <strong>done</strong>{" "}
              dan teknisi akan dilepas.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canJobProgress}
                onClick={() => runAction(modal.job.id, "complete")}
              >
                <BusyLabel busy={busy} idle="Ya, complete" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "cancel-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
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
                <BusyLabel busy={busy} idle="Ya, cancel" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
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
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "units" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" style={{ width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay />}
            <h3>Master Unit</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Data unit dipilih saat buat/edit job. Upload Excel untuk mass input
              — header: Nomor unit, Model, Status (opsional).
            </p>
            {error && <div className="error">{error}</div>}
            {unitImportMsg && (
              <p style={{ color: "var(--green)", marginTop: 0 }}>
                {unitImportMsg}
              </p>
            )}
            {canUnitCreate && (
              <div className="form" style={{ marginBottom: 12 }}>
                <div className="actions" style={{ marginTop: 0 }}>
                  <a
                    className="btn"
                    href="/api/units/template"
                    download="template-upload-unit.xlsx"
                  >
                    Unduh template Excel
                  </a>
                </div>
                <label>
                  Mass upload Excel (.xlsx)
                  <input
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) importUnitsFile(file);
                    }}
                  />
                </label>
              </div>
            )}
            <div className="panel-search-row" style={{ justifyContent: "stretch", marginBottom: 12 }}>
              <input
                className="panel-search"
                style={{ maxWidth: "none" }}
                type="search"
                value={unitDraft}
                onChange={(e) => setUnitDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyUnitSearch();
                  }
                }}
                placeholder="Cari nomor unit atau model..."
                aria-label="Cari unit"
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={applyUnitSearch}
              >
                Cari
              </button>
              {unitQuery && (
                <button
                  type="button"
                  className="btn"
                  onClick={clearUnitSearch}
                >
                  Reset
                </button>
              )}
            </div>
            <div className="check-list" style={{ maxHeight: 280, marginBottom: 12 }}>
              {(data?.units || []).length === 0 && (
                <span style={{ color: "var(--muted)" }}>Belum ada unit.</span>
              )}
              {(data?.units || []).length > 0 && filteredUnits.length === 0 && (
                <span style={{ color: "var(--muted)" }}>Tidak ada unit yang cocok.</span>
              )}
              {pagedUnits.map((u) => (
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
                      disabled={busy || !canUnitUpdate}
                      onClick={() => openUnitEdit(u)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy || !canUnitDelete}
                      onClick={() => setModal({ type: "delete-unit", unit: u })}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {filteredUnits.length > MASTER_PAGE_SIZE && (
              <Pager
                page={unitMasterPageSafe}
                totalPages={unitMasterTotalPages}
                onChange={setUnitMasterPage}
              />
            )}
            <div className="actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canUnitCreate}
                onClick={openUnitCreate}
              >
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
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>{modal.mode === "create" ? "Unit baru" : "Edit unit"}</h3>
            <div className="form">
              <label>
                Nomor unit
                <input
                  value={unitForm.code}
                  onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value })}
                  placeholder="Mis. E448"
                />
              </label>
              <label>
                Model
                <input
                  value={unitForm.name}
                  onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                  placeholder="Mis. D10T"
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
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
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
            {busy && <BusyOverlay label="Menghapus..." />}
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
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "techs" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div
            className="modal"
            style={{ width: "min(600px, 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay />}
            <h3>Master Teknisi</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Kelola data teknisi (nama, SN KPC, telepon, status). Upload Excel
              untuk mass input — header: Nama, SN KPC, Telepon, Status (opsional).
            </p>
            {error && <div className="error">{error}</div>}
            {techImportMsg && (
              <p style={{ color: "var(--green)", marginTop: 0 }}>{techImportMsg}</p>
            )}
            {canTechCreate && (
            <div className="form" style={{ marginBottom: 12 }}>
              <div className="actions" style={{ marginTop: 0 }}>
                <a
                  className="btn"
                  href="/api/technicians/template"
                  download="template-upload-teknisi.xlsx"
                >
                  Unduh template Excel
                </a>
              </div>
              <label>
                Mass upload Excel (.xlsx)
                <input
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) importTechniciansFile(file);
                  }}
                />
              </label>
            </div>
            )}
            <div className="panel-search-row" style={{ justifyContent: "stretch", marginBottom: 12 }}>
              <input
                className="panel-search"
                style={{ maxWidth: "none" }}
                type="search"
                value={masterTechDraft}
                onChange={(e) => setMasterTechDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyMasterTechSearch();
                  }
                }}
                placeholder="Cari nama, SN KPC, atau telepon..."
                aria-label="Cari teknisi"
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={applyMasterTechSearch}
              >
                Cari
              </button>
              {masterTechQuery && (
                <button
                  type="button"
                  className="btn"
                  onClick={clearMasterTechSearch}
                >
                  Reset
                </button>
              )}
            </div>
            <div className="check-list" style={{ maxHeight: 280, marginBottom: 12 }}>
              {(data?.technicians || []).length === 0 && (
                <span style={{ color: "var(--muted)" }}>Belum ada teknisi.</span>
              )}
              {(data?.technicians || []).length > 0 && filteredMasterTechs.length === 0 && (
                <span style={{ color: "var(--muted)" }}>Tidak ada teknisi yang cocok.</span>
              )}
              {pagedMasterTechs.map((t) => (
                <div
                  key={t.id}
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
                    <strong>{t.name}</strong>
                    <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                      {t.skill}
                      {t.phone ? ` · ${t.phone}` : ""}
                      {` · ${t.status}`}
                    </div>
                  </div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy || !canTechUpdate}
                      onClick={() => openTechEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy || !canTechDelete || t.status === "busy"}
                      onClick={() => setModal({ type: "delete-tech", tech: t })}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {filteredMasterTechs.length > MASTER_PAGE_SIZE && (
              <Pager
                page={masterTechPageSafe}
                totalPages={masterTechTotalPages}
                onChange={setMasterTechPage}
              />
            )}
            <div className="actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canTechCreate}
                onClick={openTechCreate}
              >
                + Teknisi baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "tech-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "techs" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>{modal.mode === "create" ? "Teknisi baru" : "Edit teknisi"}</h3>
            {error && <div className="error">{error}</div>}
            <div className="form">
              <label>
                Nama *
                <input
                  value={techForm.name}
                  onChange={(e) => setTechForm({ ...techForm, name: e.target.value })}
                  required
                />
              </label>
              <label>
                SN KPC *
                <input
                  value={techForm.skill}
                  onChange={(e) => setTechForm({ ...techForm, skill: e.target.value })}
                  required
                />
              </label>
              <label>
                Telepon *
                <input
                  value={techForm.phone}
                  onChange={(e) => setTechForm({ ...techForm, phone: e.target.value })}
                  required
                />
              </label>
              {modal.tech?.status === "busy" ? (
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                  Status: busy — tidak bisa diubah sampai job selesai.
                </p>
              ) : (
                <label>
                  Status *
                  <select
                    value={techForm.status}
                    onChange={(e) =>
                      setTechForm({
                        ...techForm,
                        status: e.target.value as Exclude<TechnicianStatus, "busy">,
                      })
                    }
                    required
                  >
                    <option value="available">available</option>
                    <option value="offline">offline</option>
                  </select>
                </label>
              )}
              <div className="actions">
                <button className="btn" onClick={() => setModal({ type: "techs" })}>
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !techFormValid}
                  onClick={saveTech}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-tech" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "techs" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus teknisi</h3>
            {error && <div className="error">{error}</div>}
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.tech.name} — {modal.tech.skill}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus teknisi ini permanen? Jika masih terpasang di job aktif,
              penghapusan akan ditolak.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setModal({ type: "techs" })}>
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteTech}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "users" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" style={{ width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay />}
            <h3>Master User</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Kelola akun login (tersimpan di sheet Users pada Excel).
            </p>
            {error && <div className="error">{error}</div>}
            <div className="panel-search-row" style={{ justifyContent: "stretch", marginBottom: 12 }}>
              <input
                className="panel-search"
                style={{ maxWidth: "none" }}
                type="search"
                value={masterUserDraft}
                onChange={(e) => setMasterUserDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyMasterUserSearch();
                  }
                }}
                placeholder="Cari username atau nama..."
                aria-label="Cari user"
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={applyMasterUserSearch}
              >
                Cari
              </button>
              {masterUserQuery && (
                <button
                  type="button"
                  className="btn"
                  onClick={clearMasterUserSearch}
                >
                  Reset
                </button>
              )}
            </div>
            <div className="check-list" style={{ maxHeight: 280, marginBottom: 12 }}>
              {appUsers.length === 0 && (
                <span style={{ color: "var(--muted)" }}>Belum ada user.</span>
              )}
              {appUsers.length > 0 && filteredMasterUsers.length === 0 && (
                <span style={{ color: "var(--muted)" }}>Tidak ada user yang cocok.</span>
              )}
              {pagedMasterUsers.map((u) => (
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
                    <strong>{u.username}</strong>
                    <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                      {u.name || "—"}
                      {` · ${u.level}`}
                      {` · ${u.active === "1" ? "aktif" : "nonaktif"}`}
                    </div>
                  </div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy || !canUserUpdate}
                      onClick={() => openUserEdit(u)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy || !canUserDelete}
                      onClick={() => setModal({ type: "delete-user", user: u })}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {filteredMasterUsers.length > MASTER_PAGE_SIZE && (
              <Pager
                page={masterUserPageSafe}
                totalPages={masterUserTotalPages}
                onChange={setMasterUserPage}
              />
            )}
            <div className="actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canUserCreate}
                onClick={openUserCreate}
              >
                + User baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "user-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "users" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>{modal.mode === "create" ? "User baru" : "Edit user"}</h3>
            {error && <div className="error">{error}</div>}
            <div className="form">
              <label>
                Username *
                <input
                  value={userForm.username}
                  onChange={(e) =>
                    setUserForm({ ...userForm, username: e.target.value })
                  }
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Password {modal.mode === "create" ? "*" : "(kosongkan jika tidak diubah)"}
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm({ ...userForm, password: e.target.value })
                  }
                  autoComplete="new-password"
                  required={modal.mode === "create"}
                />
              </label>
              <label>
                Nama tampilan
                <input
                  value={userForm.name}
                  onChange={(e) =>
                    setUserForm({ ...userForm, name: e.target.value })
                  }
                />
              </label>
              <label>
                Level akses *
                <select
                  value={userForm.level}
                  onChange={(e) =>
                    setUserForm({
                      ...userForm,
                      level: e.target.value as UserLevel,
                    })
                  }
                  required
                >
                  {USER_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status *
                <select
                  value={userForm.active}
                  onChange={(e) =>
                    setUserForm({ ...userForm, active: e.target.value })
                  }
                  required
                >
                  <option value="1">aktif</option>
                  <option value="0">nonaktif</option>
                </select>
              </label>
              <div className="actions">
                <button className="btn" onClick={() => setModal({ type: "users" })}>
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !userFormValid}
                  onClick={saveUser}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-user" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "users" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus user</h3>
            {error && <div className="error">{error}</div>}
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.user.username}
              {modal.user.name ? ` — ${modal.user.name}` : ""}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus user ini permanen dari Excel? User aktif terakhir tidak bisa
              dihapus.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setModal({ type: "users" })}>
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteUser}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "attendance" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div
            className="modal"
            style={{ width: "min(640px, 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay />}
            <h3>Daftar Hadir</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Upload Excel daftar hadir (Pernr / Name Employee) lalu kelola
              data. Match teknisi via SN KPC = Pernr.
            </p>
            {error && <div className="error">{error}</div>}
            {attendanceImportMsg && (
              <p style={{ color: "var(--green)", marginTop: 0 }}>
                {attendanceImportMsg}
              </p>
            )}
            {canAttendanceCreate && (
            <div className="form" style={{ marginBottom: 12 }}>
              <label>
                Upload Excel (.xlsx)
                <input
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) importAttendanceFile(file);
                  }}
                />
              </label>
              <label className="check-item">
                <input
                  type="checkbox"
                  checked={attendanceSyncTech}
                  disabled={!canTechUpdate}
                  onChange={(e) => setAttendanceSyncTech(e.target.checked)}
                />
                <span>
                  Sync status teknisi (hadir → available, lainnya → offline)
                </span>
              </label>
            </div>
            )}
            <div
              className="panel-search-row"
              style={{ justifyContent: "stretch", marginBottom: 12, flexWrap: "wrap" }}
            >
              <select
                value={attendanceDateFilter}
                onChange={(e) => setAttendanceDateFilter(e.target.value)}
                style={{ maxWidth: 160 }}
                aria-label="Filter tanggal"
              >
                <option value="">Semua tanggal</option>
                {attendanceDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                className="panel-search"
                style={{ maxWidth: "none", flex: 1 }}
                type="search"
                value={attendanceDraft}
                onChange={(e) => setAttendanceDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyAttendanceSearch();
                  }
                }}
                placeholder="Cari nama, Pernr, status..."
                aria-label="Cari daftar hadir"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={applyAttendanceSearch}
              >
                Cari
              </button>
              {(attendanceQuery || attendanceDateFilter) && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    clearAttendanceSearch();
                    setAttendanceDateFilter("");
                  }}
                >
                  Reset
                </button>
              )}
            </div>
            <div className="check-list" style={{ maxHeight: 280, marginBottom: 12 }}>
              {(data?.attendance || []).length === 0 && (
                <span style={{ color: "var(--muted)" }}>
                  Belum ada data hadir. Upload Excel untuk mulai.
                </span>
              )}
              {(data?.attendance || []).length > 0 &&
                filteredAttendance.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    Tidak ada data yang cocok.
                  </span>
                )}
              {pagedAttendance.map((a) => (
                <div
                  key={a.id}
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
                    <strong>{a.technician_name}</strong>
                    <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                      {a.date}
                      {a.pernr ? ` · ${a.pernr}` : ""}
                      {` · ${a.status}`}
                      {a.dws ? ` · ${a.dws}` : ""}
                      {!a.technician_id ? " · belum match" : ""}
                    </div>
                  </div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy || !canAttendanceUpdate}
                      onClick={() => openAttendanceEdit(a)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                      disabled={busy || !canAttendanceDelete}
                      onClick={() =>
                        setModal({ type: "delete-attendance", row: a })
                      }
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {filteredAttendance.length > MASTER_PAGE_SIZE && (
              <Pager
                page={attendancePageSafe}
                totalPages={attendanceTotalPages}
                onChange={setAttendancePage}
              />
            )}
            <div className="actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canAttendanceCreate}
                onClick={openAttendanceCreate}
              >
                + Hadir baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "attendance-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "attendance" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>
              {modal.mode === "create" ? "Hadir baru" : "Edit daftar hadir"}
            </h3>
            {error && <div className="error">{error}</div>}
            <div className="form">
              <label>
                Tanggal *
                <input
                  type="date"
                  value={attendanceForm.date}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, date: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                Teknisi (opsional — auto isi nama/Pernr)
                <select
                  value={attendanceForm.technician_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const tech = (data?.technicians || []).find((t) => t.id === id);
                    setAttendanceForm({
                      ...attendanceForm,
                      technician_id: id,
                      technician_name: tech?.name || attendanceForm.technician_name,
                      pernr: tech?.skill || attendanceForm.pernr,
                    });
                  }}
                >
                  <option value="">— Pilih teknisi —</option>
                  {(data?.technicians || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.skill})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nama *
                <input
                  value={attendanceForm.technician_name}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      technician_name: e.target.value,
                    })
                  }
                  required
                />
              </label>
              <label>
                Pernr / SN KPC
                <input
                  value={attendanceForm.pernr}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, pernr: e.target.value })
                  }
                />
              </label>
              <label>
                Status *
                <select
                  value={attendanceForm.status}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      status: e.target.value as AttendanceStatus,
                    })
                  }
                >
                  <option value="hadir">hadir</option>
                  <option value="izin">izin</option>
                  <option value="sakit">sakit</option>
                  <option value="off">off</option>
                  <option value="alpha">alpha</option>
                </select>
              </label>
              <label>
                DWS
                <input
                  value={attendanceForm.dws}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, dws: e.target.value })
                  }
                />
              </label>
              <label>
                Clock in
                <input
                  value={attendanceForm.check_in}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      check_in: e.target.value,
                    })
                  }
                  placeholder="HH:mm"
                />
              </label>
              <label>
                Clock out
                <input
                  value={attendanceForm.check_out}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      check_out: e.target.value,
                    })
                  }
                  placeholder="HH:mm"
                />
              </label>
              <label>
                Absence
                <input
                  value={attendanceForm.absence}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      absence: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Catatan
                <input
                  value={attendanceForm.note}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, note: e.target.value })
                  }
                />
              </label>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() => setModal({ type: "attendance" })}
                >
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !attendanceForm.date ||
                    !attendanceForm.technician_name.trim()
                  }
                  onClick={saveAttendance}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-attendance" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "attendance" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus daftar hadir</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.row.technician_name} — {modal.row.date}
              {modal.row.pernr ? ` · ${modal.row.pernr}` : ""}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus data hadir ini permanen?
            </p>
            <div className="actions">
              <button
                className="btn"
                onClick={() => setModal({ type: "attendance" })}
              >
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteAttendance}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "settings" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Sembunyikan panel di board. Preferensi tersimpan di browser ini.
            </p>
            <div className="form">
              <label className="check-item" style={{ padding: "10px 0" }}>
                <input
                  type="checkbox"
                  checked={hideTechPanel}
                  onChange={toggleHideTechPanel}
                />
                <span>
                  <strong>Sembunyikan panel Teknisi</strong>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    Kolom available / busy / offline tidak ditampilkan
                  </div>
                </span>
              </label>
              <label className="check-item" style={{ padding: "10px 0" }}>
                <input
                  type="checkbox"
                  checked={hideJobPanel}
                  onChange={toggleHideJobPanel}
                />
                <span>
                  <strong>Sembunyikan panel Job</strong>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    Job aktif, antrian, dan riwayat tidak ditampilkan
                  </div>
                </span>
              </label>
              <div className="actions">
                <button className="btn btn-primary" onClick={closeModal}>
                  Selesai
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
