import { describe,expect,it,vi } from 'vitest';
import { calendarSyncFingerprint,createCalendarEventWithApi,stableCalendarEventId } from '../src/integrations/google.js';
import type { TripEvent } from '../src/domain/itinerary.schema.js';

const event:TripEvent={id:'123e4567-e89b-12d3-a456-426614174000',kind:'activity',title:'Museum',start:'2027-03-10T09:00:00+09:00',end:'2027-03-10T10:00:00+09:00',timeZone:'Asia/Tokyo',source:'manual'};
describe('Google Calendar retry recovery',()=>{
  it('uses a stable Google-compatible ID and recovers an event after an ambiguous insert',async()=>{
    const eventId=stableCalendarEventId(event.id); expect(eventId).toMatch(/^ts[0-9a-f]{32}$/);
    const api={events:{insert:vi.fn().mockRejectedValue({code:409}),get:vi.fn().mockResolvedValue({data:{id:eventId,description:`tripsync:${event.id}`,extendedProperties:{private:{tripsyncEventId:event.id,tripsyncFingerprint:calendarSyncFingerprint(event)}}}})}};
    await expect(createCalendarEventWithApi(event,'primary',api)).resolves.toBe(eventId);
    expect(api.events.get).toHaveBeenCalledWith(expect.objectContaining({eventId}));
  });
  it('does not claim an unrelated pre-existing event after an ID conflict',async()=>{
    const api={events:{insert:vi.fn().mockRejectedValue({code:409}),get:vi.fn().mockResolvedValue({data:{id:stableCalendarEventId(event.id),description:'other event',extendedProperties:{private:{tripsyncEventId:event.id,tripsyncFingerprint:'stale'}}}})}};
    await expect(createCalendarEventWithApi(event,'primary',api)).rejects.toThrow(/ID collision/);
  });
  it('recovers concurrent commits to the same stable external ID',async()=>{
    let inserted=false;
    const eventId=stableCalendarEventId(event.id);
    const api={events:{insert:vi.fn(async()=>{if(inserted)throw {code:409};inserted=true;return {data:{id:eventId}};}),get:vi.fn(async()=>({data:{id:eventId,description:`tripsync:${event.id}`,extendedProperties:{private:{tripsyncEventId:event.id,tripsyncFingerprint:calendarSyncFingerprint(event)}}}}))}};
    const results=await Promise.all([createCalendarEventWithApi(event,'primary',api),createCalendarEventWithApi(event,'primary',api)]);
    expect(results).toEqual([eventId,eventId]); expect(api.events.insert).toHaveBeenCalledTimes(2);
  });
});
