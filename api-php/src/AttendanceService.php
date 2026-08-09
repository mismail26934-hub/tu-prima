<?php
declare(strict_types=1);

final class AttendanceService
{
  public static function list(?string $date = null): array
  {
    if ($date) {
      $stmt = Db::pdo()->prepare(
        'SELECT * FROM attendance WHERE date = ? ORDER BY date DESC, technician_name'
      );
      $stmt->execute([$date]);
    } else {
      $stmt = Db::pdo()->query(
        'SELECT * FROM attendance ORDER BY date DESC, technician_name'
      );
    }
    return array_map([Mappers::class, 'attendance'], $stmt->fetchAll());
  }

  public static function create(array $input): array
  {
    $date = trim((string) ($input['date'] ?? ''));
    $name = trim((string) ($input['technician_name'] ?? ''));
    $status = (string) ($input['status'] ?? '');
    if ($date === '' || $name === '' || $status === '') {
      throw new RuntimeException('date, technician_name, status wajib');
    }
    $allowed = ['hadir', 'izin', 'sakit', 'off', 'alpha'];
    if (!in_array($status, $allowed, true)) {
      throw new RuntimeException('status tidak valid');
    }

    $techId = trim((string) ($input['technician_id'] ?? ''));
    self::assertNoDuplicate($date, $techId, $name);

    $row = [
      'id' => Uuid::v4(),
      'date' => $date,
      'technician_id' => $techId,
      'technician_name' => $name,
      'pernr' => (string) ($input['pernr'] ?? ''),
      'status' => $status,
      'dws' => (string) ($input['dws'] ?? ''),
      'check_in' => (string) ($input['check_in'] ?? ''),
      'check_out' => (string) ($input['check_out'] ?? ''),
      'absence' => (string) ($input['absence'] ?? ''),
      'note' => (string) ($input['note'] ?? ''),
    ];
    self::insert($row);
    return $row;
  }

  public static function update(string $id, array $input): array
  {
    $stmt = Db::pdo()->prepare('SELECT * FROM attendance WHERE id = ?');
    $stmt->execute([$id]);
    $existing = $stmt->fetch();
    if (!$existing) throw new RuntimeException('Attendance not found');

    $date = trim((string) ($input['date'] ?? ''));
    $name = trim((string) ($input['technician_name'] ?? ''));
    $status = (string) ($input['status'] ?? '');
    if ($date === '' || $name === '' || $status === '') {
      throw new RuntimeException('date, technician_name, status wajib');
    }

    $row = [
      'id' => $id,
      'date' => $date,
      'technician_id' => trim((string) ($input['technician_id'] ?? '')),
      'technician_name' => $name,
      'pernr' => (string) ($input['pernr'] ?? ''),
      'status' => $status,
      'dws' => (string) ($input['dws'] ?? ''),
      'check_in' => (string) ($input['check_in'] ?? ''),
      'check_out' => (string) ($input['check_out'] ?? ''),
      'absence' => (string) ($input['absence'] ?? ''),
      'note' => (string) ($input['note'] ?? ''),
    ];

    Db::pdo()->prepare(
      'UPDATE attendance SET date=?, technician_id=?, technician_name=?, pernr=?, status=?,
       dws=?, check_in=?, check_out=?, absence=?, note=? WHERE id=?'
    )->execute([
      $row['date'], $row['technician_id'], $row['technician_name'], $row['pernr'],
      $row['status'], $row['dws'], $row['check_in'], $row['check_out'],
      $row['absence'], $row['note'], $id,
    ]);
    return $row;
  }

  public static function delete(string $id): void
  {
    $stmt = Db::pdo()->prepare('DELETE FROM attendance WHERE id = ?');
    $stmt->execute([$id]);
    if ($stmt->rowCount() === 0) throw new RuntimeException('Attendance not found');
  }

  private static function assertNoDuplicate(string $date, string $techId, string $name): void
  {
    if ($techId !== '') {
      $stmt = Db::pdo()->prepare(
        'SELECT id FROM attendance WHERE date = ? AND technician_id = ? LIMIT 1'
      );
      $stmt->execute([$date, $techId]);
    } else {
      $stmt = Db::pdo()->prepare(
        'SELECT id FROM attendance WHERE date = ? AND technician_name = ? LIMIT 1'
      );
      $stmt->execute([$date, $name]);
    }
    if ($stmt->fetch()) {
      throw new RuntimeException('Data hadir untuk tanggal & teknisi ini sudah ada');
    }
  }

  private static function insert(array $row): void
  {
    Db::pdo()->prepare(
      'INSERT INTO attendance (id, date, technician_id, technician_name, pernr, status, dws, check_in, check_out, absence, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    )->execute([
      $row['id'], $row['date'], $row['technician_id'], $row['technician_name'],
      $row['pernr'], $row['status'], $row['dws'], $row['check_in'],
      $row['check_out'], $row['absence'], $row['note'],
    ]);
  }
}
