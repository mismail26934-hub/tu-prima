<?php
declare(strict_types=1);

final class Request
{
  public static function method(): string
  {
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
  }

  public static function path(): string
  {
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = parse_url($uri, PHP_URL_PATH) ?: '/';
    // Strip common prefixes when deployed under /api or subdomain root
    $scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
    if ($scriptDir && $scriptDir !== '/' && str_starts_with($path, $scriptDir)) {
      $path = substr($path, strlen($scriptDir)) ?: '/';
    }
    $path = '/' . trim($path, '/');
    if ($path !== '/') $path = rtrim($path, '/');
    // Allow /api/... or /...
    if (str_starts_with($path, '/api/')) {
      $path = substr($path, 4) ?: '/';
    } elseif ($path === '/api') {
      $path = '/';
    }
    return $path === '' ? '/' : $path;
  }

  public static function json(): array
  {
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
  }

  public static function query(string $key, ?string $default = null): ?string
  {
    return isset($_GET[$key]) ? (string) $_GET[$key] : $default;
  }
}
