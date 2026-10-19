import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

export async function runMigrations(pool:Pool,directory=join(process.cwd(),'migrations')) {
  await pool.query('CREATE TABLE IF NOT EXISTS tripsync_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files=(await readdir(directory)).filter(f=>/^\d+_[a-z0-9_-]+\.sql$/i.test(f)).sort();
  for(const name of files) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const done=await client.query('SELECT name FROM tripsync_migrations WHERE name=$1',[name]);
      if(done.rowCount===0) {
        const sql=await readFile(join(directory,name),'utf8');
        await client.query(sql);
        await client.query('INSERT INTO tripsync_migrations(name) VALUES($1)',[name]);
      }
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
}
