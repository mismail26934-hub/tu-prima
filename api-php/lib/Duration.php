<?php
declare(strict_types=1);

final class Duration
{
  public static function nowIso(): string
  {
    return gmdate('Y-m-d\TH:i:s.000\Z');
  }

  public static function calcElapsedSec(array $job, ?int $at = null): int
  {
    $at = $at ?? time();
    $started = self::parse($job['started_at'] ?? '');
    if ($started === null) return 0;

    $end = $at;
    $status = $job['status'] ?? '';
    if (in_array($status, ['done', 'cancelled'], true)) {
      $completed = self::parse($job['completed_at'] ?? '');
      if ($completed !== null) $end = $completed;
    }

    $pausedExtra = 0;
    if ($status === 'paused') {
      $pausedAt = self::parse($job['paused_at'] ?? '');
      if ($pausedAt !== null) {
        $pausedExtra = max(0, $at - $pausedAt);
      }
    }

    $raw = max(0, $end - $started);
    return (int) floor($raw - (int) ($job['total_paused_sec'] ?? 0) - $pausedExtra);
  }

  public static function calcProgressPct(array $steps): int
  {
    if (!$steps) return 0;
    $done = 0;
    $inProgress = 0;
    foreach ($steps as $s) {
      if (($s['status'] ?? '') === 'done') $done++;
      if (($s['status'] ?? '') === 'in_progress') $inProgress = 0.5;
    }
    return (int) min(100, round((($done + $inProgress) / count($steps)) * 100));
  }

  private static function parse(string $value): ?int
  {
    if ($value === '') return null;
    $t = strtotime($value);
    return $t === false ? null : $t;
  }
}
