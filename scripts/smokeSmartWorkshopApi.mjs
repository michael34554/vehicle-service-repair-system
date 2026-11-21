import 'dotenv/config';
import mysql from 'mysql2/promise';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3101';
const cookies = new Map();
const results = [];
const suffix = Date.now().toString(36).toUpperCase().slice(-8);
const numericSuffix = Date.now().toString().slice(-9);
const email = `smart-workshop-smoke-${suffix.toLowerCase()}@example.invalid`;
const registration = `SMK${suffix}`;

function storeCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const value of values) {
    const pair = value.split(';')[0];
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function dbConfig() {
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  };
}

async function workshopCounts(workshopId) {
  const connection = await mysql.createConnection(dbConfig());
  const tables = ['parts', 'job_parts', 'stock_transactions', 'repair_mechanic_assignments', 'repair_completions', 'jobs'];
  const counts = {};
  try {
    for (const table of tables) {
      const [rows] = await connection.execute(`SELECT COUNT(*) AS count FROM ${table} WHERE workshop_id = ?`, [workshopId]);
      counts[table] = Number(rows[0]?.count ?? 0);
    }
  } finally {
    await connection.end();
  }
  return counts;
}

async function request(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json' };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-TOKEN'] = cookies.get('nextgen_csrf') ?? '';
  }
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
    storeCookies(response);
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* handled by caller */ }
    return { status: response.status, json, text };
  } finally {
    clearTimeout(timeout);
  }
}

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/smart-workshop/config`, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server did not become ready at ${BASE_URL}`);
}

async function cleanup(workshopId) {
  if (!workshopId) return;
  const connection = await mysql.createConnection(dbConfig());
  try {
    for (const statement of [
      'DELETE FROM ai_diagnoses WHERE workshop_id = ?',
      'DELETE FROM vehicle_component_inspections WHERE workshop_id = ?',
      'DELETE FROM stock_transactions WHERE workshop_id = ?',
      'DELETE FROM job_parts WHERE workshop_id = ?',
      'DELETE FROM repair_mechanic_assignments WHERE workshop_id = ?',
      'DELETE FROM repair_completions WHERE workshop_id = ?',
      'DELETE FROM jobs WHERE workshop_id = ?',
      'DELETE FROM vehicles WHERE workshop_id = ?',
      'DELETE FROM customers WHERE workshop_id = ?',
      'DELETE FROM mechanics WHERE workshop_id = ?',
      'DELETE FROM workshops WHERE id = ?',
    ]) {
      await connection.execute(statement, [workshopId]);
    }
  } finally {
    await connection.end();
  }
}

async function main() {
  const cleanupOnly = process.env.SMOKE_CLEANUP_ID;
  if (cleanupOnly) {
    await cleanup(cleanupOnly);
    console.log(`Cleaned requested workshop ${cleanupOnly}`);
    return;
  }

  await waitForServer();

  const unauthConfig = await fetch(`${BASE_URL}/api/smart-workshop/config`);
  check('Unauthenticated Smart Workshop access blocked', unauthConfig.status === 401, `status ${unauthConfig.status}`);
  const csrfBlocked = await fetch(`${BASE_URL}/api/smart-workshop/manufacturers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Blocked by smoke test' }),
  });
  check('CSRF blocks unauthenticated catalogue write', csrfBlocked.status === 403, `status ${csrfBlocked.status}`);

  let workshopId = '';
  try {
    const csrf = await request('/api/auth/csrf');
    check('CSRF endpoint', csrf.status === 200 && typeof csrf.json?.csrfToken === 'string');

    const registrationResponse = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Smart Workshop Smoke Test',
        email,
        password: `SmokePass-${suffix}!`,
        workshopName: `Smart Workshop Smoke ${suffix}`,
      },
    });
    check('Temporary owner registration', registrationResponse.status === 201, `status ${registrationResponse.status}`);
    if (registrationResponse.status !== 201) throw new Error(registrationResponse.json?.message ?? 'Registration failed.');

    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });
    const [accountRows] = await connection.execute('SELECT workshop_id FROM users WHERE email = ? LIMIT 1', [email]);
    await connection.end();
    workshopId = accountRows[0]?.workshop_id ?? '';
    check('Temporary workshop resolved', Boolean(workshopId));

    const me = await request('/api/auth/me');
    check('Authenticated session', me.status === 200 && me.json?.user?.role === 'owner');

    const customerResponse = await request('/api/customers', {
      method: 'POST',
      body: { full_name: 'Smoke Test Customer', phone_number: `+1555${numericSuffix}`, email: `smoke-customer-${suffix.toLowerCase()}@example.invalid` },
    });
    check('Create customer for vehicle integration', customerResponse.status === 201, `status ${customerResponse.status}`);
    const customerId = customerResponse.json?.record?.id;
    check('Customer record returned', Boolean(customerId));

    const vehicleResponse = await request('/api/vehicles', {
      method: 'POST',
      body: { customer_id: customerId, registration_number: registration, make: 'Toyota', model: 'Corolla', model_year: 2018, mileage: 95000 },
    });
    check('Create registered vehicle', vehicleResponse.status === 201, `status ${vehicleResponse.status}`);
    const vehicleId = vehicleResponse.json?.record?.id;
    check('Vehicle record returned', Boolean(vehicleId));

    const config = await request('/api/smart-workshop/config');
    check('Component config', config.status === 200 && config.json?.config?.components?.length === 17);

    const manufacturers = await request('/api/smart-workshop/manufacturers');
    const maker = (manufacturers.json?.records ?? []).find((entry) => entry.name === 'Toyota');
    check('Manufacturer catalogue', manufacturers.status === 200 && (manufacturers.json?.records?.length ?? 0) >= 10 && Boolean(maker));
    check('Catalogue response excludes customer data', !/registration_number|customer_name|phone_number|"vin"/i.test(JSON.stringify(manufacturers.json ?? {})));

    const models = await request(`/api/smart-workshop/manufacturers/${maker.id}/models`);
    const model = models.json?.records?.[0];
    check('Model catalogue', models.status === 200 && Boolean(model));

    const modelDetail = await request(`/api/smart-workshop/models/${model.id}`);
    check('Model systems and components', modelDetail.status === 200 && modelDetail.json?.systems?.length === 12);

    for (const [name, path] of [
      ['Model specifications', 'specifications'],
      ['Model system coverage', 'systems'],
      ['Model fault knowledge', 'faults'],
      ['Model 3D asset', '3d-asset'],
    ]) {
      const response = await request(`/api/smart-workshop/models/${model.id}/${path}`);
      check(name, response.status === 200, `status ${response.status}`);
    }

    const faultSearch = await request('/api/smart-workshop/faults?q=misfire');
    check('Fault knowledge search', faultSearch.status === 200 && Array.isArray(faultSearch.json?.records));

    const assetList = await request('/api/smart-workshop/3d-assets');
    check('3D asset registry', assetList.status === 200 && (assetList.json?.records?.length ?? 0) >= 1);
    check('3D asset metadata includes licensing', Boolean(assetList.json?.records?.[0]?.license && assetList.json?.records?.[0]?.source));

    const vehicleSearch = await request(`/api/vehicles?q=${encodeURIComponent(registration)}`);
    check('Vehicle search by registration', vehicleSearch.status === 200 && (vehicleSearch.json?.records ?? []).some((entry) => entry.id === vehicleId));

    const workshopVehicle = await request(`/api/smart-workshop/vehicles/${vehicleId}`);
    check('Smart Workshop vehicle integration', workshopVehicle.status === 200 && workshopVehicle.json?.vehicle?.registration_number === registration);
    check('Catalogue/specification exposure', Boolean(workshopVehicle.json?.catalogue_model) && Array.isArray(workshopVehicle.json?.specifications?.fields));
    check('3D asset exposure', Boolean(workshopVehicle.json?.model_asset?.model_path));

    const specIntegration = await request(`/api/smart-workshop/vehicles/${vehicleId}/specifications`);
    check('Vehicle specification integration', specIntegration.status === 200 && Array.isArray(specIntegration.json?.missing_fields) && Boolean(specIntegration.json?.specifications));

    const integration = await request(`/api/smart-workshop/vehicles/${vehicleId}/integrations`);
    check('Read-only workshop integrations', integration.status === 200 && Array.isArray(integration.json?.parts) && Array.isArray(integration.json?.mechanics));

    const countsBefore = await workshopCounts(workshopId);

    const inspection = await request(`/api/vehicles/${vehicleId}/component-inspections`, {
      method: 'POST',
      body: { component_name: 'engine', condition_status: 'no_fault_found', inspection_notes: 'Smoke test inspection', inspection_date: new Date().toISOString().slice(0, 10) },
    });
    check('Record component inspection', inspection.status === 201, `status ${inspection.status}`);

    const afterInspection = await request(`/api/smart-workshop/vehicles/${vehicleId}`);
    check('Green status requires explicit inspection', afterInspection.json?.statuses?.engine?.status === 'green');

    const prediction = await request('/api/diagnoses/predict', {
      method: 'POST',
      body: { vehicle_id: vehicleId, symptoms: 'Engine shakes at idle and misfires under acceleration with a flashing check engine light', include_context: true },
      timeoutMs: 60000,
    });
    check('AI prediction with structured context', prediction.status === 201 && prediction.json?.diagnosis?.predictions?.length === 3, `status ${prediction.status}`);
    check('Prediction safety metadata', Boolean(prediction.json?.diagnosis?.warning) && (prediction.json?.diagnosis?.context_used?.fields?.length ?? 0) > 0);

    const countsAfter = await workshopCounts(workshopId);
    check('AI prediction does not change inventory', ['parts', 'job_parts', 'stock_transactions'].every((table) => countsAfter[table] === countsBefore[table]));
    check('AI prediction does not assign mechanics or create repairs', ['repair_mechanic_assignments', 'repair_completions', 'jobs'].every((table) => countsAfter[table] === countsBefore[table]));

    const afterPrediction = await request(`/api/smart-workshop/vehicles/${vehicleId}`);
    check('Pending AI prediction outranks green inspection', afterPrediction.json?.statuses?.engine?.status === 'orange');

    const problems = await request(`/api/smart-workshop/vehicles/${vehicleId}/common-problems`);
    const categories = problems.json?.categories ?? {};
    check('Three separated problem categories', problems.status === 200 && Boolean(categories.knowledge_base && categories.historical && categories.ai_predictions));
    check('AI prediction appears in its own category', (categories.ai_predictions?.records?.length ?? 0) >= 1);

    const modelEvaluation = await request('/api/smart-workshop/ai-model');
    const metrics = modelEvaluation.json?.evaluation?.evaluation?.models ?? [];
    check('AI evaluation API', modelEvaluation.status === 200 && modelEvaluation.json?.status === 'evaluated' && metrics.length === 3 && metrics[0]?.model === 'random_forest');

    const history = await request(`/api/vehicles/${vehicleId}/diagnoses`);
    check('Diagnosis history', history.status === 200 && (history.json?.records?.length ?? 0) >= 1);
  } finally {
    if (workshopId) {
      try { await cleanup(workshopId); console.log(`Cleaned temporary workshop ${workshopId}`); }
      catch (cleanupError) { console.error(`Cleanup failed for workshop ${workshopId}:`, cleanupError.message); process.exitCode = 1; }
    }
  }

  const failures = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failures.length}/${results.length} smoke checks passed.`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
