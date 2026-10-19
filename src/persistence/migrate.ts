import { Pool } from 'pg';
import { env } from '../config/env.js';
import { runMigrations } from './migrations.js';

if(!env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations.');
const pool=new Pool({connectionString:env.DATABASE_URL,application_name:'tripsync-migrations'});
try { await runMigrations(pool); console.log('TripSync migrations are up to date.'); }
catch { console.error('Migration failed. Check database availability and SQL diagnostics locally.'); process.exitCode=1; }
finally { await pool.end(); }
