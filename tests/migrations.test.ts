import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

test('every SQL migration is registered in version order', () => {
  const db = read('server/db.ts');
  const migrations = readdirSync(resolve(root, 'server/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  assert.deepEqual(migrations, [
    '002_ai_diagnoses.sql',
    '003_smart_workshop.sql',
    '004_mechanic_management.sql',
    '005_smart_workshop_catalogue.sql',
    '006_customer_sessions.sql',
    '007_ai_intelligence.sql',
  ]);
  for (const migration of migrations) {
    assert.ok(db.includes(migration), `db.ts does not register ${migration}`);
  }
  assert.ok(db.indexOf('006_customer_sessions.sql') < db.indexOf('007_ai_intelligence.sql'));
});

test('intelligence migration creates the new lifecycle tables without destructive statements', () => {
  const sql = read('server/migrations/007_ai_intelligence.sql');
  for (const table of [
    'ai_training_runs',
    'workshop_bays',
    'part_compatibility',
    'part_recommendations',
    'vehicle_data_consents',
    'vehicle_telemetry_events',
    'vehicle_twin_states',
    'vehicle_vin_decodes',
    'vehicle_fault_images',
    'vehicle_image_annotations',
    'vehicle_visual_localizations',
    'vehicle_component_node_maps',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE FROM)\b/i);
});

test('customer sessions replace timestamp-only revocation', () => {
  const sql = read('server/migrations/006_customer_sessions.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_jwt_tokens/);
  assert.match(sql, /absolute_expires_at/);
  assert.match(sql, /replaced_by_jti/);
});
