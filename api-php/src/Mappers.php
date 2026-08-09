<?php
declare(strict_types=1);

final class Mappers
{
  public static function unit(array $r): array
  {
    return [
      'id' => (string) $r['id'],
      'code' => (string) $r['code'],
      'name' => (string) ($r['name'] ?? ''),
      'active' => ((int) ($r['active'] ?? 1) === 0) ? '0' : '1',
    ];
  }

  public static function technician(array $r): array
  {
    return [
      'id' => (string) $r['id'],
      'name' => (string) $r['name'],
      'skill' => (string) ($r['skill'] ?? ''),
      'status' => (string) ($r['status'] ?? 'available'),
      'current_job_id' => (string) ($r['current_job_id'] ?? ''),
      'phone' => (string) ($r['phone'] ?? ''),
    ];
  }

  public static function job(array $r): array
  {
    return [
      'id' => (string) $r['id'],
      'title' => (string) $r['title'],
      'unit' => (string) ($r['unit'] ?? ''),
      'unit_id' => (string) ($r['unit_id'] ?? ''),
      'description' => (string) ($r['description'] ?? ''),
      'status' => (string) ($r['status'] ?? 'queued'),
      'technician_id' => (string) ($r['technician_id'] ?? ''),
      'created_at' => (string) ($r['created_at'] ?? ''),
      'started_at' => (string) ($r['started_at'] ?? ''),
      'completed_at' => (string) ($r['completed_at'] ?? ''),
      'paused_at' => (string) ($r['paused_at'] ?? ''),
      'total_paused_sec' => (int) ($r['total_paused_sec'] ?? 0),
      'estimated_minutes' => (int) ($r['estimated_minutes'] ?? 60),
    ];
  }

  public static function step(array $r): array
  {
    return [
      'id' => (string) $r['id'],
      'job_id' => (string) $r['job_id'],
      'name' => (string) $r['name'],
      'order' => (int) ($r['order'] ?? 0),
      'status' => (string) ($r['status'] ?? 'pending'),
      'started_at' => (string) ($r['started_at'] ?? ''),
      'completed_at' => (string) ($r['completed_at'] ?? ''),
      'duration_sec' => (int) ($r['duration_sec'] ?? 0),
    ];
  }

  public static function event(array $r): array
  {
    return [
      'id' => (string) $r['id'],
      'job_id' => (string) $r['job_id'],
      'type' => (string) $r['type'],
      'note' => (string) ($r['note'] ?? ''),
      'created_at' => (string) ($r['created_at'] ?? ''),
    ];
  }

  public static function assignee(array $r): array
  {
    return [
      'id' => (string) $r['id'],
      'job_id' => (string) $r['job_id'],
      'technician_id' => (string) $r['technician_id'],
      'assigned_at' => (string) ($r['assigned_at'] ?? ''),
      'is_lead' => ((int) ($r['is_lead'] ?? 0) === 1) ? '1' : '0',
    ];
  }

  public static function attendance(array $r): array
  {
    $allowed = ['hadir', 'izin', 'sakit', 'off', 'alpha'];
    $status = (string) ($r['status'] ?? 'alpha');
    if (!in_array($status, $allowed, true)) $status = 'alpha';
    return [
      'id' => (string) $r['id'],
      'date' => (string) $r['date'],
      'technician_id' => (string) ($r['technician_id'] ?? ''),
      'technician_name' => (string) ($r['technician_name'] ?? ''),
      'pernr' => (string) ($r['pernr'] ?? ''),
      'status' => $status,
      'dws' => (string) ($r['dws'] ?? ''),
      'check_in' => (string) ($r['check_in'] ?? ''),
      'check_out' => (string) ($r['check_out'] ?? ''),
      'absence' => (string) ($r['absence'] ?? ''),
      'note' => (string) ($r['note'] ?? ''),
    ];
  }

  public static function unitLabel(array $u): string
  {
    $name = trim((string) ($u['name'] ?? ''));
    $code = (string) $u['code'];
    return $name !== '' ? "{$code} — {$name}" : $code;
  }
}
