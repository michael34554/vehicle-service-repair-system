import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { db } from './db';
import {
  COMPONENT_KEYS_SET,
  MECHANICAL_SYSTEMS,
  isComponentKey,
  type SystemKey,
} from '../shared/smartWorkshop';

/**
 * Catalogue, fault knowledge-base and integration APIs for the AI Smart Workshop.
 * Registered on the existing Express app; no second backend, database or auth layer.
 */

interface CatalogueAuth {
  id: string;
  name: string;
  role: string;
  workshop_id: string;
}

interface ModelRow {
  id: string;
  manufacturer_id: string;
  name: string;
  body_style: string | null;
  asset_key: string | null;
  asset_status: string | null;
  specification_note: string | null;
  manufacturer_name: string | null;
  [key: string]: unknown;
}

interface CatalogueDeps {
  app: Express;
  db: typeof db;
  HttpError: new (status: number, message: string) => Error;
  requireAuth: RequestHandler;
  asyncRoute: (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) => RequestHandler;
  requireObject: (value: unknown) => Record<string, unknown>;
  requiredText: (value: unknown, label: string, minLength: number, maxLength: number) => string;
  requireVehicleAccess: (vehicleId: string, auth: CatalogueAuth) => Promise<{ customer_id: string }>;
}

function authOf(response: Response): CatalogueAuth {
  return response.locals.auth as CatalogueAuth;
}

function parseArray(value: unknown): unknown[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown, label: string, maxItems = 30): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 500)) {
    throw new Error(`${label} must be an array of up to ${maxItems} non-empty strings.`);
  }
  return (value as string[]).map((entry) => entry.trim());
}

function serializeFault(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    manufacturer_id: row.manufacturer_id ?? null,
    manufacturer_name: row.manufacturer_name ?? null,
    model_id: row.model_id ?? null,
    model_name: row.model_name ?? null,
    year_from: row.year_from ?? null,
    year_to: row.year_to ?? null,
    engine_type: row.engine_type ?? null,
    system_key: row.system_key,
    component_key: row.component_key ?? null,
    fault_name: row.fault_name,
    description: row.description,
    symptoms: parseArray(row.symptoms_json),
    possible_causes: parseArray(row.causes_json),
    diagnostic_procedures: parseArray(row.diagnostic_procedures_json),
    dtc_codes: parseArray(row.dtc_codes_json),
    recommended_inspection: row.recommended_inspection ?? null,
    corrective_action: row.corrective_action ?? null,
    dataset_source: row.dataset_source,
    provenance: row.provenance,
    fidelity_note: row.fidelity_note ?? null,
    severity: row.severity ?? null,
    is_active: Number(row.is_active ?? 0) === 1,
  };
}

const FAULT_SELECT = `
  SELECT f.*, m.name AS manufacturer_name, vm.name AS model_name
  FROM vehicle_fault_records f
  LEFT JOIN vehicle_manufacturers m ON m.id = f.manufacturer_id
  LEFT JOIN vehicle_models vm ON vm.id = f.model_id
`;

const SPEC_FIELDS = ['engine_type', 'engine_capacity_cc', 'fuel_type', 'transmission_type', 'drive_type'] as const;
type SpecField = typeof SPEC_FIELDS[number];

const MISSING_FIELD_LABELS: Record<SpecField, string> = {
  engine_type: 'Engine type',
  engine_capacity_cc: 'Engine capacity',
  fuel_type: 'Fuel type',
  transmission_type: 'Transmission type',
  drive_type: 'Drive type',
};

export function registerSmartWorkshopCatalogueRoutes(deps: CatalogueDeps): void {
  const { app, db: database, HttpError, requireAuth, asyncRoute, requireObject, requiredText, requireVehicleAccess } = deps;

  function requireAdmin(response: Response): CatalogueAuth {
    const auth = authOf(response);
    if (auth.role !== 'owner' && auth.role !== 'manager') {
      throw new HttpError(403, 'Only workshop administrators can change the shared vehicle catalogue.');
    }
    return auth;
  }

  async function modelOr404(modelId: string): Promise<ModelRow> {
    const model = await database.first(`
      SELECT vm.*, m.name AS manufacturer_name
      FROM vehicle_models vm JOIN vehicle_manufacturers m ON m.id = vm.manufacturer_id
      WHERE vm.id = ?
    `, modelId);
    if (!model) throw new HttpError(404, 'Vehicle model not found.');
    return model as ModelRow;
  }

  app.get('/api/smart-workshop/3d-assets', requireAuth, asyncRoute(async (_request, response, next) => {
    try {
      const records = await database.query(`
        SELECT asset_key, label, model_path, license, license_url, source,
          is_generic, is_exact_match, notes
        FROM vehicle_3d_assets ORDER BY is_generic DESC, label ASC
      `);
      response.json({ records });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/manufacturers', requireAuth, asyncRoute(async (_request, response, next) => {
    try {
      const records = await database.query(`
        SELECT m.id, m.name, m.country, m.is_active, COUNT(vm.id) AS model_count
        FROM vehicle_manufacturers m
        LEFT JOIN vehicle_models vm ON vm.manufacturer_id = m.id AND vm.is_active = 1
        WHERE m.is_active = 1
        GROUP BY m.id, m.name, m.country, m.is_active
        ORDER BY m.name ASC
      `);
      response.json({ records });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/manufacturers/:id/models', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const manufacturer = await database.first('SELECT id, name, country FROM vehicle_manufacturers WHERE id = ? AND is_active = 1', request.params.id);
      if (!manufacturer) throw new HttpError(404, 'Manufacturer not found.');
      const records = await database.query(`
        SELECT vm.id, vm.name, vm.body_style, vm.year_from, vm.year_to, vm.image_path,
          vm.asset_key, vm.asset_status, vm.specification_note,
          CASE WHEN EXISTS (SELECT 1 FROM vehicle_specifications s WHERE s.model_id = vm.id AND s.verification_status = 'verified') THEN 1 ELSE 0 END AS has_verified_specification
        FROM vehicle_models vm WHERE vm.manufacturer_id = ? AND vm.is_active = 1 ORDER BY vm.name ASC
      `, request.params.id);
      response.json({ manufacturer, records });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/models/:id', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const model = await modelOr404(request.params.id);
      const asset = model.asset_key
        ? await database.first('SELECT * FROM vehicle_3d_assets WHERE asset_key = ?', String(model.asset_key))
        : undefined;
      const specifications = await database.query('SELECT * FROM vehicle_specifications WHERE model_id = ? ORDER BY year_from, id', request.params.id);
      const systems = await database.query(`
        SELECT s.system_key, s.label, s.description,
          COALESCE(c.components_json, '[]') AS components_json
        FROM vehicle_model_systems ms
        JOIN mechanical_systems s ON s.system_key = ms.system_key
        LEFT JOIN (
          SELECT system_key, JSON_ARRAYAGG(JSON_OBJECT(
            'component_key', component_key, 'label', label, 'description', description,
            'model_node_hint', model_node_hint, 'is_exact_node', is_exact_node
          )) AS components_json
          FROM vehicle_components GROUP BY system_key
        ) c ON c.system_key = s.system_key
        WHERE ms.model_id = ?
        ORDER BY s.sort_order
      `, request.params.id) as Record<string, unknown>[];
      response.json({
        model,
        asset: asset ?? null,
        specifications,
        systems: systems.map((row) => ({ ...row, components: parseArray(row.components_json) })),
        coverage_note: 'System coverage is generic inspection coverage. Confirm which systems and components apply to the exact model year and engine.',
      });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/models/:id/specifications', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const model = await modelOr404(request.params.id);
      const specifications = await database.query('SELECT * FROM vehicle_specifications WHERE model_id = ? ORDER BY year_from, id', request.params.id);
      response.json({
        model_id: model.id,
        specification_note: model.specification_note ?? null,
        records: specifications,
        verified_specification_available: specifications.some((row) => (row as Record<string, unknown>).verification_status === 'verified'),
      });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/models/:id/systems', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      await modelOr404(request.params.id);
      const records = await database.query(`
        SELECT s.system_key, s.label, s.description,
          COALESCE(c.components_json, '[]') AS components_json
        FROM vehicle_model_systems ms
        JOIN mechanical_systems s ON s.system_key = ms.system_key
        LEFT JOIN (
          SELECT system_key, JSON_ARRAYAGG(JSON_OBJECT(
            'component_key', component_key, 'label', label, 'description', description,
            'model_node_hint', model_node_hint, 'is_exact_node', is_exact_node
          )) AS components_json
          FROM vehicle_components GROUP BY system_key
        ) c ON c.system_key = s.system_key
        WHERE ms.model_id = ?
        ORDER BY s.sort_order
      `, request.params.id) as Record<string, unknown>[];
      response.json({
        records: records.map((row) => ({ ...row, components: parseArray(row.components_json) })),
        coverage_note: 'Generic inspection coverage; not a verified model-specific parts or systems list.',
      });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/models/:id/faults', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const model = await modelOr404(request.params.id);
      const records = await database.query(`
        ${FAULT_SELECT}
        WHERE f.is_active = 1 AND (
          f.model_id = ?
          OR (f.model_id IS NULL AND (f.manufacturer_id IS NULL OR f.manufacturer_id = ?))
        )
        ORDER BY (f.model_id IS NOT NULL) DESC, (f.manufacturer_id IS NOT NULL) DESC, f.fault_name ASC
        LIMIT 100
      `, model.id, model.manufacturer_id) as Record<string, unknown>[];
      response.json({ records: records.map(serializeFault) });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/models/:id/3d-asset', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const model = await modelOr404(request.params.id);
      const asset = model.asset_key
        ? await database.first('SELECT * FROM vehicle_3d_assets WHERE asset_key = ?', String(model.asset_key))
        : undefined;
      response.json({
        model_id: model.id,
        asset_status: model.asset_status ?? 'representative',
        asset: asset ?? null,
        node_map: asset ? Object.entries(parseObject((asset as Record<string, unknown>).node_map_json)).map(([node, component_key]) => ({ node, component_key })) : [],
        disclaimer: model.asset_status === 'exact'
          ? 'Model-specific asset. Verify the asset version against the vehicle before relying on component placement.'
          : 'Representative 3D asset. It is not an exact replica of this manufacturer or model. Internal components are procedural inspection assemblies.',
      });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/faults', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const clauses = ['f.is_active = 1'];
      const values: string[] = [];
      const manufacturerId = typeof request.query.manufacturer_id === 'string' ? request.query.manufacturer_id : '';
      const modelId = typeof request.query.model_id === 'string' ? request.query.model_id : '';
      const systemKey = typeof request.query.system_key === 'string' ? request.query.system_key : '';
      const componentKey = typeof request.query.component_key === 'string' ? request.query.component_key : '';
      const search = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 120) : '';
      if (manufacturerId) { clauses.push('(f.manufacturer_id = ? OR f.manufacturer_id IS NULL)'); values.push(manufacturerId); }
      if (modelId) { clauses.push('(f.model_id = ? OR f.model_id IS NULL)'); values.push(modelId); }
      if (systemKey) { clauses.push('f.system_key = ?'); values.push(systemKey); }
      if (componentKey) { clauses.push('f.component_key = ?'); values.push(componentKey); }
      if (search) {
        clauses.push('(f.fault_name LIKE ? OR f.description LIKE ?)');
        values.push(`%${search}%`, `%${search}%`);
      }
      const records = await database.query(`
        ${FAULT_SELECT}
        WHERE ${clauses.join(' AND ')}
        ORDER BY (f.model_id IS NOT NULL) DESC, (f.manufacturer_id IS NOT NULL) DESC, f.fault_name ASC
        LIMIT 100
      `, ...values) as Record<string, unknown>[];
      response.json({ records: records.map(serializeFault) });
    } catch (error) { next(error); }
  }));

  app.post('/api/smart-workshop/manufacturers', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const auth = requireAdmin(response);
      const body = requireObject(request.body);
      const name = requiredText(body.name, 'Manufacturer name', 2, 120);
      const rawId = body.id === undefined ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : requiredText(body.id, 'Manufacturer ID', 2, 191);
      const id = rawId.toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new HttpError(400, 'Manufacturer ID may contain lowercase letters, numbers and hyphens only.');
      const country = body.country === undefined || body.country === null || body.country === '' ? null : requiredText(body.country, 'Country', 2, 80);
      const now = new Date().toISOString();
      const exists = await database.first('SELECT id FROM vehicle_manufacturers WHERE id = ? OR name = ?', id, name);
      if (exists) throw new HttpError(409, 'That manufacturer already exists.');
      await database.execute(`
        INSERT INTO vehicle_manufacturers (id, name, country, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `, id, name, country, now, now);
      response.status(201).json({ record: { id, name, country, created_by: auth.name } });
    } catch (error) { next(error); }
  }));

  app.post('/api/smart-workshop/manufacturers/:id/models', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      requireAdmin(response);
      const manufacturer = await database.first('SELECT id FROM vehicle_manufacturers WHERE id = ? AND is_active = 1', request.params.id);
      if (!manufacturer) throw new HttpError(404, 'Manufacturer not found.');
      const body = requireObject(request.body);
      const name = requiredText(body.name, 'Model name', 1, 120);
      const id = body.id === undefined ? `${request.params.id}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : requiredText(body.id, 'Model ID', 2, 191);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new HttpError(400, 'Model ID may contain lowercase letters, numbers and hyphens only.');
      const bodyStyle = body.body_style === undefined || body.body_style === null || body.body_style === '' ? null : requiredText(body.body_style, 'Body style', 2, 80);
      const assetKey = body.asset_key === undefined || body.asset_key === null || body.asset_key === '' ? 'generic-licensed-vehicle' : requiredText(body.asset_key, '3D asset', 2, 191);
      const asset = await database.first('SELECT asset_key FROM vehicle_3d_assets WHERE asset_key = ?', assetKey);
      if (!asset) throw new HttpError(400, 'Select a registered 3D asset.');
      const yearFrom = body.year_from === undefined || body.year_from === null || body.year_from === '' ? null : Number(body.year_from);
      const yearTo = body.year_to === undefined || body.year_to === null || body.year_to === '' ? null : Number(body.year_to);
      if ((yearFrom !== null && (!Number.isInteger(yearFrom) || yearFrom < 1886 || yearFrom > 2100))
        || (yearTo !== null && (!Number.isInteger(yearTo) || yearTo < 1886 || yearTo > 2100))
        || (yearFrom !== null && yearTo !== null && yearFrom > yearTo)) {
        throw new HttpError(400, 'Enter a valid model year range.');
      }
      const now = new Date().toISOString();
      const exists = await database.first('SELECT id FROM vehicle_models WHERE id = ? OR (manufacturer_id = ? AND name = ?)', id, request.params.id, name);
      if (exists) throw new HttpError(409, 'That model already exists for this manufacturer.');
      await database.execute(`
        INSERT INTO vehicle_models
          (id, manufacturer_id, name, body_style, year_from, year_to, image_path, asset_key, asset_status, specification_note, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'representative', ?, 1, ?, ?)
      `, id, request.params.id, name, bodyStyle, yearFrom, yearTo, assetKey,
        'No verified technical specifications are recorded. Confirm details against the vehicle or manufacturer service information.', now, now);
      for (const system of MECHANICAL_SYSTEMS) {
        await database.execute('INSERT IGNORE INTO vehicle_model_systems (model_id, system_key) VALUES (?, ?)', id, system.key);
      }
      response.status(201).json({ record: { id, manufacturer_id: request.params.id, name, body_style: bodyStyle, asset_key: assetKey } });
    } catch (error) { next(error); }
  }));

  app.patch('/api/smart-workshop/models/:id', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      requireAdmin(response);
      await modelOr404(request.params.id);
      const body = requireObject(request.body);
      const allowed = ['asset_key', 'asset_status', 'image_path', 'specification_note', 'is_active'];
      if (Object.keys(body).some((field) => !allowed.includes(field))) throw new HttpError(400, 'Unsupported model update field.');
      const sets: string[] = [];
      const values: (string | number)[] = [];
      if (body.asset_key !== undefined) {
        const assetKey = requiredText(body.asset_key, '3D asset', 2, 191);
        if (!await database.first('SELECT asset_key FROM vehicle_3d_assets WHERE asset_key = ?', assetKey)) throw new HttpError(400, 'Select a registered 3D asset.');
        sets.push('asset_key = ?'); values.push(assetKey);
      }
      if (body.asset_status !== undefined) {
        const status = requiredText(body.asset_status, 'Asset status', 1, 32);
        if (!['representative', 'exact'].includes(status)) throw new HttpError(400, 'Asset status must be representative or exact.');
        sets.push('asset_status = ?'); values.push(status);
      }
      if (body.image_path !== undefined) {
        if (body.image_path !== null && typeof body.image_path !== 'string') throw new HttpError(400, 'Image path must be a string or null.');
        sets.push('image_path = ?'); values.push(body.image_path === null ? '' : String(body.image_path).slice(0, 500));
      }
      if (body.specification_note !== undefined) {
        if (typeof body.specification_note !== 'string') throw new HttpError(400, 'Specification note must be a string.');
        sets.push('specification_note = ?'); values.push(body.specification_note.slice(0, 4000));
      }
      if (body.is_active !== undefined) {
        if (typeof body.is_active !== 'boolean') throw new HttpError(400, 'is_active must be true or false.');
        sets.push('is_active = ?'); values.push(body.is_active ? 1 : 0);
      }
      if (sets.length === 0) throw new HttpError(400, 'Provide at least one field to update.');
      sets.push('updated_at = ?'); values.push(new Date().toISOString());
      await database.execute(`UPDATE vehicle_models SET ${sets.join(', ')} WHERE id = ?`, ...values, request.params.id);
      response.json({ record: await modelOr404(request.params.id) });
    } catch (error) { next(error); }
  }));

  app.post('/api/smart-workshop/3d-assets', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      requireAdmin(response);
      const body = requireObject(request.body);
      const assetKey = requiredText(body.asset_key, 'Asset key', 2, 191);
      const label = requiredText(body.label, 'Asset label', 2, 255);
      const modelPath = requiredText(body.model_path, 'Model path', 2, 500);
      if (!modelPath.startsWith('/assets/')) throw new HttpError(400, 'Model path must point to a local /assets/ GLB file.');
      const license = requiredText(body.license, 'License', 2, 120);
      const source = requiredText(body.source, 'Source and attribution', 4, 500);
      const licenseUrl = typeof body.license_url === 'string' ? body.license_url.slice(0, 500) : null;
      const isGeneric = body.is_generic === undefined ? true : body.is_generic === true;
      const isExact = body.is_exact_match === true;
      if (isExact && isGeneric) throw new HttpError(400, 'An exact model match cannot also be marked generic.');
      let nodeMap: Record<string, string> = {};
      if (body.node_map !== undefined && body.node_map !== null) {
        const candidate = requireObject(body.node_map);
        nodeMap = {};
        for (const [node, key] of Object.entries(candidate)) {
          if (!isComponentKey(key)) throw new HttpError(400, `Unsupported component key for node ${node}.`);
          nodeMap[node.slice(0, 191)] = key;
        }
      }
      const notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null;
      const now = new Date().toISOString();
      if (await database.first('SELECT asset_key FROM vehicle_3d_assets WHERE asset_key = ?', assetKey)) throw new HttpError(409, 'That asset key already exists.');
      await database.execute(`
        INSERT INTO vehicle_3d_assets
          (asset_key, label, model_path, license, license_url, source, is_generic, is_exact_match, node_map_json, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, assetKey, label, modelPath, license, licenseUrl, source, isGeneric ? 1 : 0, isExact ? 1 : 0,
        JSON.stringify(nodeMap), notes, now, now);
      response.status(201).json({ record: { asset_key: assetKey, label, model_path: modelPath, license, is_generic: isGeneric, is_exact_match: isExact } });
    } catch (error) { next(error); }
  }));

  app.post('/api/smart-workshop/models/:id/specifications', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      requireAdmin(response);
      const model = await modelOr404(request.params.id);
      const body = requireObject(request.body);
      const allowed = [...SPEC_FIELDS, 'technical_specs', 'data_source', 'verification_status', 'verified_by_name'];
      if (Object.keys(body).some((field) => !allowed.includes(field))) throw new HttpError(400, 'Unsupported specification field.');
      const status = requiredText(body.verification_status, 'Verification status', 1, 32);
      if (!['not_recorded', 'sourced', 'verified'].includes(status)) throw new HttpError(400, 'Verification status must be not_recorded, sourced or verified.');
      const dataSource = requiredText(body.data_source, 'Data source', 4, 500);
      const values: Record<string, string | number | null> = {};
      for (const field of SPEC_FIELDS) {
        const raw = body[field];
        if (raw === undefined || raw === null || raw === '') { values[field] = null; continue; }
        values[field] = field === 'engine_capacity_cc' ? Number(raw) : requiredText(raw, MISSING_FIELD_LABELS[field], 1, field === 'engine_type' ? 120 : 80);
      }
      const capacity = values.engine_capacity_cc as number | null;
      if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0 || capacity > 20000)) {
        throw new HttpError(400, 'Engine capacity must be a valid number of cubic centimetres.');
      }
      let technicalSpecs: string | null = null;
      if (body.technical_specs !== undefined && body.technical_specs !== null) {
        const candidate = requireObject(body.technical_specs);
        technicalSpecs = JSON.stringify(candidate);
      }
      const verifiedByName = body.verified_by_name === undefined || body.verified_by_name === null ? null : requiredText(body.verified_by_name, 'Verified by', 2, 255);
      const now = new Date().toISOString();
      const id = randomUUID();
      await database.execute(`
        INSERT INTO vehicle_specifications
          (id, model_id, year_from, year_to, engine_type, engine_capacity_cc, fuel_type, transmission_type,
           drive_type, technical_specs_json, data_source, verification_status, verified_by_name, created_at, updated_at)
        VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, model.id, values.engine_type, values.engine_capacity_cc, values.fuel_type,
        values.transmission_type, values.drive_type, technicalSpecs, dataSource, status, verifiedByName, now, now);
      response.status(201).json({ record: { id, model_id: model.id, ...values, data_source: dataSource, verification_status: status } });
    } catch (error) { next(error); }
  }));

  app.post('/api/smart-workshop/faults', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const auth = requireAdmin(response);
      const body = requireObject(request.body);
      const faultName = requiredText(body.fault_name, 'Fault name', 3, 255);
      const description = requiredText(body.description, 'Description', 10, 8000);
      const systemKey = requiredText(body.system_key, 'System', 1, 64);
      if (!MECHANICAL_SYSTEMS.some((entry) => entry.key === systemKey)) throw new HttpError(400, 'Select a supported mechanical system.');
      const componentKey = body.component_key === undefined || body.component_key === null || body.component_key === ''
        ? null
        : requiredText(body.component_key, 'Component', 1, 64);
      if (componentKey && !COMPONENT_KEYS_SET.has(componentKey)) throw new HttpError(400, 'Select a supported component.');
      let symptoms: string[], causes: string[], procedures: string[], codes: string[];
      try {
        symptoms = stringArray(body.symptoms, 'Symptoms');
        causes = stringArray(body.possible_causes, 'Possible causes');
        procedures = stringArray(body.diagnostic_procedures, 'Diagnostic procedures');
        codes = stringArray(body.dtc_codes, 'DTC codes');
      } catch (validationError) {
        throw new HttpError(400, validationError instanceof Error ? validationError.message : 'Invalid fault arrays.');
      }
      if (symptoms.length === 0 || causes.length === 0 || procedures.length === 0) {
        throw new HttpError(400, 'Provide at least one symptom, possible cause and diagnostic procedure.');
      }
      const provenance = requiredText(body.provenance, 'Provenance', 1, 32);
      if (!['verified', 'sourced', 'synthetic'].includes(provenance)) throw new HttpError(400, 'Provenance must be verified, sourced or synthetic.');
      const datasetSource = requiredText(body.dataset_source, 'Dataset source', 4, 500);
      const manufacturerId = body.manufacturer_id === undefined || body.manufacturer_id === null || body.manufacturer_id === ''
        ? null : requiredText(body.manufacturer_id, 'Manufacturer', 1, 191);
      const modelId = body.model_id === undefined || body.model_id === null || body.model_id === ''
        ? null : requiredText(body.model_id, 'Model', 1, 191);
      if (manufacturerId && !await database.first('SELECT id FROM vehicle_manufacturers WHERE id = ?', manufacturerId)) throw new HttpError(400, 'Manufacturer not found.');
      if (modelId) {
        const model = await database.first('SELECT manufacturer_id FROM vehicle_models WHERE id = ?', modelId) as { manufacturer_id: string } | undefined;
        if (!model) throw new HttpError(400, 'Model not found.');
        if (manufacturerId && model.manufacturer_id !== manufacturerId) throw new HttpError(400, 'The model does not belong to the selected manufacturer.');
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      await database.execute(`
        INSERT INTO vehicle_fault_records
          (id, manufacturer_id, model_id, year_from, year_to, engine_type, system_key, component_key,
           fault_name, description, symptoms_json, causes_json, diagnostic_procedures_json, dtc_codes_json,
           recommended_inspection, corrective_action, dataset_source, provenance, fidelity_note, severity,
           is_active, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `, id, manufacturerId, modelId, null, null, null, systemKey, componentKey, faultName, description,
        JSON.stringify(symptoms), JSON.stringify(causes), JSON.stringify(procedures), JSON.stringify(codes),
        typeof body.recommended_inspection === 'string' ? body.recommended_inspection.slice(0, 4000) : null,
        typeof body.corrective_action === 'string' ? body.corrective_action.slice(0, 4000) : null,
        datasetSource, provenance,
        typeof body.fidelity_note === 'string' ? body.fidelity_note.slice(0, 4000) : null,
        typeof body.severity === 'string' ? body.severity.slice(0, 32) : null,
        auth.id, now, now);
      response.status(201).json({ record: { id, fault_name: faultName, component_key: componentKey, provenance } });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/vehicles/:vehicleId/specifications', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const auth = authOf(response);
      await requireVehicleAccess(request.params.vehicleId, auth);
      const vehicle = await database.first(`
        SELECT id, make, model, model_year, mileage, engine_number, catalogue_model_id,
          engine_type, engine_capacity_cc, fuel_type, transmission_type, drive_type
        FROM vehicles WHERE id = ? AND workshop_id = ?
      `, request.params.vehicleId, auth.workshop_id) as Record<string, unknown> | undefined;
      if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
      const model = vehicle.catalogue_model_id ? await modelOr404(String(vehicle.catalogue_model_id)) : null;
      const modelSpecs = model
        ? await database.query(`SELECT * FROM vehicle_specifications WHERE model_id = ? AND verification_status != 'not_recorded' ORDER BY id DESC LIMIT 10`, model.id)
        : [];
      const effective: Record<SpecField, { value: string | number | null; source: string; verification_status: string }>
        = {} as Record<SpecField, { value: string | number | null; source: string; verification_status: string }>;
      const missing: string[] = [];
      for (const field of SPEC_FIELDS) {
        if (vehicle[field] !== null && vehicle[field] !== undefined && vehicle[field] !== '') {
          effective[field] = { value: vehicle[field] as string | number, source: 'Registered vehicle record', verification_status: 'workshop_record' };
          continue;
        }
        const spec = modelSpecs.find((row) => (row as Record<string, unknown>)[field] !== null && (row as Record<string, unknown>)[field] !== undefined) as Record<string, unknown> | undefined;
        if (spec) {
          effective[field] = {
            value: spec[field] as string | number,
            source: String(spec.data_source ?? 'Catalogue specification'),
            verification_status: String(spec.verification_status ?? 'sourced'),
          };
        } else {
          effective[field] = { value: null, source: 'Not recorded', verification_status: 'not_recorded' };
          missing.push(MISSING_FIELD_LABELS[field]);
        }
      }
      response.json({
        vehicle_id: vehicle.id,
        registered: { make: vehicle.make, model: vehicle.model, model_year: vehicle.model_year, mileage: vehicle.mileage, engine_number: vehicle.engine_number },
        catalogue_model: model ? { id: model.id, name: model.name, manufacturer_name: model.manufacturer_name, body_style: model.body_style, asset_status: model.asset_status } : null,
        specifications: effective,
        missing_fields: missing,
        note: 'Missing specifications are never inferred. Add them from the vehicle service book or manufacturer data.',
      });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/vehicles/:vehicleId/common-problems', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const auth = authOf(response);
      await requireVehicleAccess(request.params.vehicleId, auth);
      const vehicle = await database.first(`
        SELECT id, make, model, catalogue_model_id FROM vehicles WHERE id = ? AND workshop_id = ?
      `, request.params.vehicleId, auth.workshop_id) as Record<string, unknown> | undefined;
      if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
      const model = vehicle.catalogue_model_id ? await database.first('SELECT id, manufacturer_id FROM vehicle_models WHERE id = ?', String(vehicle.catalogue_model_id)) as Record<string, unknown> | undefined : undefined;

      const knowledgeRows = await database.query(`
        ${FAULT_SELECT}
        WHERE f.is_active = 1 AND (
          f.model_id = ?
          OR (f.model_id IS NULL AND (f.manufacturer_id IS NULL OR f.manufacturer_id = (
            SELECT id FROM vehicle_manufacturers WHERE LOWER(name) = LOWER(?) LIMIT 1
          )))
        )
        ORDER BY (f.model_id IS NOT NULL) DESC, f.fault_name ASC
        LIMIT 20
      `, String(vehicle.catalogue_model_id ?? ''), String(vehicle.make)) as Record<string, unknown>[];
      const diagnosisRows = await database.query(`
        SELECT id, predicted_fault, confirmed_fault, confidence, review_status, affected_component, created_at,
          prediction_candidates_json
        FROM ai_diagnoses WHERE vehicle_id = ? AND workshop_id = ? ORDER BY created_at DESC LIMIT 20
      `, request.params.vehicleId, auth.workshop_id) as Record<string, unknown>[];
      const historyRows = await database.query(`
        SELECT ral.id, ral.inspection_findings, ral.problems_identified, ral.recommendations, ral.created_at,
          j.job_no AS repair_job_code, j.service_type
        FROM repair_activity_logs ral
        JOIN jobs j ON j.id = ral.job_id AND j.workshop_id = ral.workshop_id
        WHERE j.vehicle_id = ? AND ral.workshop_id = ?
          AND (ral.problems_identified IS NOT NULL OR ral.inspection_findings IS NOT NULL)
        ORDER BY ral.created_at DESC LIMIT 20
      `, request.params.vehicleId, auth.workshop_id);

      response.json({
        vehicle_id: vehicle.id,
        catalogue_model_id: model?.id ?? null,
        categories: {
          knowledge_base: {
            label: 'Known possible fault categories',
            description: 'Reference knowledge base. Records may be generic, sourced or synthetic; provenance is shown for each record.',
            records: knowledgeRows.map(serializeFault),
          },
          historical: {
            label: 'Historically recorded faults in NEXTGEN',
            description: 'Faults recorded by this workshop for this vehicle in diagnosis and repair activity records.',
            records: historyRows,
          },
          ai_predictions: {
            label: 'AI-predicted faults for this vehicle',
            description: 'Uncalibrated model suggestions saved for mechanic review. Not confirmed diagnoses.',
            records: diagnosisRows.map((row) => ({
              ...row,
              predictions: parseArray(row.prediction_candidates_json).slice(0, 3),
            })),
          },
        },
        separation_note: 'These three categories have different sources and must not be treated as interchangeable.',
      });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/vehicles/:vehicleId/integrations', requireAuth, asyncRoute(async (request, response, next) => {
    try {
      const auth = authOf(response);
      await requireVehicleAccess(request.params.vehicleId, auth);
      const keywords = typeof request.query.q === 'string' ? request.query.q.trim().toLowerCase().slice(0, 120) : '';
      const parts = keywords.length > 1
        ? await database.query(`
            SELECT id, sku, name, category, quantity, reorder_level, selling_price_cents
            FROM parts
            WHERE workshop_id = ? AND (
              LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?
            )
            ORDER BY quantity DESC, name ASC LIMIT 12
          `, auth.workshop_id, `%${keywords}%`, `%${keywords}%`, `%${keywords}%`)
        : [];
      const mechanics = await database.query(`
        SELECT m.id, m.full_name, m.specialization, m.availability_status, m.employment_status
        FROM mechanics m
        WHERE m.workshop_id = ? AND m.employment_status = 'Active'
        ORDER BY m.availability_status ASC, m.full_name ASC LIMIT 12
      `, auth.workshop_id);
      const activeJob = await database.first(`
        SELECT j.id, j.job_no, j.repair_status, j.status, j.service_type, j.bay, j.assigned_technician
        FROM jobs j WHERE j.vehicle_id = ? AND j.workshop_id = ?
        ORDER BY j.created_at DESC LIMIT 1
      `, request.params.vehicleId, auth.workshop_id);
      response.json({
        parts,
        mechanics,
        active_job: activeJob ?? null,
        note: 'Read-only availability and assignment context. AI predictions never reserve parts or assign mechanics; use the existing Repair and Workshop Floor workflows for those actions.',
      });
    } catch (error) { next(error); }
  }));

  app.get('/api/smart-workshop/ai-model', requireAuth, asyncRoute(async (_request, response, next) => {
    try {
      const evaluationPath = resolve(process.cwd(), 'ml', 'evaluation.json');
      let evaluation: unknown = null;
      try {
        evaluation = JSON.parse(await readFile(evaluationPath, 'utf8')) as unknown;
      } catch {
        evaluation = null;
      }
      response.json({
        evaluation,
        status: evaluation ? 'evaluated' : 'not_evaluated',
        note: evaluation
          ? 'Metrics come from the recorded grouped holdout evaluation with isotonic confidence calibration. Check data provenance and limitations before operational use; confidence values are not verified failure probabilities.'
          : 'No recorded evaluation is available. Run `python ml/diagnosis.py train` after installing ml/requirements.txt before relying on model output.',
      });
    } catch (error) { next(error); }
  }));

}

export function systemKeyIsSupported(value: unknown): value is SystemKey {
  return typeof value === 'string' && MECHANICAL_SYSTEMS.some((entry) => entry.key === value);
}
