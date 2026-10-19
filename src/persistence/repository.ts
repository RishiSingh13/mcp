import type { Itinerary } from '../domain/itinerary.schema.js';
export interface ItineraryRepository {
  save(itinerary: Itinerary): Promise<void>; get(id: string): Promise<Itinerary | undefined>;
  putPreview(id: string, data: PreviewRecord): Promise<void>; getPreview(id: string): Promise<PreviewRecord | undefined>;
  getSync(key: string): Promise<SyncRecord | undefined>; beginSync(key: string, previewId: string): Promise<SyncRecord>;
  saveSyncEvent(key: string, tripEventId: string, externalEventId: string): Promise<void>;
  completeSync(key: string): Promise<SyncRecord>;
  getCredentials(): Promise<string | undefined>; putCredentials(value: string): Promise<void>;
  storeOAuthState(stateHash: string, expiresAt: number): Promise<void>; consumeOAuthState(stateHash: string, now: number): Promise<boolean>;
}
export type PreviewRecord = { itineraryId: string; accountId: string; calendarId: string; expiresAt: number; events: Itinerary['events']; itineraryEvents: Itinerary['events'] };
export type SyncRecord = { previewId: string; status: 'pending' | 'complete'; eventIds: Record<string, string> };
