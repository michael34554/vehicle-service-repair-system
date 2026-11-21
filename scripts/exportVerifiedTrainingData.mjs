import 'dotenv/config';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'ml', 'data');
const verifiedPath = path.join(outputDir, 'vehicle_fault_verified.csv');
const mixedPath = path.join(outputDir, 'vehicle_fault_training_mixed.csv');
const syntheticPath = path.join(outputDir, 'vehicle_fault_training.csv');

const headers = [
  'example_id', 'symptom_text', 'fault_category', 'reference_dtc', 'manufacturer', 'model',
  'model_year', 'engine_type', 'mileage', 'fuel_type', 'transmission_type',
  'drive_type', 'inspection_findings', 'previous_faults', 'provenance',
];

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function readCsv(file) {
  const rows = [];
  const text = requireFileText(file);
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const parsed = lines.map((line) => {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  });
  const columnNames = parsed.shift() ?? [];
  for (const cells of parsed) {
    rows.push(Object.fromEntries(columnNames.map((name, index) => [name, cells[index] ?? ''])));
  }
  return rows;
}

function requireFileText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function writeCsv(file, rows) {
  const stream = createWriteStream(file, { encoding: 'utf8' });
  stream.write(`${headers.map(csvCell).join(',')}\n`);
  for (const row of rows) {
    stream.write(`${headers.map((header) => csvCell(row[header])).join(',')}\n`);
  }
  stream.end();
}

function firstCode(row) {
  try {
    const context = JSON.parse(row.input_context_json || '{}');
    const codes = context.dtc_codes;
    if (Array.isArray(codes) && codes.length > 0) return String(codes[0]);
  } catch {
    // Ignore malformed historical context.
  }
  return '';
}

function contextValue(row, key, fallback = '') {
  try {
    const context = JSON.parse(row.input_context_json || '{}');
    const value = context[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    // Ignore malformed historical context.
  }
  return fallback;
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  await mkdir(outputDir, { recursive: true });
  const [rows] = await connection.execute(`
    SELECT d.id AS diagnosis_id, d.reported_symptoms, d.confirmed_fault,
           d.input_context_json, v.make, v.model, v.model_year, v.engine_type,
           v.mileage, v.fuel_type, v.transmission_type, v.drive_type,
           rc.work_performed, rc.identified_problems
    FROM ai_diagnoses d
    JOIN vehicles v ON v.id = d.vehicle_id AND v.workshop_id = d.workshop_id
    JOIN jobs j ON j.id = d.job_id AND j.workshop_id = d.workshop_id
    JOIN repair_completions rc ON rc.job_id = j.id AND rc.workshop_id = j.workshop_id
    WHERE d.review_status IN ('confirmed', 'corrected')
      AND d.confirmed_fault IS NOT NULL AND TRIM(d.confirmed_fault) <> ''
      AND rc.verification_status = 'verified'
    ORDER BY rc.verified_at DESC
  `);

  const verified = [];
  for (const row of rows) {
    verified.push({
      example_id: `verified-${row.diagnosis_id}`,
      symptom_text: row.reported_symptoms,
      fault_category: row.confirmed_fault,
      reference_dtc: firstCode(row),
      manufacturer: row.make || 'Not recorded',
      model: row.model || 'Not recorded',
      model_year: row.model_year ?? 0,
      engine_type: row.engine_type || 'Not recorded',
      mileage: row.mileage ?? 0,
      fuel_type: row.fuel_type || 'Not recorded',
      transmission_type: row.transmission_type || 'Not recorded',
      drive_type: row.drive_type || 'Not recorded',
      inspection_findings: contextValue(row, 'inspection_findings', row.identified_problems || 'Not recorded'),
      previous_faults: contextValue(row, 'previous_faults', 'Not recorded'),
      provenance: 'verified_repair',
    });
  }

  writeCsv(verifiedPath, verified);

  const synthetic = readCsv(syntheticPath);
  const seen = new Set();
  const mixed = [];
  for (const row of [...verified, ...synthetic]) {
    const key = headers.slice(1, -1).map((header) => row[header] ?? '').join('\u001f');
    if (seen.has(key)) continue;
    seen.add(key);
    mixed.push(row);
  }
  writeCsv(mixedPath, mixed);
  console.log(JSON.stringify({ verified_rows: verified.length, synthetic_rows: synthetic.length, mixed_rows: mixed.length, verifiedPath, mixedPath }));
} finally {
  await connection.end();
}
