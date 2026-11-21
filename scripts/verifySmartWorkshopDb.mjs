/**
 * Read-only verification of the Smart Workshop catalogue migration and seed.
 * Run with: node scripts/verifySmartWorkshopDb.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const expected = [
  'vehicle_manufacturers', 'vehicle_models', 'vehicle_specifications',
  'mechanical_systems', 'vehicle_components', 'vehicle_model_systems',
  'vehicle_fault_records', 'vehicle_3d_assets',
];

const [migrations] = await connection.query('SELECT version FROM schema_migrations ORDER BY version');
const counts = {};
for (const name of expected) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM ${name}`);
  counts[name] = rows[0].n;
}

const [vehicles] = await connection.query(`
  SELECT COUNT(*) AS n FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'vehicles'
    AND column_name IN ('catalogue_model_id', 'engine_type', 'fuel_type', 'transmission_type', 'drive_type')
`);

const result = {
  migrations: migrations.map((row) => row.version),
  counts,
  vehicleSpecificationColumnsAdded: vehicles[0].n,
};
console.log(JSON.stringify(result, null, 2));

const ok = result.migrations.includes('005_smart_workshop_catalogue.sql')
  && expected.every((name) => counts[name] > 0)
  && result.vehicleSpecificationColumnsAdded === 5;
await connection.end();
if (!ok) process.exitCode = 1;
