import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  GENERIC_DEMO_ASSET_PATH,
  VEHICLE_MANUFACTURERS,
  VEHICLE_MODELS,
  assetPathForModel,
  resolveCatalogueModel,
} from '../shared/vehicleCatalogue.ts';
import { describeAsset } from '../server/smartWorkshopCatalogue.ts';

const root = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

const requiredModels = [
  'Toyota Corolla', 'Toyota Camry', 'Toyota Hilux', 'Toyota Land Cruiser', 'Toyota RAV4', 'Toyota Vitz',
  'Nissan Sunny', 'Nissan Note', 'Nissan X-Trail', 'Nissan Navara', 'Nissan Patrol', 'Nissan March',
  'Volkswagen Golf', 'Volkswagen Polo', 'Volkswagen Passat', 'Volkswagen Tiguan',
  'Mercedes-Benz C-Class', 'Mercedes-Benz E-Class', 'Mercedes-Benz S-Class', 'Mercedes-Benz GLE', 'Mercedes-Benz Sprinter',
  'Ford Ranger', 'Ford Focus', 'Ford Everest', 'Ford Mustang',
];

test('central catalogue covers every required manufacturer and model', () => {
  assert.deepEqual(
    VEHICLE_MANUFACTURERS.map((manufacturer) => manufacturer.name),
    ['Toyota', 'Nissan', 'Volkswagen', 'Mercedes-Benz', 'Ford', 'Honda', 'BMW', 'Mazda', 'Hyundai', 'Mitsubishi', 'Suzuki'],
  );
  const names = new Set(VEHICLE_MODELS.map((model) => `${model.manufacturer} ${model.name}`));
  for (const required of requiredModels) {
    const [manufacturer, ...rest] = required.split(' ');
    const key = manufacturer === 'Mercedes-Benz' ? 'mercedes-benz' : manufacturer.toLowerCase();
    assert.ok(names.has(`${key} ${rest.join(' ')}`), `Missing catalogue model: ${required}`);
  }
  assert.equal(new Set(VEHICLE_MODELS.map((model) => model.id)).size, VEHICLE_MODELS.length);
});

test('catalogue mapping resolves aliases and never maps a model to the generic Ferrari asset', () => {
  assert.equal(resolveCatalogueModel('vw', 'Golf')?.id, 'vw-golf');
  assert.equal(resolveCatalogueModel('Mercedes', 'C-Class')?.id, 'mercedes-c-class');
  assert.equal(resolveCatalogueModel('TOYOTA', 'Hilux')?.assetPath, '/assets/models/toyota/hilux.glb');
  assert.equal(assetPathForModel('ford-ranger'), '/assets/models/ford/ranger.glb');
  assert.ok(VEHICLE_MODELS.every((model) => model.assetPath !== GENERIC_DEMO_ASSET_PATH));
  assert.ok(VEHICLE_MODELS.every((model) => !model.assetPath.includes('ferrari')));
});

test('the seed creates a separate missing asset slot for every central catalogue model', () => {
  const seed = read('server/smartWorkshopSeed.ts');
  for (const model of VEHICLE_MODELS) {
    assert.ok(seed.includes(`'${model.id}'`) || seed.includes(`id: '${model.id}'`), `Seed is missing ${model.id}`);
  }
  assert.match(seed, /No 3D model file is present/);
  assert.match(seed, /never replaced silently by the Ferrari asset/);
});

test('the viewer requires an explicit asset path and has no Ferrari fallback', () => {
  const exterior = read('src/components/smartWorkshop/ExteriorVehicle.tsx');
  const viewer = read('src/components/smartWorkshop/VehicleViewer.tsx');
  const config = read('src/components/smartWorkshop/viewerConfig.ts');
  assert.match(exterior, /modelPath: string/);
  assert.doesNotMatch(exterior, /ferrari/i);
  assert.doesNotMatch(viewer, /ferrari/i);
  assert.doesNotMatch(config, /ferrari/i);
  assert.match(viewer, /assetStatus/);
  assert.match(viewer, /3D asset unavailable/);
});

test('the asset catalogue migration is additive and provides the metadata the explorer needs', () => {
  const sql = read('server/migrations/008_vehicle_asset_catalogue.sql');
  for (const column of [
    'manufacturer_name', 'model_name', 'year_from', 'year_to', 'variant', 'shadow_path',
    'available_view_modes_json', 'inspectable_components_json', 'availability_status', 'is_catalogue_selectable',
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}\\b`), `Missing asset column: ${column}`);
  }
  for (const column of ['supported_years_json', 'variants_json', 'engines_json']) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}\\b`), `Missing model column: ${column}`);
  }
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE FROM)\b/i);
});

test('catalogue APIs expose the consolidated explorer, asset editing and registered-vehicle links', () => {
  const catalogueApi = read('server/smartWorkshopCatalogue.ts');
  for (const route of [
    "app.get('/api/smart-workshop/catalogue/vehicles'",
    "app.patch('/api/smart-workshop/3d-assets/:assetKey'",
    "app.patch('/api/smart-workshop/vehicles/:vehicleId/catalogue-link'",
  ]) {
    assert.ok(catalogueApi.includes(route), `Missing route: ${route}`);
  }
  assert.match(catalogueApi, /file_exists/);
  assert.match(catalogueApi, /availability_status/);
});

test('asset descriptors derive availability from the filesystem and never promote a missing file', () => {
  const base = {
    asset_key: 'toyota-corolla',
    label: 'Toyota Corolla',
    license: 'Proprietary',
    source: 'Catalogue registration',
  };
  const missing = describeAsset({
    ...base,
    model_path: '/assets/models/toyota/corolla.glb',
    availability_status: 'available',
    is_generic: 0,
    is_exact_match: 1,
    is_catalogue_selectable: 1,
  });
  assert.equal(missing.file_exists, false);
  assert.equal(missing.availability_status, 'missing');
  assert.deepEqual(missing.available_view_modes, []);

  const presentGeneric = describeAsset({
    ...base,
    model_path: GENERIC_DEMO_ASSET_PATH,
    availability_status: 'available',
    is_generic: 1,
    is_exact_match: 0,
    is_catalogue_selectable: 1,
  });
  assert.equal(presentGeneric.file_exists, true);
  assert.equal(presentGeneric.availability_status, 'representative_only');
  assert.deepEqual(presentGeneric.available_view_modes, ['exterior', 'mechanical', 'exploded']);

  const exact = describeAsset({
    ...base,
    model_path: GENERIC_DEMO_ASSET_PATH,
    availability_status: 'available',
    is_generic: 0,
    is_exact_match: 1,
    is_catalogue_selectable: 1,
    node_map_json: JSON.stringify({ Wheel: 'brakes', Hood: 'engine', Unknown: 'wheels' }),
    inspectable_components_json: JSON.stringify(['engine', 'not-a-component']),
  });
  assert.equal(exact.availability_status, 'available');
  assert.deepEqual(exact.node_map, { Wheel: 'brakes', Hood: 'engine' });
  assert.deepEqual(exact.inspectable_components, ['engine']);

  const disabled = describeAsset({
    ...base,
    model_path: GENERIC_DEMO_ASSET_PATH,
    availability_status: 'available',
    is_generic: 0,
    is_exact_match: 1,
    is_catalogue_selectable: 0,
  });
  assert.equal(disabled.availability_status, 'disabled');
});

test('the Volkswagen Golf catalogue asset is a real licensed local GLB', () => {
  const glb = readFileSync(resolve(root, 'public/assets/models/volkswagen/golf.glb'));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.ok(glb.length > 50_000, 'Golf GLB is unexpectedly small');

  const attribution = read('public/assets/models/ATTRIBUTION.md');
  assert.match(attribution, /## volkswagen\/golf\.glb/);
  assert.match(attribution, /CC BY 3\.0/);
  assert.match(attribution, /poly\.pizza\/m\/2u4e9d0aePt/);
  assert.match(attribution, /Yogoshimo 2\.0/);
  assert.match(attribution, /not a verified exact generation, model year or trim/i);

  const seed = read('server/smartWorkshopSeed.ts');
  assert.match(seed, /BUNDLED_MODEL_ASSETS/);
  assert.match(seed, /'vw-golf': \{/);
  assert.match(seed, /license: 'CC BY 3\.0'/);
  assert.match(seed, /licenseUrl: 'https:\/\/creativecommons\.org\/licenses\/by\/3\.0\/'/);

  const descriptor = describeAsset({
    asset_key: 'vw-golf',
    label: 'Volkswagen Golf (licensed low-poly Mk representation)',
    model_path: '/assets/models/volkswagen/golf.glb',
    license: 'CC BY 3.0',
    license_url: 'https://creativecommons.org/licenses/by/3.0/',
    source: 'Poly Pizza',
    availability_status: 'available',
    is_generic: 0,
    is_exact_match: 1,
    is_catalogue_selectable: 1,
    available_view_modes_json: JSON.stringify(['exterior', 'mechanical', 'exploded']),
  });
  assert.equal(descriptor.file_exists, true);
  assert.equal(descriptor.availability_status, 'available');
  assert.deepEqual(descriptor.available_view_modes, ['exterior', 'mechanical', 'exploded']);
  assert.deepEqual(descriptor.node_map, {});
});

test('the selector keeps catalogue exploration separate from registered-vehicle diagnosis', () => {
  const view = read('src/components/views/SmartWorkshopView.tsx');
  for (const field of [
    'catalogueManufacturerId', 'catalogueModelId', 'catalogueYear', 'catalogueVariant', 'catalogueEngine',
  ]) {
    assert.ok(view.includes(`const [${field}, set${field[0].toUpperCase()}${field.slice(1)}]`), `Missing selector state: ${field}`);
  }
  assert.match(view, /selectionSource === 'catalogue'/);
  assert.match(view, /Not recorded/);
  assert.match(view, /fieldsets? disabled=\{selectionSource === 'catalogue'\}/);
  assert.match(view, /AI fault analysis requires a registered vehicle/);
  assert.match(view, /Catalogue vehicle — no workshop records apply/);
  assert.match(view, /modelPath=\{modelPath\}/);
  assert.match(view, /effectiveAssetStatus === 'available'/);
});
