<?php
declare(strict_types=1);

/** Minimal HS256 JWT — no Composer required. */
final class Jwt
{
  public static function encode(array $payload, string $secret, int $ttl): string
  {
    $header = ['typ' => 'JWT', 'alg' => 'HS256'];
    $now = time();
    $payload['iat'] = $now;
    $payload['exp'] = $now + $ttl;

    $segments = [
      self::b64(json_encode($header, JSON_UNESCAPED_SLASHES)),
      self::b64(json_encode($payload, JSON_UNESCAPED_SLASHES)),
    ];
    $signing = implode('.', $segments);
    $sig = hash_hmac('sha256', $signing, $secret, true);
    $segments[] = self::b64($sig);
    return implode('.', $segments);
  }

  public static function decode(string $token, string $secret): ?array
  {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$h, $p, $s] = $parts;
    $expected = self::b64(hash_hmac('sha256', "{$h}.{$p}", $secret, true));
    if (!hash_equals($expected, $s)) return null;
    $payload = json_decode(self::ub64($p), true);
    if (!is_array($payload)) return null;
    if (($payload['exp'] ?? 0) < time()) return null;
    return $payload;
  }

  private static function b64(string $data): string
  {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
  }

  private static function ub64(string $data): string
  {
    $remainder = strlen($data) % 4;
    if ($remainder) $data .= str_repeat('=', 4 - $remainder);
    return base64_decode(strtr($data, '-_', '+/')) ?: '';
  }
}
