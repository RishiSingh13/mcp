import { z } from 'zod';

export const eventKindSchema = z.enum(['flight','hotel','ground_transport','activity','other']);
const validZone = (v: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch { return false; } };
const timestampMatchesZone = (value:string,zone:string) => {
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(value);
  if(!match)return false;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const actual=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return actual.year===match[1]&&actual.month===match[2]&&actual.day===match[3]&&actual.hour===match[4]&&actual.minute===match[5]&&actual.second===match[6];
};
export const timestampSchema = z.string().datetime({ offset: true });
export const locationSchema = z.object({ name: z.string().max(200).optional(), address: z.string().max(500).optional(), placeId: z.string().max(200).optional() }).strict();
export const tripEventInputSchema = z.object({
  id: z.string().uuid().optional(), kind: eventKindSchema, title: z.string().trim().min(1).max(200),
  start: timestampSchema, end: timestampSchema, timeZone: z.string().refine(validZone, 'Must be a valid IANA time zone'),
  location: locationSchema.optional(), bookingReference: z.string().max(100).optional(),
  source: z.enum(['manual','gmail','calendar','demo']).default('manual'), sourceReference: z.string().max(200).optional(), notes: z.string().max(1000).optional()
}).strict().superRefine((e, ctx) => {
  if (Date.parse(e.end) <= Date.parse(e.start)) ctx.addIssue({ code: 'custom', path: ['end'], message: 'end must be after start' });
  if(validZone(e.timeZone)) for(const field of ['start','end'] as const) if(!timestampMatchesZone(e[field],e.timeZone)) ctx.addIssue({code:'custom',path:[field],message:`${field} local time and offset do not match timeZone (including DST transitions).`});
});
export const itineraryInputSchema = z.object({ title: z.string().trim().min(1).max(200), destination: z.string().max(200).optional(), timeZone: z.string().refine(validZone, 'Must be a valid IANA time zone'), events: z.array(tripEventInputSchema).max(100) }).strict();
export type TripEvent = z.infer<typeof tripEventInputSchema> & { id: string };
export type Itinerary = { id: string; title: string; destination?: string; timeZone: string; events: TripEvent[]; createdAt: string; updatedAt: string };
