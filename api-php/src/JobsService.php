<?php
declare(strict_types=1);

final class JobsService
{
  public static function create(array $input): array
  {
    $title = trim((string) ($input['title'] ?? ''));
    $unitId = trim((string) ($input['unit_id'] ?? ''));
    if ($title === '' || $unitId === '') {
      throw new RuntimeException('title dan unit wajib diisi');
    }

    $pdo = Db::pdo();
    $stmt = $pdo->prepare('SELECT * FROM units WHERE id = ? AND active = 1');
    $stmt->execute([$unitId]);
    $unitRow = $stmt->fetch();
    if (!$unitRow) throw new RuntimeException('Unit tidak ditemukan / nonaktif');
    $unit = Mappers::unit($unitRow);

    $count = (int) $pdo->query('SELECT COUNT(*) FROM jobs')->fetchColumn();
    $id = 'J' . str_pad((string) ($count + 1), 2, '0', STR_PAD_LEFT) . '-' . Uuid::short();
    $created = Duration::nowIso();
    $job = [
      'id' => $id,
      'title' => $title,
      'unit' => Mappers::unitLabel($unit),
      'unit_id' => $unit['id'],
      'description' => (string) ($input['description'] ?? ''),
      'status' => 'queued',
      'technician_id' => '',
      'created_at' => $created,
      'started_at' => '',
      'completed_at' => '',
      'paused_at' => '',
      'total_paused_sec' => 0,
      'estimated_minutes' => (int) ($input['estimated_minutes'] ?? 60) ?: 60,
    ];

    $pdo->prepare(
      'INSERT INTO jobs (id,title,unit,unit_id,description,status,technician_id,created_at,started_at,completed_at,paused_at,total_paused_sec,estimated_minutes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )->execute([
      $job['id'], $job['title'], $job['unit'], $job['unit_id'], $job['description'],
      $job['status'], $job['technician_id'], $job['created_at'], $job['started_at'],
      $job['completed_at'], $job['paused_at'], $job['total_paused_sec'], $job['estimated_minutes'],
    ]);

    $stepNames = $input['steps'] ?? null;
    if (!is_array($stepNames) || count($stepNames) === 0) {
      $stepNames = ['Diagnosis', 'Perbaikan', 'Test & QC'];
    }
    $ins = $pdo->prepare(
      'INSERT INTO job_steps (id, job_id, name, `order`, status, started_at, completed_at, duration_sec)
       VALUES (?,?,?,?,?,?,?,?)'
    );
    foreach (array_values($stepNames) as $i => $name) {
      $ins->execute([Uuid::v4(), $id, (string) $name, $i + 1, 'pending', '', '', 0]);
    }

    JobRepository::insertEvent($id, 'created', 'Job dibuat');
    return JobRepository::enrich($job);
  }

  public static function update(string $jobId, array $input): array
  {
    $job = JobRepository::findJob($jobId);
    if (!$job) throw new RuntimeException('Job not found');

    $title = trim((string) ($input['title'] ?? ''));
    $unitId = trim((string) ($input['unit_id'] ?? ''));
    if ($title === '' || $unitId === '') {
      throw new RuntimeException('title dan unit wajib diisi');
    }

    $stmt = Db::pdo()->prepare('SELECT * FROM units WHERE id = ?');
    $stmt->execute([$unitId]);
    $unitRow = $stmt->fetch();
    if (!$unitRow) throw new RuntimeException('Unit tidak ditemukan');
    $unit = Mappers::unit($unitRow);
    if ($unit['active'] !== '1' && $unit['id'] !== $job['unit_id']) {
      throw new RuntimeException('Unit nonaktif');
    }

    $job['title'] = $title;
    $job['unit_id'] = $unit['id'];
    $job['unit'] = Mappers::unitLabel($unit);
    $job['description'] = (string) ($input['description'] ?? $job['description']);
    if (isset($input['estimated_minutes'])) {
      $job['estimated_minutes'] = (int) $input['estimated_minutes'] ?: 60;
    }
    JobRepository::saveJob($job);

    $stepsInput = $input['steps'] ?? null;
    if (is_array($stepsInput) && count($stepsInput) > 0
      && in_array($job['status'], ['queued', 'assigned'], true)
    ) {
      $pdo = Db::pdo();
      $pdo->prepare('DELETE FROM job_steps WHERE job_id = ?')->execute([$jobId]);
      $ins = $pdo->prepare(
        'INSERT INTO job_steps (id, job_id, name, `order`, status, started_at, completed_at, duration_sec)
         VALUES (?,?,?,?,?,?,?,?)'
      );
      foreach (array_values($stepsInput) as $i => $name) {
        $ins->execute([Uuid::v4(), $jobId, (string) $name, $i + 1, 'pending', '', '', 0]);
      }
    }

    JobRepository::insertEvent($jobId, 'updated', 'Job diperbarui');
    return JobRepository::enrich($job);
  }

  public static function delete(string $jobId): void
  {
    $job = JobRepository::findJob($jobId);
    if (!$job) throw new RuntimeException('Job not found');
    $pdo = Db::pdo();
    JobRepository::releaseTechsFromJob($jobId);
    $pdo->prepare('DELETE FROM job_assignees WHERE job_id = ?')->execute([$jobId]);
    $pdo->prepare('DELETE FROM job_steps WHERE job_id = ?')->execute([$jobId]);
    $pdo->prepare('DELETE FROM job_events WHERE job_id = ?')->execute([$jobId]);
    $pdo->prepare('DELETE FROM jobs WHERE id = ?')->execute([$jobId]);
  }

  public static function action(string $jobId, string $action, array $payload = []): array
  {
    $pdo = Db::pdo();
    $pdo->beginTransaction();
    try {
      $job = JobRepository::findJob($jobId);
      if (!$job) throw new RuntimeException('Job not found');

      $techs = JobRepository::allTechnicians();
      $techById = [];
      foreach ($techs as $t) $techById[$t['id']] = $t;

      match ($action) {
        'assign' => self::doAssign($job, $payload, $techById),
        'start' => self::doStart($job, $payload, $techById),
        'pause' => self::doPause($job, $payload),
        'resume' => self::doResume($job, $payload),
        'complete_step' => self::doCompleteStep($job),
        'complete' => self::doComplete($job, $payload),
        'cancel' => self::doCancel($job, $payload),
        default => throw new RuntimeException('Invalid action'),
      };

      $pdo->commit();
      return JobRepository::enrich(JobRepository::findJob($jobId) ?? $job);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      throw $e;
    }
  }

  private static function doAssign(array &$job, array $payload, array &$techById): void
  {
    $ids = [];
    if (!empty($payload['technician_ids']) && is_array($payload['technician_ids'])) {
      $ids = array_map('strval', $payload['technician_ids']);
    } elseif (!empty($payload['technician_id'])) {
      $ids = [(string) $payload['technician_id']];
    }
    $ids = array_values(array_unique(array_filter($ids)));
    if (!$ids) throw new RuntimeException('Pilih minimal 1 teknisi');

    $assignable = ['queued', 'assigned', 'in_progress', 'paused'];
    if (!in_array($job['status'], $assignable, true)) {
      throw new RuntimeException('Job tidak bisa di-assign pada status ini');
    }

    $selected = [];
    foreach ($ids as $id) {
      if (!isset($techById[$id])) throw new RuntimeException("Technician {$id} not found");
      $tech = $techById[$id];
      $onThis = $tech['current_job_id'] === $job['id'];
      if (!$onThis && $tech['status'] !== 'available') {
        throw new RuntimeException("{$tech['name']} tidak available");
      }
      $selected[] = $tech;
    }

    $prevStatus = $job['status'];
    $pdo = Db::pdo();
    JobRepository::releaseTechsFromJob($job['id']);
    $pdo->prepare('DELETE FROM job_assignees WHERE job_id = ?')->execute([$job['id']]);

    $now = Duration::nowIso();
    $ins = $pdo->prepare(
      'INSERT INTO job_assignees (id, job_id, technician_id, assigned_at, is_lead) VALUES (?,?,?,?,?)'
    );
    $upd = $pdo->prepare(
      "UPDATE technicians SET status = 'busy', current_job_id = ? WHERE id = ?"
    );
    foreach ($selected as $i => $tech) {
      $upd->execute([$job['id'], $tech['id']]);
      $ins->execute([Uuid::v4(), $job['id'], $tech['id'], $now, $i === 0 ? 1 : 0]);
    }

    $job['technician_id'] = $selected[0]['id'];
    if ($prevStatus === 'queued') $job['status'] = 'assigned';
    JobRepository::saveJob($job);

    $names = implode(', ', array_map(fn($t) => $t['name'], $selected));
    $note = in_array($prevStatus, ['in_progress', 'paused'], true)
      ? "Teknisi diubah: {$names}"
      : "Diassign ke {$names}";
    JobRepository::insertEvent($job['id'], 'assigned', $note);
  }

  private static function doStart(array &$job, array $payload, array &$techById): void
  {
    $assignees = array_values(array_filter(
      JobRepository::allAssignees(),
      fn($a) => $a['job_id'] === $job['id']
    ));
    $assigneeIds = $assignees
      ? array_map(fn($a) => $a['technician_id'], $assignees)
      : ($job['technician_id'] ? [$job['technician_id']] : []);
    if (!$assigneeIds) throw new RuntimeException('Assign teknisi dulu');
    if (!in_array($job['status'], ['assigned', 'queued'], true)) {
      throw new RuntimeException('Job tidak bisa di-start');
    }

    $pdo = Db::pdo();
    $upd = $pdo->prepare(
      "UPDATE technicians SET status = 'busy', current_job_id = ? WHERE id = ?"
    );
    foreach ($assigneeIds as $id) {
      if (!isset($techById[$id])) throw new RuntimeException('Technician not found');
      $tech = $techById[$id];
      if ($job['status'] === 'queued' && $tech['status'] !== 'available') {
        throw new RuntimeException("{$tech['name']} tidak available");
      }
      $upd->execute([$job['id'], $id]);
    }

    if ($job['technician_id'] === '') $job['technician_id'] = $assigneeIds[0];
    $job['status'] = 'in_progress';
    $job['started_at'] = Duration::nowIso();
    $job['paused_at'] = '';
    JobRepository::saveJob($job);

    $steps = JobRepository::stepsForJobs($job['id']);
    foreach ($steps as $s) {
      if ($s['status'] === 'pending') {
        $pdo->prepare(
          "UPDATE job_steps SET status='in_progress', started_at=? WHERE id=?"
        )->execute([Duration::nowIso(), $s['id']]);
        JobRepository::insertEvent($job['id'], 'step_started', $s['name']);
        break;
      }
    }
    JobRepository::insertEvent(
      $job['id'],
      'started',
      (string) ($payload['note'] ?? 'Pekerjaan dimulai')
    );
  }

  private static function doPause(array &$job, array $payload): void
  {
    if ($job['status'] !== 'in_progress') {
      throw new RuntimeException('Hanya job in_progress yang bisa di-pause');
    }
    $job['status'] = 'paused';
    $job['paused_at'] = Duration::nowIso();
    JobRepository::saveJob($job);
    JobRepository::insertEvent($job['id'], 'paused', (string) ($payload['note'] ?? 'Job dipause'));
  }

  private static function doResume(array &$job, array $payload): void
  {
    if ($job['status'] !== 'paused') {
      throw new RuntimeException('Hanya job paused yang bisa di-resume');
    }
    $pausedAt = $job['paused_at'] ? strtotime($job['paused_at']) : time();
    $extra = max(0, (int) floor(time() - $pausedAt));
    $job['total_paused_sec'] = (int) $job['total_paused_sec'] + $extra;
    $job['paused_at'] = '';
    $job['status'] = 'in_progress';
    JobRepository::saveJob($job);
    JobRepository::insertEvent($job['id'], 'resumed', (string) ($payload['note'] ?? 'Job dilanjutkan'));
  }

  private static function doCompleteStep(array &$job): void
  {
    if ($job['status'] !== 'in_progress') {
      throw new RuntimeException('Job harus in_progress');
    }
    $steps = JobRepository::stepsForJobs($job['id']);
    $current = null;
    foreach ($steps as $s) {
      if ($s['status'] === 'in_progress') {
        $current = $s;
        break;
      }
    }
    if (!$current) throw new RuntimeException('Tidak ada step aktif');

    $duration = 0;
    if ($current['started_at']) {
      $duration = max(0, (int) floor(time() - strtotime($current['started_at'])));
    }
    Db::pdo()->prepare(
      "UPDATE job_steps SET status='done', completed_at=?, duration_sec=? WHERE id=?"
    )->execute([Duration::nowIso(), $duration, $current['id']]);
    JobRepository::insertEvent($job['id'], 'step_completed', $current['name']);

    foreach ($steps as $s) {
      if ($s['id'] === $current['id']) continue;
      if ($s['status'] === 'pending') {
        Db::pdo()->prepare(
          "UPDATE job_steps SET status='in_progress', started_at=? WHERE id=?"
        )->execute([Duration::nowIso(), $s['id']]);
        JobRepository::insertEvent($job['id'], 'step_started', $s['name']);
        break;
      }
    }
  }

  private static function doComplete(array &$job, array $payload): void
  {
    if (!in_array($job['status'], ['in_progress', 'paused'], true)) {
      throw new RuntimeException('Job tidak bisa diselesaikan dari status ini');
    }
    if ($job['status'] === 'paused' && $job['paused_at']) {
      $extra = max(0, (int) floor(time() - strtotime($job['paused_at'])));
      $job['total_paused_sec'] = (int) $job['total_paused_sec'] + $extra;
      $job['paused_at'] = '';
    }

    $now = Duration::nowIso();
    foreach (JobRepository::stepsForJobs($job['id']) as $s) {
      if ($s['status'] === 'done') continue;
      $duration = (int) $s['duration_sec'];
      if ($s['status'] === 'in_progress' && $s['started_at']) {
        $duration = max(0, (int) floor(time() - strtotime($s['started_at'])));
      }
      Db::pdo()->prepare(
        "UPDATE job_steps SET status='done', completed_at=COALESCE(NULLIF(completed_at,''), ?), duration_sec=? WHERE id=?"
      )->execute([$now, $duration, $s['id']]);
    }

    $job['status'] = 'done';
    $job['completed_at'] = $now;
    JobRepository::saveJob($job);
    JobRepository::releaseTechsFromJob($job['id']);
    JobRepository::insertEvent($job['id'], 'completed', (string) ($payload['note'] ?? 'Job selesai'));
  }

  private static function doCancel(array &$job, array $payload): void
  {
    if (in_array($job['status'], ['done', 'cancelled'], true)) {
      throw new RuntimeException('Job sudah selesai/dibatalkan');
    }
    $job['status'] = 'cancelled';
    $job['completed_at'] = Duration::nowIso();
    JobRepository::saveJob($job);
    JobRepository::releaseTechsFromJob($job['id']);
    JobRepository::insertEvent($job['id'], 'cancelled', (string) ($payload['note'] ?? 'Job dibatalkan'));
  }
}
