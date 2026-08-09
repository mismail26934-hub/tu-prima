<?php
declare(strict_types=1);

/**
 * PRIMA API — PHP native front controller
 * Upload isi folder api-php/ ke document root subdomain api.domainmu.com
 */

header('X-Content-Type-Options: nosniff');

spl_autoload_register(function (string $class): void {
  foreach ([__DIR__ . '/lib/' . $class . '.php', __DIR__ . '/src/' . $class . '.php'] as $file) {
    if (is_file($file)) {
      require_once $file;
      return;
    }
  }
});

if (!is_file(__DIR__ . '/config.php')) {
  http_response_code(500);
  header('Content-Type: application/json');
  echo json_encode([
    'error' => 'config.php belum ada. Copy config.example.php → config.php dan isi kredensial.',
  ]);
  exit;
}

Cors::apply();

$method = Request::method();
$path = Request::path();

try {
  route($method, $path);
} catch (Throwable $e) {
  $status = 400;
  $msg = $e->getMessage();
  if (str_contains($msg, 'not found') || str_contains($msg, 'tidak ditemukan')) {
    $status = 400;
  }
  Response::error($msg ?: 'Request failed', $status);
}

function route(string $method, string $path): void
{
  // Health
  if ($method === 'GET' && ($path === '/' || $path === '/health')) {
    Response::json(['ok' => true, 'service' => 'prima-api', 'time' => Duration::nowIso()]);
  }

  // Auth
  if ($method === 'POST' && $path === '/auth/login') {
    $body = Request::json();
    $username = (string) ($body['username'] ?? '');
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
      Response::error('username dan password wajib', 400);
    }
    try {
      Response::json(UsersService::login($username, $password));
    } catch (Throwable $e) {
      Response::error($e->getMessage(), 401);
    }
  }

  if ($method === 'GET' && $path === '/auth/me') {
    $user = Auth::requireLogin();
    Response::json(['user' => $user]);
  }

  // Dashboard
  if ($method === 'GET' && $path === '/dashboard') {
    Auth::requirePermission('job', 'read');
    Response::json(DashboardService::get(Auth::level()));
  }

  // Jobs collection
  if ($path === '/jobs') {
    if ($method === 'GET') {
      Auth::requirePermission('job', 'read');
      $techs = JobRepository::allTechnicians();
      $steps = JobRepository::stepsForJobs();
      $events = JobRepository::eventsForJobs();
      $assignees = JobRepository::allAssignees();
      $jobs = array_map(
        fn($j) => JobRepository::enrich($j, $techs, $steps, $events, $assignees),
        JobRepository::allJobs()
      );
      Response::json(['jobs' => $jobs]);
    }
    if ($method === 'POST') {
      Auth::requirePermission('job', 'create');
      try {
        Response::json(JobsService::create(Request::json()), 200);
      } catch (Throwable $e) {
        Response::error($e->getMessage(), 500);
      }
    }
  }

  // Jobs /{id}/action
  if (preg_match('#^/jobs/([^/]+)/action$#', $path, $m) && $method === 'POST') {
    $body = Request::json();
    $action = (string) ($body['action'] ?? '');
    $allowed = ['assign', 'start', 'pause', 'resume', 'complete_step', 'complete', 'cancel'];
    if (!in_array($action, $allowed, true)) {
      Response::error('Invalid action', 400);
    }
    if ($action === 'assign') {
      Auth::requireAssign();
    } elseif (in_array($action, ['start', 'pause', 'resume', 'complete_step', 'complete'], true)) {
      Auth::requireJobProgress();
    } else {
      Auth::requirePermission('job', 'update');
    }
    Response::json(JobsService::action($m[1], $action, $body));
  }

  // Jobs /{id}
  if (preg_match('#^/jobs/([^/]+)$#', $path, $m)) {
    $id = $m[1];
    if ($method === 'GET') {
      Auth::requirePermission('job', 'read');
      $job = JobRepository::findJob($id);
      if (!$job) Response::error('Job not found', 400);
      Response::json(JobRepository::enrich($job));
    }
    if ($method === 'PATCH') {
      Auth::requirePermission('job', 'update');
      Response::json(JobsService::update($id, Request::json()));
    }
    if ($method === 'DELETE') {
      Auth::requirePermission('job', 'delete');
      JobsService::delete($id);
      Response::ok();
    }
  }

  // Units
  if ($path === '/units') {
    if ($method === 'GET') {
      Auth::requirePermission('unit', 'read');
      Response::json(['units' => JobRepository::allUnits()]);
    }
    if ($method === 'POST') {
      Auth::requirePermission('unit', 'create');
      Response::json(UnitsService::create(Request::json()));
    }
  }

  if ($path === '/units/import' && $method === 'POST') {
    Auth::requirePermission('unit', 'create');
    Response::error(
      'Import Excel belum diaktifkan di API PHP. Install PhpSpreadsheet atau gunakan CRUD manual / migrasi SQL.',
      501
    );
  }

  if ($path === '/units/template' && $method === 'GET') {
    Auth::requirePermission('unit', 'create');
    Response::error('Template Excel belum diaktifkan di API PHP (butuh PhpSpreadsheet).', 501);
  }

  if (preg_match('#^/units/([^/]+)$#', $path, $m)) {
    $id = $m[1];
    if ($method === 'PATCH') {
      Auth::requirePermission('unit', 'update');
      Response::json(UnitsService::update($id, Request::json()));
    }
    if ($method === 'DELETE') {
      Auth::requirePermission('unit', 'delete');
      UnitsService::delete($id);
      Response::ok();
    }
  }

  // Technicians
  if ($path === '/technicians') {
    if ($method === 'GET') {
      Auth::requirePermission('technician', 'read');
      Response::json(['technicians' => JobRepository::allTechnicians()]);
    }
    if ($method === 'POST') {
      Auth::requirePermission('technician', 'create');
      Response::json(TechniciansService::create(Request::json()));
    }
  }

  if ($path === '/technicians/import' && $method === 'POST') {
    Auth::requirePermission('technician', 'create');
    Response::error('Import Excel belum diaktifkan di API PHP (butuh PhpSpreadsheet).', 501);
  }

  if ($path === '/technicians/template' && $method === 'GET') {
    Auth::requirePermission('technician', 'create');
    Response::error('Template Excel belum diaktifkan di API PHP (butuh PhpSpreadsheet).', 501);
  }

  if (preg_match('#^/technicians/([^/]+)$#', $path, $m)) {
    $id = $m[1];
    if ($method === 'PATCH') {
      Auth::requirePermission('technician', 'update');
      Response::json(TechniciansService::update($id, Request::json()));
    }
    if ($method === 'DELETE') {
      Auth::requirePermission('technician', 'delete');
      TechniciansService::delete($id);
      Response::ok();
    }
  }

  // Attendance
  if ($path === '/attendance') {
    if ($method === 'GET') {
      Auth::requirePermission('attendance', 'read');
      Response::json(['attendance' => AttendanceService::list(Request::query('date'))]);
    }
    if ($method === 'POST') {
      Auth::requirePermission('attendance', 'create');
      Response::json(AttendanceService::create(Request::json()));
    }
  }

  if ($path === '/attendance/import' && $method === 'POST') {
    Auth::requirePermission('attendance', 'create');
    Response::error('Import Excel belum diaktifkan di API PHP (butuh PhpSpreadsheet).', 501);
  }

  if (preg_match('#^/attendance/([^/]+)$#', $path, $m)) {
    $id = $m[1];
    if ($method === 'PATCH') {
      Auth::requirePermission('attendance', 'update');
      Response::json(AttendanceService::update($id, Request::json()));
    }
    if ($method === 'DELETE') {
      Auth::requirePermission('attendance', 'delete');
      AttendanceService::delete($id);
      Response::ok();
    }
  }

  // Users
  if ($path === '/users') {
    if ($method === 'GET') {
      Auth::requirePermission('user', 'read');
      Response::json(UsersService::list());
    }
    if ($method === 'POST') {
      Auth::requirePermission('user', 'create');
      Response::json(UsersService::create(Request::json()));
    }
  }

  if (preg_match('#^/users/([^/]+)$#', $path, $m)) {
    $id = $m[1];
    if ($method === 'PATCH') {
      Auth::requirePermission('user', 'update');
      Response::json(UsersService::update($id, Request::json()));
    }
    if ($method === 'DELETE') {
      Auth::requirePermission('user', 'delete');
      UsersService::delete($id);
      Response::ok();
    }
  }

  // Account password
  if ($method === 'POST' && $path === '/account/password') {
    $user = Auth::requireLogin();
    UsersService::changePassword($user['id'], Request::json());
    Response::ok();
  }

  Response::error('Not found', 404);
}
