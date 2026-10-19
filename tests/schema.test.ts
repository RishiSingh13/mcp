import { describe,it,expect } from 'vitest';
import { tripEventInputSchema } from '../src/domain/itinerary.schema.js';
describe('trip event schema',()=>{
  it('rejects end before start and invalid time zones',()=>{
    const base={kind:'activity',title:'Visit',start:'2027-03-10T10:00:00+05:30',end:'2027-03-10T09:00:00+05:30',timeZone:'Not/AZone'};
    expect(tripEventInputSchema.safeParse(base).success).toBe(false);
  });
  it('requires explicit offset timestamps',()=>{
    expect(tripEventInputSchema.safeParse({kind:'activity',title:'Visit',start:'2027-03-10T10:00:00',end:'2027-03-10T11:00:00Z',timeZone:'Asia/Kolkata'}).success).toBe(false);
  });
  it('rejects impossible calendar dates',()=>{
    expect(tripEventInputSchema.safeParse({kind:'activity',title:'Visit',start:'2027-02-30T10:00:00Z',end:'2027-03-01T10:00:00Z',timeZone:'Asia/Tokyo'}).success).toBe(false);
  });
  it('rejects a nonexistent spring-forward local time but accepts either valid fall-back offset',()=>{
    const base={kind:'activity',title:'Visit',timeZone:'America/New_York'};
    expect(tripEventInputSchema.safeParse({...base,start:'2027-03-14T02:30:00-05:00',end:'2027-03-14T03:30:00-04:00'}).success).toBe(false);
    expect(tripEventInputSchema.safeParse({...base,start:'2027-11-07T01:30:00-04:00',end:'2027-11-07T01:30:00-05:00'}).success).toBe(true);
  });
  it('accepts events that cross midnight using explicit offsets',()=>{
    expect(tripEventInputSchema.safeParse({kind:'flight',title:'Overnight flight',start:'2027-03-10T23:30:00+09:00',end:'2027-03-11T01:30:00+09:00',timeZone:'Asia/Tokyo'}).success).toBe(true);
  });
});
