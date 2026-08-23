-- TU-PRIMA relational schema (MariaDB / MySQL 8+)
CREATE DATABASE IF NOT EXISTS tu_prima
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tu_prima;

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(64)  NOT NULL PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  name          VARCHAR(255) NOT NULL DEFAULT '',
  level         VARCHAR(32)  NOT NULL DEFAULT 'teknisi',
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    VARCHAR(64)  NOT NULL DEFAULT '',
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS technicians (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  name           VARCHAR(255) NOT NULL DEFAULT '',
  sn             VARCHAR(64)  NOT NULL DEFAULT '',
  status         VARCHAR(32)  NOT NULL DEFAULT 'offline',
  current_job_id VARCHAR(64)  NOT NULL DEFAULT '',
  phone          VARCHAR(64)  NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS units (
  id            VARCHAR(64)  NOT NULL PRIMARY KEY,
  code          VARCHAR(64)  NOT NULL DEFAULT '',
  name          VARCHAR(255) NOT NULL DEFAULT '',
  serial_number VARCHAR(128) NOT NULL DEFAULT '',
  active        TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id                   VARCHAR(64)  NOT NULL PRIMARY KEY,
  job_scope            ENUM('active','completed','cancelled','deleted') NOT NULL DEFAULT 'active',
  title                VARCHAR(255) NOT NULL DEFAULT '',
  unit_label           VARCHAR(255) NOT NULL DEFAULT '',
  unit_id              VARCHAR(64)  NOT NULL DEFAULT '',
  description          TEXT,
  status               VARCHAR(32)  NOT NULL DEFAULT 'queued',
  technician_id        VARCHAR(64)  NOT NULL DEFAULT '',
  template_id          VARCHAR(64)  NOT NULL DEFAULT '',
  created_at           VARCHAR(64)  NOT NULL DEFAULT '',
  started_at           VARCHAR(64)  NOT NULL DEFAULT '',
  completed_at         VARCHAR(64)  NOT NULL DEFAULT '',
  paused_at            VARCHAR(64)  NOT NULL DEFAULT '',
  total_paused_sec     INT          NOT NULL DEFAULT 0,
  estimated_minutes    INT          NOT NULL DEFAULT 0,
  archived_at          VARCHAR(64)  NOT NULL DEFAULT '',
  archived_by_user_id  VARCHAR(64)  NOT NULL DEFAULT '',
  archived_by_user_name VARCHAR(255) NOT NULL DEFAULT '',
  archived_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
  deleted_at           VARCHAR(64)  NOT NULL DEFAULT '',
  deleted_by_user_id   VARCHAR(64)  NOT NULL DEFAULT '',
  deleted_by_user_name VARCHAR(255) NOT NULL DEFAULT '',
  deleted_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
  assigned_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
  assigned_by_user_name VARCHAR(255) NOT NULL DEFAULT '',
  assigned_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
  delegated_to_user_id VARCHAR(64) NOT NULL DEFAULT '',
  delegated_to_user_name VARCHAR(255) NOT NULL DEFAULT '',
  delegated_at VARCHAR(64) NOT NULL DEFAULT '',
  delegated_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
  KEY idx_jobs_scope (job_scope),
  KEY idx_jobs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_assignees (
  id              VARCHAR(64) NOT NULL PRIMARY KEY,
  job_id          VARCHAR(64) NOT NULL,
  technician_id   VARCHAR(64) NOT NULL DEFAULT '',
  technician_name VARCHAR(255) NOT NULL DEFAULT '',
  technician_sn   VARCHAR(64) NOT NULL DEFAULT '',
  assigned_at     VARCHAR(64) NOT NULL DEFAULT '',
  is_lead         TINYINT(1)  NOT NULL DEFAULT 0,
  KEY idx_job_assignees_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_steps (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  job_id       VARCHAR(64)  NOT NULL,
  name         VARCHAR(255) NOT NULL DEFAULT '',
  step_order   INT          NOT NULL DEFAULT 0,
  status       VARCHAR(32)  NOT NULL DEFAULT 'pending',
  started_at   VARCHAR(64)  NOT NULL DEFAULT '',
  completed_at VARCHAR(64)  NOT NULL DEFAULT '',
  duration_sec INT          NOT NULL DEFAULT 0,
  std_minutes  INT          NOT NULL DEFAULT 0,
  KEY idx_job_steps_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_events (
  id         VARCHAR(64)  NOT NULL PRIMARY KEY,
  job_id     VARCHAR(64)  NOT NULL,
  type       VARCHAR(64)  NOT NULL DEFAULT '',
  note       TEXT,
  created_at VARCHAR(64)  NOT NULL DEFAULT '',
  user_id    VARCHAR(64)  NOT NULL DEFAULT '',
  user_name  VARCHAR(255) NOT NULL DEFAULT '',
  user_level VARCHAR(64)  NOT NULL DEFAULT '',
  KEY idx_job_events_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_handovers (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  job_id         VARCHAR(64)  NOT NULL,
  handover_order INT          NOT NULL DEFAULT 0,
  title          VARCHAR(255) NOT NULL DEFAULT '',
  done           TINYINT(1)   NOT NULL DEFAULT 0,
  note           TEXT,
  user_id        VARCHAR(64)  NOT NULL DEFAULT '',
  user_name      VARCHAR(255) NOT NULL DEFAULT '',
  updated_at     VARCHAR(64)  NOT NULL DEFAULT '',
  KEY idx_job_handovers_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_part_loans (
  id         VARCHAR(64)  NOT NULL PRIMARY KEY,
  job_id     VARCHAR(64)  NOT NULL,
  loan_order INT          NOT NULL DEFAULT 0,
  part_name  VARCHAR(255) NOT NULL DEFAULT '',
  status     VARCHAR(32)  NOT NULL DEFAULT 'open',
  note       TEXT,
  user_id    VARCHAR(64)  NOT NULL DEFAULT '',
  user_name  VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(64)  NOT NULL DEFAULT '',
  KEY idx_job_part_loans_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
  id              VARCHAR(64)  NOT NULL PRIMARY KEY,
  attendance_date VARCHAR(16)  NOT NULL DEFAULT '',
  technician_id   VARCHAR(64)  NOT NULL DEFAULT '',
  technician_name VARCHAR(255) NOT NULL DEFAULT '',
  pernr           VARCHAR(64)  NOT NULL DEFAULT '',
  status          VARCHAR(32)  NOT NULL DEFAULT 'alpha',
  dws             VARCHAR(64)  NOT NULL DEFAULT '',
  check_in        VARCHAR(32)  NOT NULL DEFAULT '',
  check_out       VARCHAR(32)  NOT NULL DEFAULT '',
  absence         VARCHAR(255) NOT NULL DEFAULT '',
  note            TEXT,
  KEY idx_attendance_date (attendance_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id         VARCHAR(64)  NOT NULL PRIMARY KEY,
  at         VARCHAR(64)  NOT NULL DEFAULT '',
  user_id    VARCHAR(64)  NOT NULL DEFAULT '',
  user_name  VARCHAR(255) NOT NULL DEFAULT '',
  user_level VARCHAR(64)  NOT NULL DEFAULT '',
  action     VARCHAR(64)  NOT NULL DEFAULT '',
  entity     VARCHAR(64)  NOT NULL DEFAULT '',
  entity_id  VARCHAR(64)  NOT NULL DEFAULT '',
  detail     TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_change_backups (
  id                   VARCHAR(64) NOT NULL PRIMARY KEY,
  at                   VARCHAR(64) NOT NULL DEFAULT '',
  user_id              VARCHAR(64) NOT NULL DEFAULT '',
  user_name            VARCHAR(255) NOT NULL DEFAULT '',
  user_level           VARCHAR(64) NOT NULL DEFAULT '',
  action               VARCHAR(64) NOT NULL DEFAULT '',
  entity               VARCHAR(64) NOT NULL DEFAULT '',
  entity_id            VARCHAR(64) NOT NULL DEFAULT '',
  job_id               VARCHAR(64) NOT NULL DEFAULT '',
  summary              TEXT,
  before_json          LONGTEXT,
  after_json           LONGTEXT,
  undone               TINYINT(1)  NOT NULL DEFAULT 0,
  undone_at            VARCHAR(64) NOT NULL DEFAULT '',
  undone_by_user_id    VARCHAR(64) NOT NULL DEFAULT '',
  undone_by_user_name  VARCHAR(255) NOT NULL DEFAULT '',
  undone_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
  KEY idx_job_change_backups_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
