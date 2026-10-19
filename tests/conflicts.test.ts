import { describe,it,expect } from 'vitest';
import { analyzeEvents } from '../src/domain/conflicts.js';
import type { TripEvent } from '../src/domain/itinerary.schema.js';
const event=(id:string,start:string,end:string,location?:string):TripEvent=>({id,kind:'activity',title:id,start,end,timeZone:'Asia/Kolkata',source:'manual',...(location?{location:{address:location}}:{})});
describe('analyzeEvents',()=>{
  it('does not flag adjacent events as overlaps and sorts by instant',async()=>{
    const events=[event('b','2027-03-10T11:00:00+05:30','2027-03-10T12:00:00+05:30'),event('a','2027-03-10T09:30:00+05:30','2027-03-10T11:00:00+05:30')];
    expect(await analyzeEvents(events,30,async()=>({status:'unavailable',source:'test'}),false)).toEqual([]);
  });
  it('detects overlap by instant across offsets',async()=>{
    const f=await analyzeEvents([event('a','2027-03-10T09:00:00+05:30','2027-03-10T10:00:00+05:30'),event('b','2027-03-10T04:00:00Z','2027-03-10T06:00:00Z')],30,async()=>({status:'unavailable',source:'test'}),false);
    expect(f[0]?.code).toBe('overlap');
  });
  it('flags missing location and tight transfers',async()=>{
    const missing=await analyzeEvents([event('a','2027-03-10T09:00:00Z','2027-03-10T10:00:00Z'),event('b','2027-03-10T10:20:00Z','2027-03-10T11:00:00Z')],30,async()=>({status:'unavailable',source:'test'}));
    expect(missing[0]?.type).toBe('missing_information');
    const f=await analyzeEvents([event('a','2027-03-10T09:00:00Z','2027-03-10T10:00:00Z','A'),event('b','2027-03-10T10:40:00Z','2027-03-10T11:00:00Z','B')],30,async()=>({status:'live',source:'test',durationMinutes:30}));
    expect(f[0]?.type).toBe('tight_transfer');
  });
  it('flags insufficient ground-transfer time as a conflict',async()=>{
    const f=await analyzeEvents([event('a','2027-03-10T09:00:00Z','2027-03-10T10:00:00Z','A'),event('b','2027-03-10T10:20:00Z','2027-03-10T11:00:00Z','B')],30,async()=>({status:'simulated',source:'fixture',durationMinutes:35}));
    expect(f).toContainEqual(expect.objectContaining({type:'conflict',code:'impossible_transfer',availableMinutes:20,requiredMinutes:65}));
  });
});
