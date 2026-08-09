<?php
declare(strict_types=1);

final class Auth
{
  private static ?array $user = null;
  private static bool $resolved = false;

  public static function user(): ?array
  {
    if (self::$resolved) return self::$user;
    self::$resolved = true;

    $header = $_SERVER['HTTP_AUTHORIZATION']
      ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
      ?? '';
    if (!preg_match('/Bearer\s+(\S+)/i', $header, $m)) {
      self::$user = null;
      return null;
    }

    $cfg = require __DIR__ . '/../config.php';
    $payload = Jwt::decode($m[1], $cfg['jwt_secret']);
    if (!$payload || empty($payload['sub'])) {
      self::$user = null;
      return null;
    }

    $stmt = Db::pdo()->prepare(
      'SELECT id, username, name, level, active, created_at FROM users WHERE id = ? LIMIT 1'
    );
    $stmt->execute([(string) $payload['sub']]);
    $row = $stmt->fetch();
    if (!$row || (int) $row['active'] !== 1) {
      self::$user = null;
      return null;
    }

    self::$user = self::publicUser($row);
    return self::$user;
  }

  public static function level(): string
  {
    $u = self::user();
    return $u['level'] ?? 'guest';
  }

  public static function requirePermission(string $resource, string $action): void
  {
    $level = self::level();
    if (!Permissions::can($level, $resource, $action)) {
      if ($level === 'guest') {
        Response::error('Silakan login untuk melakukan aksi ini', 401);
      }
      Response::error(
        "Akses {$action} {$resource} tidak diizinkan untuk level {$level}",
        403
      );
    }
  }

  public static function requireAssign(): void
  {
    $level = self::level();
    if (!Permissions::canAssign($level)) {
      if ($level === 'guest') {
        Response::error('Silakan login untuk melakukan aksi ini', 401);
      }
      Response::error(
        "Assign teknisi hanya untuk level superuser dan foreman (level Anda: {$level})",
        403
      );
    }
  }

  public static function requireJobProgress(): void
  {
    $level = self::level();
    if (!Permissions::canManageProgress($level)) {
      if ($level === 'guest') {
        Response::error('Silakan login untuk melakukan aksi ini', 401);
      }
      Response::error(
        "Start/pause/resume/selesaikan job hanya untuk level superuser dan foreman (level Anda: {$level})",
        403
      );
    }
  }

  public static function requireLogin(): array
  {
    $u = self::user();
    if (!$u) Response::error('Silakan login untuk melakukan aksi ini', 401);
    return $u;
  }

  public static function publicUser(array $row): array
  {
    return [
      'id' => (string) $row['id'],
      'username' => (string) $row['username'],
      'name' => (string) ($row['name'] ?? ''),
      'level' => Permissions::normalizeLevel((string) ($row['level'] ?? 'teknisi')),
      'active' => ((int) ($row['active'] ?? 1) === 0) ? '0' : '1',
      'created_at' => (string) ($row['created_at'] ?? ''),
    ];
  }

  /** Accept bcrypt hash OR legacy plaintext (for Excel migration). */
  public static function verifyPassword(string $plain, string $stored): bool
  {
    if ($stored !== '' && str_starts_with($stored, '$2')) {
      return password_verify($plain, $stored);
    }
    return hash_equals($stored, $plain);
  }
}
