<?php
declare(strict_types=1);

final class UnitsService
{
  public static function create(array $input): array
  {
    $code = strtoupper(trim((string) ($input['code'] ?? '')));
    $name = trim((string) ($input['name'] ?? ''));
    if ($code === '' || $name === '') {
      throw new RuntimeException('code dan name wajib diisi');
    }
    $exists = Db::pdo()->prepare('SELECT id FROM units WHERE code = ?');
    $exists->execute([$code]);
    if ($exists->fetch()) throw new RuntimeException("Kode unit {$code} sudah ada");

    $id = Uuid::v4();
    Db::pdo()->prepare(
      'INSERT INTO units (id, code, name, active) VALUES (?,?,?,1)'
    )->execute([$id, $code, $name]);

    return ['id' => $id, 'code' => $code, 'name' => $name, 'active' => '1'];
  }

  public static function update(string $id, array $input): array
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM units WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) throw new RuntimeException('Unit not found');

    $code = strtoupper(trim((string) ($input['code'] ?? '')));
    $name = trim((string) ($input['name'] ?? ''));
    if ($code === '' || $name === '') {
      throw new RuntimeException('code dan name wajib diisi');
    }
    $active = isset($input['active'])
      ? (((string) $input['active'] === '0') ? 0 : 1)
      : (int) $row['active'];

    $dup = Db::pdo()->prepare('SELECT id FROM units WHERE code = ? AND id <> ?');
    $dup->execute([$code, $id]);
    if ($dup->fetch()) throw new RuntimeException("Kode unit {$code} sudah ada");

    Db::pdo()->prepare(
      'UPDATE units SET code=?, name=?, active=? WHERE id=?'
    )->execute([$code, $name, $active, $id]);

    $unit = ['id' => $id, 'code' => $code, 'name' => $name, 'active' => $active ? '1' : '0'];
    $label = Mappers::unitLabel($unit);
    Db::pdo()->prepare('UPDATE jobs SET unit = ? WHERE unit_id = ?')->execute([$label, $id]);
    return $unit;
  }

  public static function delete(string $id): void
  {
    $stmt = Db::pdo()->prepare('SELECT id FROM units WHERE id = ?');
    $stmt->execute([$id]);
    if (!$stmt->fetch()) throw new RuntimeException('Unit not found');

    $used = Db::pdo()->prepare('SELECT id FROM jobs WHERE unit_id = ? LIMIT 1');
    $used->execute([$id]);
    if ($used->fetch()) {
      throw new RuntimeException('Unit masih dipakai oleh job');
    }
    Db::pdo()->prepare('DELETE FROM units WHERE id = ?')->execute([$id]);
  }
}
