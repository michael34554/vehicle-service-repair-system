import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(import.meta.dirname, '..', 'server', 'index.ts'), 'utf8');

const guardedRoutes = [
  'app.post(\'/api/ai/retrain\'',
  'app.get(\'/api/ai/training-runs\'',
  'app.post(\'/api/workshop/bays\'',
  'app.delete(\'/api/workshop/bays/:id\'',
  'app.post(\'/api/intelligence/parts/recommend\'',
  'app.post(\'/api/intelligence/parts/recommendations/:id/feedback\'',
  'app.get(\'/api/twin/vehicles/:vehicleId/consent\'',
  'app.post(\'/api/twin/vehicles/:vehicleId/consent\'',
  'app.post(\'/api/twin/telemetry\'',
  'app.post(\'/api/twin/vin-decode\'',
  'app.post(\'/api/visual/images\'',
  'app.post(\'/api/visual/images/:id/annotations\'',
  'app.post(\'/api/visual/localize\'',
  'app.patch(\'/api/visual/localizations/:id/review\'',
  'app.post(\'/api/smart-workshop/assets/:assetKey/node-maps\'',
  'app.patch(\'/api/smart-workshop/node-maps/:id/verify\'',
];

test('intelligence routes require staff roles and authentication', () => {
  for (const signature of guardedRoutes) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} is missing`);
    const nextRoute = source.indexOf('\napp.', start + signature.length);
    const block = source.slice(start, nextRoute === -1 ? source.length : nextRoute);
    assert.match(block, /requireAuth/, `${signature} is missing requireAuth`);
    assert.match(block, /requireIntelligenceStaff\(auth\)/, `${signature} is missing the role guard`);
  }
});

test('diagnosis history exposes the knowledge links recorded at prediction time', () => {
  const start = source.indexOf("app.get('/api/vehicles/:vehicleId/diagnoses'");
  assert.notEqual(start, -1);
  const nextRoute = source.indexOf('\napp.', start + 1);
  const block = source.slice(start, nextRoute === -1 ? source.length : nextRoute);
  assert.match(block, /fault_record_id/);
  assert.match(block, /catalogue_model_id/);
});
