import { describe,expect,it } from 'vitest';
import { MemoryRepository } from '../src/persistence/memory-repository.js';

describe('in-memory repository synchronization and OAuth state',()=>{
  it('tracks partial sync progress and idempotent completion',async()=>{
    const repository=new MemoryRepository();
    const started=await repository.beginSync('trip:preview','preview');
    expect(started).toEqual({previewId:'preview',status:'pending',eventIds:{}});
    await repository.saveSyncEvent('trip:preview','trip-event','google-event');
    const completed=await repository.completeSync('trip:preview');
    expect(completed).toEqual({previewId:'preview',status:'complete',eventIds:{'trip-event':'google-event'}});
    expect(await repository.beginSync('trip:preview','preview')).toEqual(completed);
  });
  it('validates and consumes OAuth state exactly once, including expired state',async()=>{
    const repository=new MemoryRepository();
    await repository.storeOAuthState('active',200);
    expect(await repository.consumeOAuthState('active',100)).toBe(true);
    expect(await repository.consumeOAuthState('active',100)).toBe(false);
    await repository.storeOAuthState('expired',100);
    expect(await repository.consumeOAuthState('expired',101)).toBe(false);
    expect(await repository.consumeOAuthState('expired',99)).toBe(false);
  });
});
