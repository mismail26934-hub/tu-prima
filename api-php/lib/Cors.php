<?php
declare(strict_types=1);

final class Cors
{
  public static function apply(): void
  {
    $cfg = require __DIR__ . '/../config.php';
    $origins = $cfg['cors_origins'] ?? [];
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin && in_array($origin, $origins, true)) {
      header("Access-Control-Allow-Origin: {$origin}");
      header('Access-Control-Allow-Credentials: true');
      header('Vary: Origin');
    } elseif (count($origins) === 1) {
      header('Access-Control-Allow-Origin: ' . $origins[0]);
      header('Access-Control-Allow-Credentials: true');
    }

    header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Max-Age: 86400');

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
      http_response_code(204);
      exit;
    }
  }
}
