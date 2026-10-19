import { Pool } from 'pg';
import type { Itinerary } from '../domain/itinerary.schema.js';
import type { ItineraryRepository, PreviewRecord, SyncRecord } from './repository.js';

export class PostgresRepository implements ItineraryRepository {
  readonly pool: Pool;
  constructor(connectionString: string, readonly accountId: string) { this.pool = new Pool({ connectionString, max: 10, application_name: 'tripsync-mcp' }); }
  async close() { await this.pool.end(); }
  async save(itinerary: Itinerary) {
    await this.pool.query('INSERT INTO itineraries(account_id,id,data) VALUES($1,$2,$3) ON CONFLICT(account_id,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [this.accountId,itinerary.id,itinerary]);
  }
  async get(id: string) {
    const r=await this.pool.query<{data:Itinerary}>('SELECT data FROM itineraries WHERE account_id=$1 AND id=$2',[this.accountId,id]);
    return r.rows[0]?.data;
  }
  async putPreview(id: string, data: PreviewRecord) {
    if(data.accountId!==this.accountId) throw new Error('Preview account does not match the active account.');
    await this.pool.query('INSERT INTO calendar_previews(account_id,id,itinerary_id,expires_at,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,id) DO UPDATE SET expires_at=EXCLUDED.expires_at,data=EXCLUDED.data',[this.accountId,id,data.itineraryId,new Date(data.expiresAt),data]);
  }
  async getPreview(id: string) {
    const r=await this.pool.query<{data:PreviewRecord}>('SELECT data FROM calendar_previews WHERE account_id=$1 AND id=$2',[this.accountId,id]);
    return r.rows[0]?.data;
  }
  async getSync(key: string) {
    const r=await this.pool.query<{preview_id:string;status:'pending'|'complete';event_ids:Record<string,string>}>('SELECT preview_id,status,event_ids FROM calendar_syncs WHERE account_id=$1 AND idempotency_key=$2',[this.accountId,key]);
    const row=r.rows[0]; return row?{previewId:row.preview_id,status:row.status,eventIds:row.event_ids}:undefined;
  }
  async beginSync(key: string, previewId: string) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO calendar_syncs(account_id,idempotency_key,preview_id,status,event_ids) VALUES($1,$2,$3,\'pending\',$4) ON CONFLICT(account_id,idempotency_key) DO NOTHING',[this.accountId,key,previewId,{}]);
      const r=await client.query<{preview_id:string;status:'pending'|'complete';event_ids:Record<string,string>}>('SELECT preview_id,status,event_ids FROM calendar_syncs WHERE account_id=$1 AND idempotency_key=$2 FOR UPDATE',[this.accountId,key]);
      const row=r.rows[0]; if(!row||row.preview_id!==previewId) throw new Error('Synchronization context does not match the preview.');
      await client.query('COMMIT'); return {previewId:row.preview_id,status:row.status,eventIds:row.event_ids};
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async saveSyncEvent(key: string, tripEventId: string, externalEventId: string) {
    await this.pool.query("UPDATE calendar_syncs SET event_ids=event_ids || jsonb_build_object($3::text,$4::text),updated_at=now() WHERE account_id=$1 AND idempotency_key=$2 AND status='pending'",[this.accountId,key,tripEventId,externalEventId]);
  }
  async completeSync(key: string) {
    const r=await this.pool.query<{preview_id:string;status:'pending'|'complete';event_ids:Record<string,string>}>("UPDATE calendar_syncs SET status='complete',completed_at=now(),updated_at=now() WHERE account_id=$1 AND idempotency_key=$2 RETURNING preview_id,status,event_ids",[this.accountId,key]);
    const row=r.rows[0]; if(!row) throw new Error('Synchronization was not initialized.');
    return {previewId:row.preview_id,status:row.status,eventIds:row.event_ids};
  }
  async getCredentials() {
    const r=await this.pool.query<{ciphertext:string}>('SELECT ciphertext FROM oauth_credentials WHERE account_id=$1',[this.accountId]); return r.rows[0]?.ciphertext;
  }
  async putCredentials(ciphertext: string) {
    await this.pool.query('INSERT INTO oauth_credentials(account_id,ciphertext,updated_at) VALUES($1,$2,now()) ON CONFLICT(account_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=now()',[this.accountId,ciphertext]);
  }
  async storeOAuthState(hash: string, expiresAt: number) {
    await this.pool.query('DELETE FROM oauth_states WHERE account_id=$1 AND expires_at < now()',[this.accountId]);
    await this.pool.query('INSERT INTO oauth_states(account_id,state_hash,expires_at) VALUES($1,$2,$3)',[this.accountId,hash,new Date(expiresAt)]);
  }
  async consumeOAuthState(hash: string, now: number) {
    const r=await this.pool.query('DELETE FROM oauth_states WHERE account_id=$1 AND state_hash=$2 AND expires_at >= to_timestamp($3/1000.0) RETURNING state_hash',[this.accountId,hash,now]);
    // Delete expired matches as well, ensuring a state value is single-use either way.
    await this.pool.query('DELETE FROM oauth_states WHERE account_id=$1 AND state_hash=$2',[this.accountId,hash]);
    return r.rowCount===1;
  }
}
