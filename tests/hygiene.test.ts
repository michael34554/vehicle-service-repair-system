import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

test('no unused Gemini SDK or capability advertising remains', () => {
  assert.doesNotMatch(read('package.json'), /@google\/genai/);
  assert.doesNotMatch(read('metadata.json'), /MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API/);
});

test('environment template documents required runtime configuration', () => {
  const env = read('.env.example');
  for (const key of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'NEXTGEN_JWT_SECRET']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} is missing from .env.example`);
  }
  assert.match(read('.gitignore'), /!\.env\.example/);
  assert.match(read('.gitignore'), /vehicle_fault_calibration\.joblib/);
});

test('clean and test scripts are cross-platform', () => {
  const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.ok(packageJson.scripts.clean.startsWith('node '), 'clean must not depend on rm -rf');
  assert.match(packageJson.scripts.test, /node --test|tsx --test/);
});

test('AI and 3D disclaimers match the implemented model and assets', () => {
  const view = read('src/components/views/SmartWorkshopView.tsx');
  assert.doesNotMatch(view, /uncalibrated model scores/i);
  assert.match(view, /not diagnoses or verified failure probabilities/);
  assert.match(view, /calibrated only against synthetic grouped holdout data/);
  assert.match(view, /licensed generic illustration/);
  assert.match(view, /procedural inspection assembly/);
  assert.match(view, /not an exact replica of this vehicle/);
});
