<?php
declare(strict_types=1);

final class Permissions
{
  public const LEVELS = ['superuser', 'inputer', 'teknisi', 'foreman', 'hrd', 'spv'];

  private static function matrix(): array
  {
    $crud = ['create', 'read', 'update', 'delete'];
    $read = ['read'];
    $none = [];
    return [
      'guest' => [
        'job' => $read, 'user' => $read, 'technician' => $read,
        'unit' => $none, 'attendance' => $read,
      ],
      'superuser' => [
        'job' => $crud, 'user' => $crud, 'technician' => $crud,
        'unit' => $crud, 'attendance' => $crud,
      ],
      'inputer' => [
        'job' => $crud, 'user' => $read, 'technician' => $read,
        'unit' => $crud, 'attendance' => $read,
      ],
      'teknisi' => [
        'job' => $read, 'user' => $read, 'technician' => $read,
        'unit' => $none, 'attendance' => $read,
      ],
      'foreman' => [
        'job' => $crud, 'user' => $read, 'technician' => $read,
        'unit' => $crud, 'attendance' => $read,
      ],
      'hrd' => [
        'job' => $read, 'user' => $read, 'technician' => $read,
        'unit' => $read, 'attendance' => $crud,
      ],
      'spv' => [
        'job' => $crud, 'user' => $read, 'technician' => $read,
        'unit' => $crud, 'attendance' => $read,
      ],
    ];
  }

  public static function can(?string $level, string $resource, string $action): bool
  {
    $level = $level ?: 'guest';
    $matrix = self::matrix();
    return in_array($action, $matrix[$level][$resource] ?? [], true);
  }

  public static function canAssign(?string $level): bool
  {
    return $level === 'superuser' || $level === 'foreman';
  }

  public static function canManageProgress(?string $level): bool
  {
    return $level === 'superuser' || $level === 'foreman';
  }

  public static function normalizeLevel(string $raw, string $fallback = 'teknisi'): string
  {
    $raw = strtolower(trim($raw));
    return in_array($raw, self::LEVELS, true) ? $raw : $fallback;
  }
}
