-- PRIMA MySQL schema (mirror of workshop.xlsx sheets)
-- Import via phpMyAdmin → Import → schema.sql
-- Charset: utf8mb4

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(150) NOT NULL DEFAULT '',
  level ENUM('superuser','inputer','teknisi','foreman','hrd','spv') NOT NULL DEFAULT 'teknisi',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS units (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL DEFAULT '',
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_units_code (code),
  KEY idx_units_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS technicians (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  skill VARCHAR(100) NOT NULL DEFAULT '',
  status ENUM('available','busy','offline') NOT NULL DEFAULT 'available',
  current_job_id VARCHAR(64) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  KEY idx_tech_status (status),
  KEY idx_tech_skill (skill)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  unit VARCHAR(255) NOT NULL DEFAULT '',
  unit_id VARCHAR(64) NOT NULL DEFAULT '',
  description TEXT,
  status ENUM('queued','assigned','in_progress','paused','done','cancelled') NOT NULL DEFAULT 'queued',
  technician_id VARCHAR(64) NOT NULL DEFAULT '',
  created_at VARCHAR(40) NOT NULL,
  started_at VARCHAR(40) NOT NULL DEFAULT '',
  completed_at VARCHAR(40) NOT NULL DEFAULT '',
  paused_at VARCHAR(40) NOT NULL DEFAULT '',
  total_paused_sec INT NOT NULL DEFAULT 0,
  estimated_minutes INT NOT NULL DEFAULT 60,
  KEY idx_jobs_status (status),
  KEY idx_jobs_unit (unit_id),
  KEY idx_jobs_completed (completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_assignees (
  id VARCHAR(64) PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  technician_id VARCHAR(64) NOT NULL,
  assigned_at VARCHAR(40) NOT NULL,
  is_lead TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_assignees_job (job_id),
  KEY idx_assignees_tech (technician_id),
  CONSTRAINT fk_assignees_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_steps (
  id VARCHAR(64) PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  name VARCHAR(150) NOT NULL,
  `order` INT NOT NULL DEFAULT 1,
  status ENUM('pending','in_progress','done') NOT NULL DEFAULT 'pending',
  started_at VARCHAR(40) NOT NULL DEFAULT '',
  completed_at VARCHAR(40) NOT NULL DEFAULT '',
  duration_sec INT NOT NULL DEFAULT 0,
  KEY idx_steps_job (job_id),
  CONSTRAINT fk_steps_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_events (
  id VARCHAR(64) PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  type VARCHAR(40) NOT NULL,
  note TEXT,
  created_at VARCHAR(40) NOT NULL,
  KEY idx_events_job (job_id),
  KEY idx_events_created (created_at),
  CONSTRAINT fk_events_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
  id VARCHAR(64) PRIMARY KEY,
  date CHAR(10) NOT NULL,
  technician_id VARCHAR(64) NOT NULL DEFAULT '',
  technician_name VARCHAR(150) NOT NULL DEFAULT '',
  pernr VARCHAR(40) NOT NULL DEFAULT '',
  status ENUM('hadir','izin','sakit','off','alpha') NOT NULL DEFAULT 'alpha',
  dws VARCHAR(40) NOT NULL DEFAULT '',
  check_in VARCHAR(40) NOT NULL DEFAULT '',
  check_out VARCHAR(40) NOT NULL DEFAULT '',
  absence VARCHAR(100) NOT NULL DEFAULT '',
  note TEXT,
  KEY idx_att_date (date),
  KEY idx_att_tech (technician_id),
  KEY idx_att_date_tech (date, technician_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- Default superuser — username: admin / password: admin123 (ganti setelah login pertama)
INSERT INTO users (id, username, password, name, level, active, created_at)
VALUES (
  'U-admin',
  'admin',
  '$2y$10$iv/T2m/8V2Mik9fbEjP.u.M/KebiTSZXvqxFbNN/13z.r3aDUA1yO',
  'Administrator',
  'superuser',
  1,
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE username = username;
