<?php
declare(strict_types=1);

final class TechniciansService
{
  public static function create(array $input): array
  {
    $name = trim((string) ($input['name'] ?? ''));
    $skill = trim((string) ($input['skill'] ?? ''));
    $phone = trim((string) ($input['phone'] ?? ''));
    if ($name === '' || $skill === '' || $phone === '') {
      throw new RuntimeException('name, skill, phone wajib diisi');
    }
    $status = ((string) ($input['status'] ?? '')) === 'offline' ? 'offline' : 'available';
    $id = Uuid::v4();
    Db::pdo()->prepare(
      'INSERT INTO technicians (id, name, skill, status, current_job_id, phone) VALUES (?,?,?,?,?,?)'
    )->execute([$id, $name, $skill, $status, '', $phone]);

    return [
      'id' => $id,
      'name' => $name,
      'skill' => $skill,
      'status' => $status,
      'current_job_id' => '',
      'phone' => $phone,
    ];
  }

  public static function update(string $id, array $input): array
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM technicians WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) throw new RuntimeException('Technician not found');
    $tech = Mappers::technician($row);

    // Status-only mode
    if (
      isset($input['status'])
      && !isset($input['name'])
      && !isset($input['skill'])
      && !isset($input['phone'])
    ) {
      $status = (string) $input['status'];
      if (!in_array($status, ['available', 'busy', 'offline'], true)) {
        throw new RuntimeException('status tidak valid');
      }
      if ($tech['status'] === 'busy' && $status !== 'busy') {
        throw new RuntimeException('Teknisi busy — selesaikan job dulu');
      }
      Db::pdo()->prepare('UPDATE technicians SET status = ? WHERE id = ?')
        ->execute([$status, $id]);
      $tech['status'] = $status;
      return $tech;
    }

    $name = trim((string) ($input['name'] ?? ''));
    $skill = trim((string) ($input['skill'] ?? ''));
    $phone = trim((string) ($input['phone'] ?? ''));
    if ($name === '' || $skill === '' || $phone === '') {
      throw new RuntimeException('name, skill, phone wajib diisi');
    }
    $status = $tech['status'];
    if (isset($input['status'])) {
      $s = (string) $input['status'];
      if (!in_array($s, ['available', 'offline'], true)) {
        throw new RuntimeException('status profil hanya available/offline');
      }
      if ($tech['status'] === 'busy') {
        throw new RuntimeException('Teknisi busy — selesaikan job dulu');
      }
      $status = $s;
    }

    Db::pdo()->prepare(
      'UPDATE technicians SET name=?, skill=?, phone=?, status=? WHERE id=?'
    )->execute([$name, $skill, $phone, $status, $id]);

    return [
      'id' => $id,
      'name' => $name,
      'skill' => $skill,
      'status' => $status,
      'current_job_id' => $tech['current_job_id'],
      'phone' => $phone,
    ];
  }

  public static function delete(string $id): void
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM technicians WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) throw new RuntimeException('Technician not found');
    if ($row['status'] === 'busy') {
      throw new RuntimeException('Tidak bisa hapus teknisi yang busy');
    }
    $active = Db::pdo()->prepare(
      "SELECT a.id FROM job_assignees a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.technician_id = ? AND j.status NOT IN ('done','cancelled') LIMIT 1"
    );
    $active->execute([$id]);
    if ($active->fetch()) {
      throw new RuntimeException('Teknisi masih ter-assign di job aktif');
    }
    Db::pdo()->prepare('DELETE FROM technicians WHERE id = ?')->execute([$id]);
  }
}
