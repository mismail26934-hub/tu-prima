<?php
/**
 * Copy to config.php and fill Hostinger MySQL credentials.
 * Do NOT commit config.php to a public repo.
 */
return [
  'db' => [
    'host' => 'localhost',
    'name' => 'u123456789_prima',
    'user' => 'u123456789_prima',
    'pass' => 'GANTI_PASSWORD_DB',
    'charset' => 'utf8mb4',
  ],
  // Secret for JWT — generate long random string
  'jwt_secret' => 'GANTI_DENGAN_STRING_PANJANG_ACAK',
  'jwt_ttl_seconds' => 60 * 60 * 12, // 12 jam
  // Frontend origin(s) — VPS Next.js URL
  'cors_origins' => [
    'https://app.domainmu.com',
    'http://localhost:3000',
  ],
];
