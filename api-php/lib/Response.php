<?php
declare(strict_types=1);

final class Response
{
  public static function json(mixed $data, int $status = 200): never
  {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
  }

  public static function error(string $message, int $status = 400): never
  {
    self::json(['error' => $message], $status);
  }

  public static function ok(): never
  {
    self::json(['ok' => true]);
  }
}
