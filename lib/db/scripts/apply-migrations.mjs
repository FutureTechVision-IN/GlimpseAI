import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before running DB compatibility migrations.");
}

const dbDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(dbDir, "migrations");
const migrationFiles = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();

  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await client.query(sql);
    console.log(`Applied compatibility migration: ${file}`);
  }
} finally {
  await client.end();
}
