<?php
declare(strict_types=1);

final class JobRepository
{
  public static function allJobs(): array
  {
    $rows = Db::pdo()->query('SELECT * FROM jobs ORDER BY created_at DESC')->fetchAll();
    return array_map([Mappers::class, 'job'], $rows);
  }

  public static function findJob(string $id): ?array
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM jobs WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? Mappers::job($row) : null;
  }

  public static function allTechnicians(): array
  {
    $rows = Db::pdo()->query('SELECT * FROM technicians ORDER BY name')->fetchAll();
    return array_map([Mappers::class, 'technician'], $rows);
  }

  public static function allUnits(): array
  {
    $rows = Db::pdo()->query('SELECT * FROM units ORDER BY code')->fetchAll();
    return array_map([Mappers::class, 'unit'], $rows);
  }

  public static function stepsForJobs(?string $jobId = null): array
  {
    if ($jobId) {
      $stmt = Db::pdo()->prepare('SELECT * FROM job_steps WHERE job_id = ? ORDER BY `order`');
      $stmt->execute([$jobId]);
    } else {
      $stmt = Db::pdo()->query('SELECT * FROM job_steps ORDER BY job_id, `order`');
    }
    return array_map([Mappers::class, 'step'], $stmt->fetchAll());
  }

  public static function eventsForJobs(?string $jobId = null): array
  {
    if ($jobId) {
      $stmt = Db::pdo()->prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at');
      $stmt->execute([$jobId]);
    } else {
      $stmt = Db::pdo()->query('SELECT * FROM job_events ORDER BY created_at');
    }
    return array_map([Mappers::class, 'event'], $stmt->fetchAll());
  }

  public static function allAssignees(): array
  {
    $rows = Db::pdo()->query('SELECT * FROM job_assignees')->fetchAll();
    return array_map([Mappers::class, 'assignee'], $rows);
  }

  public static function enrich(array $job, ?array $techs = null, ?array $steps = null, ?array $events = null, ?array $assignees = null): array
  {
    $techs = $techs ?? self::allTechnicians();
    $steps = $steps ?? self::stepsForJobs($job['id']);
    $events = $events ?? self::eventsForJobs($job['id']);
    $assignees = $assignees ?? self::allAssignees();

    $jobSteps = array_values(array_filter($steps, fn($s) => $s['job_id'] === $job['id']));
    usort($jobSteps, fn($a, $b) => $a['order'] <=> $b['order']);

    $jobEvents = array_values(array_filter($events, fn($e) => $e['job_id'] === $job['id']));
    usort($jobEvents, fn($a, $b) => strcmp($a['created_at'], $b['created_at']));

    $jobAssigneeRows = array_values(array_filter($assignees, fn($a) => $a['job_id'] === $job['id']));
    if (!$jobAssigneeRows && $job['technician_id']) {
      $jobAssigneeRows = [[
        'id' => '',
        'job_id' => $job['id'],
        'technician_id' => $job['technician_id'],
        'assigned_at' => $job['created_at'],
        'is_lead' => '1',
      ]];
    }

    $technicians = [];
    foreach ($jobAssigneeRows as $a) {
      foreach ($techs as $t) {
        if ($t['id'] === $a['technician_id']) {
          $technicians[] = $t;
          break;
        }
      }
    }

    $technician = null;
    foreach ($technicians as $t) {
      if ($t['id'] === $job['technician_id']) {
        $technician = $t;
        break;
      }
    }
    if (!$technician) $technician = $technicians[0] ?? null;

    $current = null;
    foreach ($jobSteps as $s) {
      if ($s['status'] === 'in_progress') {
        $current = $s;
        break;
      }
    }

    return array_merge($job, [
      'technician' => $technician,
      'technicians' => $technicians,
      'steps' => $jobSteps,
      'events' => $jobEvents,
      'elapsed_sec' => Duration::calcElapsedSec($job),
      'progress_pct' => Duration::calcProgressPct($jobSteps),
      'current_step' => $current,
    ]);
  }

  public static function releaseTechsFromJob(string $jobId): void
  {
    $pdo = Db::pdo();
    $stmt = $pdo->prepare(
      "UPDATE technicians SET status = 'available', current_job_id = ''
       WHERE current_job_id = ?"
    );
    $stmt->execute([$jobId]);
  }

  public static function saveJob(array $job): void
  {
    $sql = 'UPDATE jobs SET title=?, unit=?, unit_id=?, description=?, status=?, technician_id=?,
      started_at=?, completed_at=?, paused_at=?, total_paused_sec=?, estimated_minutes=? WHERE id=?';
    Db::pdo()->prepare($sql)->execute([
      $job['title'], $job['unit'], $job['unit_id'], $job['description'], $job['status'],
      $job['technician_id'], $job['started_at'], $job['completed_at'], $job['paused_at'],
      $job['total_paused_sec'], $job['estimated_minutes'], $job['id'],
    ]);
  }

  public static function insertEvent(string $jobId, string $type, string $note): void
  {
    Db::pdo()->prepare(
      'INSERT INTO job_events (id, job_id, type, note, created_at) VALUES (?,?,?,?,?)'
    )->execute([Uuid::v4(), $jobId, $type, $note, Duration::nowIso()]);
  }
}
