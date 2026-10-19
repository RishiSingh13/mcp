import { Pool } from 'pg';
import { env } from '../config/env.js';

if(!env.DATABASE_URL) throw new Error('DATABASE_URL is required to reset the TripSync database.');
if(env.NODE_ENV==='production') throw new Error('Database reset is disabled in production.');
if(process.env.RESET_DATABASE_CONFIRM!=='tripsync') throw new Error('Set RESET_DATABASE_CONFIRM=tripsync to confirm deleting TripSync application data.');
const pool=new Pool({connectionString:env.DATABASE_URL,application_name:'tripsync-reset'});
const client=await pool.connect();
try { await client.query('BEGIN'); await client.query('TRUNCATE oauth_credentials,oauth_states,calendar_syncs,calendar_previews,itineraries,accounts CASCADE'); await client.query('COMMIT'); console.log('TripSync application data cleared.'); }
catch { await client.query('ROLLBACK'); console.error('Reset failed. Check database availability and schema status.'); process.exitCode=1; }
finally { client.release(); await pool.end(); }
