import type { Itinerary } from '../domain/itinerary.schema.js';
import type { ItineraryRepository, PreviewRecord, SyncRecord } from './repository.js';
export class MemoryRepository implements ItineraryRepository {
  private itineraries = new Map<string, Itinerary>(); private previews = new Map<string, PreviewRecord>(); private syncs = new Map<string,SyncRecord>(); private credentials?:string; private states=new Map<string,number>();
  async save(v: Itinerary) { this.itineraries.set(v.id, structuredClone(v)); }
  async get(id: string) { const v = this.itineraries.get(id); return v ? structuredClone(v) : undefined; }
  async putPreview(id: string, v: PreviewRecord) { this.previews.set(id, structuredClone(v)); }
  async getPreview(id: string) { const v = this.previews.get(id); return v ? structuredClone(v) : undefined; }
  async getSync(k: string) { const v = this.syncs.get(k); return v ? structuredClone(v) : undefined; }
  async beginSync(k: string, previewId: string) { let v=this.syncs.get(k); if(v&&v.previewId!==previewId)throw new Error('Synchronization context does not match the preview.'); if(!v){v={previewId,status:'pending',eventIds:{}};this.syncs.set(k,v);} return structuredClone(v); }
  async saveSyncEvent(k: string, tripEventId: string, externalEventId: string) { const v=this.syncs.get(k); if(!v) throw new Error('Synchronization was not initialized.'); v.eventIds[tripEventId]=externalEventId; }
  async completeSync(k: string) { const v=this.syncs.get(k); if(!v) throw new Error('Synchronization was not initialized.'); v.status='complete'; return structuredClone(v); }
  async getCredentials() { return this.credentials; }
  async putCredentials(value: string) { this.credentials=value; }
  async storeOAuthState(hash: string, expiresAt: number) { this.states.set(hash,expiresAt); }
  async consumeOAuthState(hash: string, now: number) { const expires=this.states.get(hash); this.states.delete(hash); return expires!==undefined&&expires>=now; }
}
