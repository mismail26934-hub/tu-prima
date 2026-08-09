<?php
declare(strict_types=1);

final class DashboardService
{
  public static function get(string $level): array
  {
    $techs = JobRepository::allTechnicians();
    $jobs = JobRepository::allJobs();
    $steps = JobRepository::stepsForJobs();
    $events = JobRepository::eventsForJobs();
    $assignees = JobRepository::allAssignees();
    $units = JobRepository::allUnits();

    if ($level === 'teknisi' || $level === 'guest') {
      $units = [];
    }

    $detailed = array_map(
      fn($j) => JobRepository::enrich($j, $techs, $steps, $events, $assignees),
      $jobs
    );

    $today = gmdate('Y-m-d');
    $doneToday = array_values(array_filter(
      $detailed,
      fn($j) => $j['status'] === 'done' && str_starts_with((string) $j['completed_at'], $today)
    ));
    $avg = 0;
    if ($doneToday) {
      $sum = array_sum(array_map(fn($j) => (int) $j['elapsed_sec'], $doneToday));
      $avg = (int) round($sum / count($doneToday));
    }

    $attendance = AttendanceService::list();

    return [
      'technicians' => $techs,
      'units' => $units,
      'jobs' => $detailed,
      'attendance' => $attendance,
      'summary' => [
        'available' => count(array_filter($techs, fn($t) => $t['status'] === 'available')),
        'busy' => count(array_filter($techs, fn($t) => $t['status'] === 'busy')),
        'offline' => count(array_filter($techs, fn($t) => $t['status'] === 'offline')),
        'active_jobs' => count(array_filter(
          $detailed,
          fn($j) => in_array($j['status'], ['in_progress', 'paused', 'assigned'], true)
        )),
        'queued_jobs' => count(array_filter($detailed, fn($j) => $j['status'] === 'queued')),
        'done_today' => count($doneToday),
        'avg_duration_sec' => $avg,
      ],
    ];
  }
}
