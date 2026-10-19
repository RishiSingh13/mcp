import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PostgresRepository } from '../src/persistence/postgres-repository.js';
import { runMigrations } from '../src/persistence/migrations.js';
import type { Itinerary } from '../src/domain/itinerary.schema.js';

const url=process.env.TEST_DATABASE_URL;
const suite=describe.skipIf(!url)('PostgreSQL persistence integration',()=>{
  const accountId=`tripsync-test-${randomUUID()}`;
  const repo=new PostgresRepository(url!,accountId);
  beforeAll(async()=>{await runMigrations(repo.pool);await repo.pool.query('INSERT INTO accounts(id) VALUES($1)',[accountId]);});
  afterAll(async()=>{await repo.pool.query('DELETE FROM accounts WHERE id=$1',[accountId]);await repo.close();});
  it('persists itinerary, preview, partial and completed sync state, encrypted token, and one-use state',async()=>{
    const id=randomUUID(); const evId=randomUUID();
    const event={id:evId,kind:'activity' as const,title:'Test',start:'2027-03-10T09:00:00+09:00',end:'2027-03-10T10:00:00+09:00',timeZone:'Asia/Tokyo',source:'manual' as const};
    const itinerary:Itinerary={id,title:'Database check',timeZone:'Asia/Tokyo',events:[event],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const previewId=randomUUID();
    await repo.save(itinerary); expect((await repo.get(id))?.title).toBe('Database check');
    await repo.putPreview(previewId,{itineraryId:id,accountId,calendarId:'primary',expiresAt:Date.now()+60000,events:[event],itineraryEvents:[event]});
    expect((await repo.getPreview(previewId))?.itineraryId).toBe(id);
    const key=`${id}:${previewId}`; const sync=await repo.beginSync(key,previewId); expect(sync.status).toBe('pending');
    await repo.saveSyncEvent(key,evId,'google-event');
    expect((await repo.completeSync(key)).eventIds[evId]).toBe('google-event');
    await repo.putCredentials('v1.encrypted-ciphertext'); expect(await repo.getCredentials()).toBe('v1.encrypted-ciphertext');
    await repo.storeOAuthState('state-hash',Date.now()+60000); expect(await repo.consumeOAuthState('state-hash',Date.now())).toBe(true); expect(await repo.consumeOAuthState('state-hash',Date.now())).toBe(false);
  });
});
