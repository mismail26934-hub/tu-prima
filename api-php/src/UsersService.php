<?php
declare(strict_types=1);

final class UsersService
{
  public static function list(): array
  {
    $rows = Db::pdo()->query(
      'SELECT id, username, name, level, active, created_at FROM users ORDER BY username'
    )->fetchAll();
    return array_map([Auth::class, 'publicUser'], $rows);
  }

  public static function create(array $input): array
  {
    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    if ($username === '' || $password === '') {
      throw new RuntimeException('username dan password wajib');
    }
    if (strlen($password) < 6) {
      throw new RuntimeException('Password minimal 6 karakter');
    }
    $dup = Db::pdo()->prepare('SELECT id FROM users WHERE username = ?');
    $dup->execute([$username]);
    if ($dup->fetch()) throw new RuntimeException('Username sudah dipakai');

    $level = Permissions::normalizeLevel((string) ($input['level'] ?? 'teknisi'));
    $active = isset($input['active']) && (string) $input['active'] === '0' ? 0 : 1;
    $id = Uuid::v4();
    $created = Duration::nowIso();
    Db::pdo()->prepare(
      'INSERT INTO users (id, username, password, name, level, active, created_at) VALUES (?,?,?,?,?,?,?)'
    )->execute([
      $id,
      $username,
      password_hash($password, PASSWORD_DEFAULT),
      trim((string) ($input['name'] ?? '')),
      $level,
      $active,
      $created,
    ]);

    return Auth::publicUser([
      'id' => $id,
      'username' => $username,
      'name' => trim((string) ($input['name'] ?? '')),
      'level' => $level,
      'active' => $active,
      'created_at' => $created,
    ]);
  }

  public static function update(string $id, array $input): array
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) throw new RuntimeException('User not found');

    $username = array_key_exists('username', $input)
      ? trim((string) $input['username'])
      : (string) $row['username'];
    $name = array_key_exists('name', $input)
      ? trim((string) $input['name'])
      : (string) $row['name'];
    $level = array_key_exists('level', $input)
      ? Permissions::normalizeLevel((string) $input['level'])
      : (string) $row['level'];
    $active = array_key_exists('active', $input)
      ? (((string) $input['active'] === '0') ? 0 : 1)
      : (int) $row['active'];

    if ($username === '') throw new RuntimeException('username wajib');

    $dup = Db::pdo()->prepare('SELECT id FROM users WHERE username = ? AND id <> ?');
    $dup->execute([$username, $id]);
    if ($dup->fetch()) throw new RuntimeException('Username sudah dipakai');

    self::guardLastSuperuser($id, $level, $active);

    $passwordSql = '';
    $params = [$username, $name, $level, $active];
    if (!empty($input['password'])) {
      $pw = (string) $input['password'];
      if (strlen($pw) < 6) throw new RuntimeException('Password minimal 6 karakter');
      $passwordSql = ', password=?';
      $params[] = password_hash($pw, PASSWORD_DEFAULT);
    }
    $params[] = $id;
    Db::pdo()->prepare(
      "UPDATE users SET username=?, name=?, level=?, active=?{$passwordSql} WHERE id=?"
    )->execute($params);

    return Auth::publicUser([
      'id' => $id,
      'username' => $username,
      'name' => $name,
      'level' => $level,
      'active' => $active,
      'created_at' => $row['created_at'],
    ]);
  }

  public static function delete(string $id): void
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) throw new RuntimeException('User not found');

    self::guardLastSuperuser($id, 'teknisi', 0, true);

    $activeCount = (int) Db::pdo()->query(
      'SELECT COUNT(*) FROM users WHERE active = 1'
    )->fetchColumn();
    if ((int) $row['active'] === 1 && $activeCount <= 1) {
      throw new RuntimeException('Tidak bisa hapus user aktif terakhir');
    }

    Db::pdo()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
  }

  public static function changePassword(string $userId, array $input): void
  {
    $current = (string) ($input['currentPassword'] ?? '');
    $new = (string) ($input['newPassword'] ?? '');
    $confirm = (string) ($input['confirmPassword'] ?? '');
    if ($current === '' || $new === '' || $confirm === '') {
      throw new RuntimeException('Semua field password wajib diisi');
    }
    if ($new !== $confirm) throw new RuntimeException('Konfirmasi password tidak cocok');
    if (strlen($new) < 6) throw new RuntimeException('Password baru minimal 6 karakter');
    if ($new === $current) throw new RuntimeException('Password baru harus berbeda');

    $stmt = Db::pdo()->prepare('SELECT password FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row) throw new RuntimeException('User not found');
    if (!Auth::verifyPassword($current, (string) $row['password'])) {
      throw new RuntimeException('Password saat ini salah');
    }
    Db::pdo()->prepare('UPDATE users SET password = ? WHERE id = ?')
      ->execute([password_hash($new, PASSWORD_DEFAULT), $userId]);
  }

  public static function login(string $username, string $password): array
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([trim($username)]);
    $row = $stmt->fetch();
    if (!$row || (int) $row['active'] !== 1) {
      throw new RuntimeException('Username atau password salah');
    }
    if (!Auth::verifyPassword($password, (string) $row['password'])) {
      throw new RuntimeException('Username atau password salah');
    }

    // Upgrade plaintext → bcrypt on successful login
    if (!str_starts_with((string) $row['password'], '$2')) {
      Db::pdo()->prepare('UPDATE users SET password = ? WHERE id = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
    }

    $user = Auth::publicUser($row);
    $cfg = require __DIR__ . '/../config.php';
    $token = Jwt::encode(
      ['sub' => $user['id'], 'level' => $user['level'], 'username' => $user['username']],
      $cfg['jwt_secret'],
      (int) ($cfg['jwt_ttl_seconds'] ?? 43200)
    );
    return ['token' => $token, 'user' => $user];
  }

  private static function guardLastSuperuser(
    string $id,
    string $newLevel,
    int $newActive,
    bool $deleting = false
  ): void {
    $stmt = Db::pdo()->prepare(
      "SELECT id FROM users WHERE level = 'superuser' AND active = 1"
    );
    $stmt->execute();
    $supers = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $isOnly = count($supers) === 1 && in_array($id, $supers, true);
    if (!$isOnly) return;

    if ($deleting || $newActive === 0 || $newLevel !== 'superuser') {
      throw new RuntimeException('Minimal satu superuser aktif harus tersisa');
    }
  }
}
