import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { splitSqlStatements } from './sqlStatements';

type SqlValue = string | number | boolean | Date | Buffer | null | undefined;
type QueryResult = RowDataPacket[] | ResultSetHeader;

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10),
  charset: 'utf8mb4',
  timezone: 'Z',
  flags: ['FOUND_ROWS'],
});

const transactionConnection = new AsyncLocalStorage<PoolConnection | null>();
let poolClosed = false;

async function runSql(sql: string, values: SqlValue[] = []): Promise<QueryResult> {
  const parameters = values.map((value) => value ?? null) as (string | number | boolean | Date | Buffer | null)[];
  const activeConnection = transactionConnection.getStore();
  if (activeConnection) {
    const [result] = await activeConnection.execute(sql, parameters);
    return result as QueryResult;
  }

  const [result] = await pool.execute(sql, parameters);
  return result as QueryResult;
}

async function queryRows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
  const result = await runSql(sql, values);
  if (!Array.isArray(result)) throw new Error('Expected a MySQL row result.');
  return result as T[];
}

async function queryFirst<T>(sql: string, values: SqlValue[] = []): Promise<T | undefined> {
  const rows = await queryRows<T>(sql, values);
  return rows[0];
}

async function executeStatement(sql: string, values: SqlValue[] = []): Promise<ResultSetHeader> {
  const result = await runSql(sql, values);
  if (Array.isArray(result)) throw new Error('Expected a MySQL execution result.');
  return result;
}

export const db = {
  query<T = RowDataPacket>(sql: string, ...values: SqlValue[]): Promise<T[]> {
    return queryRows<T>(sql, values);
  },

  first<T = RowDataPacket>(sql: string, ...values: SqlValue[]): Promise<T | undefined> {
    return queryFirst<T>(sql, values);
  },

  execute(sql: string, ...values: SqlValue[]): Promise<ResultSetHeader> {
    return executeStatement(sql, values);
  },

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (transactionConnection.getStore()) return work();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await transactionConnection.run(connection, work);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  },

  async close(): Promise<void> {
    if (poolClosed) return;
    poolClosed = true;
    await pool.end();
  },
};

export async function initializeDatabase(): Promise<void> {
  if (!process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) {
    throw new Error('Set MYSQL_USER and MYSQL_DATABASE in .env before starting the server.');
  }

  await pool.query('SELECT 1');
  const [migrationTable] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS found
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'`
  );
  if (Number(migrationTable[0]?.found) === 0) {
    await pool.query(`CREATE TABLE schema_migrations (
      version VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  const migrations = [
    { version: '001_initial_schema.sql', url: new URL('./schema.sql', import.meta.url) },
    { version: '002_ai_diagnoses.sql', url: new URL('./migrations/002_ai_diagnoses.sql', import.meta.url) },
    { version: '003_smart_workshop.sql', url: new URL('./migrations/003_smart_workshop.sql', import.meta.url) },
    { version: '004_mechanic_management.sql', url: new URL('./migrations/004_mechanic_management.sql', import.meta.url) },
    { version: '005_smart_workshop_catalogue.sql', url: new URL('./migrations/005_smart_workshop_catalogue.sql', import.meta.url) },
    { version: '006_customer_sessions.sql', url: new URL('./migrations/006_customer_sessions.sql', import.meta.url) },
    { version: '007_ai_intelligence.sql', url: new URL('./migrations/007_ai_intelligence.sql', import.meta.url) },
    { version: '008_vehicle_asset_catalogue.sql', url: new URL('./migrations/008_vehicle_asset_catalogue.sql', import.meta.url) },
    { version: '009_customer_portal.sql', url: new URL('./migrations/009_customer_portal.sql', import.meta.url) },
  ];
  for (const migration of migrations) {
    const [appliedRows] = await pool.execute<RowDataPacket[]>(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [migration.version]
    );
    if (appliedRows.length > 0) continue;

    const schema = await readFile(fileURLToPath(migration.url), 'utf8');
    const connection = await pool.getConnection();
    try {
      for (const statement of splitSqlStatements(schema)) {
        await connection.query(statement);
      }
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [migration.version]);
    } finally {
      connection.release();
    }
  }
}
