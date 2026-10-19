import { google } from 'googleapis';
import { env } from '../config/env.js';
import type { TripEvent } from '../domain/itinerary.schema.js';
import type { RouteEstimator } from '../domain/conflicts.js';
import { demoEmailCandidates } from '../demo/fixtures.js';
import { repository } from '../persistence/instance.js';
import { decryptToken, encryptToken, encryptTokenWithKey } from '../security/token-crypto.js';
import type { ItineraryRepository } from '../persistence/repository.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { parseBookingMessage, type BookingCandidate } from './gmail-bookings.js';

export const oauthClient = (): any => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth is not configured.');
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
};
const tokenSchema=z.object({access_token:z.string().nullable().optional(),refresh_token:z.string().nullable().optional(),expiry_date:z.number().finite().nullable().optional(),token_type:z.string().optional(),scope:z.string().optional(),id_token:z.string().nullable().optional()}).passthrough().refine(v=>Boolean(v.access_token||v.refresh_token),'Google credentials are empty.');
export type GoogleCredentials=z.infer<typeof tokenSchema>;
export const GOOGLE_GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.readonly';
export const GOOGLE_CALENDAR_SCOPE='https://www.googleapis.com/auth/calendar.events.owned';
export function scopesForGoogleAuthorization(capability:'gmail'|'calendar'):string[] {
  return capability==='gmail'?[GOOGLE_GMAIL_SCOPE]:[GOOGLE_CALENDAR_SCOPE];
}
export function credentialHasScope(value:GoogleCredentials|undefined,scope:string):boolean {
  return (value?.scope??'').split(/\s+/).includes(scope);
}
let credentials: GoogleCredentials | undefined;
export function mergeGoogleCredentialUpdate(previous:GoogleCredentials|undefined,value:unknown):GoogleCredentials {
  const parsed=tokenSchema.safeParse(value); if(!parsed.success) throw new Error('Google returned invalid credentials. Reconnect and try again.');
  return {...previous,...parsed.data,refresh_token:parsed.data.refresh_token??previous?.refresh_token};
}
export async function persistEncryptedGoogleCredentials(value:GoogleCredentials,target:Pick<ItineraryRepository,'putCredentials'>,key?:string):Promise<string> {
  const encrypted=key?encryptTokenWithKey(JSON.stringify(value),key):encryptToken(JSON.stringify(value));
  await target.putCredentials(encrypted);
  return encrypted;
}
async function persistCredentials(value:GoogleCredentials) { if(env.DATABASE_URL) await persistEncryptedGoogleCredentials(value,repository); }
export async function setGoogleCredentials(value:unknown) {
  const updated=mergeGoogleCredentialUpdate(credentials,value);
  await persistCredentials(updated);
  credentials=updated;
}
export async function initializeGoogleCredentials() {
  const stored=await repository.getCredentials(); if(!stored)return;
  try { const parsed=tokenSchema.parse(JSON.parse(decryptToken(stored))); credentials=parsed; }
  catch { throw new Error('Stored Google credentials are unavailable. Check TOKEN_ENCRYPTION_KEY and reconnect.'); }
}
export function googleAuth(): any {
  if (!credentials || (credentials.expiry_date!==undefined&&credentials.expiry_date!==null&&credentials.expiry_date<=Date.now()&&!credentials.refresh_token)) throw new Error('Google is not connected or credentials expired. Reconnect at /auth/google.');
  const c=oauthClient(); c.setCredentials(credentials);
  c.on('tokens',(updated:any)=>{ void setGoogleCredentials(updated).catch(error=>logger.error({name:error instanceof Error?error.name:'Error'},'Google token refresh could not be persisted')); });
  return c;
}
export function requireGoogleScope(scope:string,capability:'Gmail'|'Calendar'):void {
  if(!credentials) {
    if(capability==='Calendar') throw new Error('Calendar authorization is required. Authorize at /auth/google/calendar.');
    throw new Error('Google is not connected or credentials expired. Reconnect at /auth/google.');
  }
  if(!credentialHasScope(credentials,scope)) throw new Error(`${capability} authorization is required. Authorize at ${capability==='Calendar'?'/auth/google/calendar':'/auth/google'}.`);
}
export function googleStatus() { return { configured: Boolean(env.GOOGLE_CLIENT_ID), connected: Boolean(credentials), demoMode:env.DEMO_MODE, storage: env.DATABASE_URL?'encrypted PostgreSQL':'process memory' }; }
export function integrationProvenance(connected:boolean,demoMode:boolean):'live'|'simulated'|'unavailable' { return connected?'live':demoMode?'simulated':'unavailable'; }
export function calendarSource(): 'live'|'simulated'|'unavailable' {
  return env.GOOGLE_CALENDAR_ENABLED&&credentialHasScope(credentials,GOOGLE_CALENDAR_SCOPE)?'live':'unavailable';
}
export function gmailSource(): 'live'|'simulated'|'unavailable' {
  return credentialHasScope(credentials,GOOGLE_GMAIL_SCOPE)?'live':env.DEMO_MODE?'simulated':'unavailable';
}
export async function verifyGmailAuthorization(api?:any):Promise<boolean> {
  if(!api) requireGoogleScope(GOOGLE_GMAIL_SCOPE,'Gmail');
  let auth:any;
  if(!api) {
    auth=googleAuth();
    try { await auth.getAccessToken(); }
    catch(error) { if(error&&typeof error==='object') Object.assign(error,{gmailFailureStage:'token_refresh'}); throw error; }
  }
  const client=api??google.gmail({version:'v1',auth:auth as any} as any);
  const response=await client.users.getProfile({userId:'me',fields:'emailAddress',timeout:8000});
  return typeof response.data?.emailAddress==='string'&&response.data.emailAddress.length>0;
}

export type RouteWaypoint = string | {address:string} | {placeId:string};
const mapsWaypoint=(value:RouteWaypoint)=>typeof value==='string'?{address:value}:'placeId' in value?{placeId:value.placeId}:{address:value.address};
export const estimateRouteWithApi = async (from:RouteWaypoint,to:RouteWaypoint,departureTime:string,travelMode:'DRIVE'|'TRANSIT'|'WALK',apiKey:string,fetcher:typeof fetch=fetch): Promise<{status:'live'|'simulated'|'unavailable';durationMinutes?:number;distanceMeters?:number;source:string}> => {
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const routeRequest:{origin:{address:string}|{placeId:string};destination:{address:string}|{placeId:string};travelMode:string;departureTime?:string}={origin:mapsWaypoint(from),destination:mapsWaypoint(to),travelMode,...(departureTime?{departureTime}:{})};
    const resp=await fetcher('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'routes.duration,routes.distanceMeters'},body:JSON.stringify(routeRequest)});
    if (!resp.ok) return {status:'unavailable',source:`Google Routes API returned ${resp.status}`};
    const data=await resp.json() as {routes?:{duration?:string;distanceMeters?:number}[]}; const r=data.routes?.[0]; if(!r?.duration) return {status:'unavailable',source:'Google Routes API returned no route'};
    const duration=/^(\d+(?:\.\d+)?)s$/.exec(r.duration); const seconds=duration?Number(duration[1]):NaN;
    if(!Number.isFinite(seconds)||seconds<0) return {status:'unavailable',source:'Google Routes API returned an invalid duration'};
    const distance=r.distanceMeters;
    return {status:'live',source:'Google Routes API',durationMinutes:seconds/60,...(typeof distance==='number'&&Number.isFinite(distance)&&distance>=0?{distanceMeters:distance}:{})};
  } catch { return {status:'unavailable',source:'Google Routes API request failed or timed out'}; } finally { clearTimeout(timeout); }
};
export const estimateRoute = async (from:RouteWaypoint,to:RouteWaypoint,departureTime:string,travelMode:'DRIVE'|'TRANSIT'|'WALK'='DRIVE') => {
  if (!env.GOOGLE_MAPS_API_KEY) return {status: env.DEMO_MODE ? 'simulated' as const:'unavailable' as const, source: env.DEMO_MODE ? 'demo provider (no live route data)':'Google Routes API not configured', ...(env.DEMO_MODE ? {durationMinutes: 35, distanceMeters: 12000}:{})};
  return estimateRouteWithApi(from,to,departureTime,travelMode,env.GOOGLE_MAPS_API_KEY);
};
export const liveRoutes: RouteEstimator = (from,to,departureTime)=>estimateRoute(from,to,departureTime,'DRIVE');

function calendarApi(): any {
  if(!env.GOOGLE_CALENDAR_ENABLED) throw new Error('Calendar authorization is required. Enable GOOGLE_CALENDAR_ENABLED and authorize at /auth/google/calendar.');
  requireGoogleScope(GOOGLE_CALENDAR_SCOPE,'Calendar');
  return google.calendar({version:'v3',auth:googleAuth() as any} as any);
}
export type CalendarEvent = {id:string;title:string;start:string;end:string;timeZone:string;location:string;status:string;source?:'live'|'simulated'};
export async function readCalendar(timeMin:string,timeMax:string,calendarId='primary',maxResults=50):Promise<CalendarEvent[]> {
  const response=await calendarApi().events.list({calendarId,timeMin,timeMax,maxResults:Math.min(maxResults,100),singleEvents:true,orderBy:'startTime',fields:'items(id,summary,start,end,location,status)',timeout:10000});
  return (response.data.items??[]).map((e:any)=>({id:e.id??'',title:e.summary??'(untitled)',start:e.start?.dateTime??e.start?.date??'',end:e.end?.dateTime??e.end?.date??'',timeZone:e.start?.timeZone??'',location:e.location??'',status:e.status??'',source:'live' as const}));
}
export async function findEmailCandidatesWithApi(query:string, maxResults:number, gmail:any):Promise<BookingCandidate[]> {
  const parsedQuery=z.string().max(200).safeParse(query);
  const parsedMax=z.number().int().min(1).max(10).safeParse(maxResults);
  if(!parsedQuery.success||!parsedMax.success) throw new Error('Invalid Gmail search input.');
  const safe=parsedQuery.data.replace(/[\r\n"\\]/g,' ').trim().slice(0,200);
  const q=[safe?`"${safe}"`:'','(flight OR hotel OR train OR transit OR transport OR activity OR tour OR reservation OR itinerary OR booking OR confirmation OR ticket OR check-in)'].filter(Boolean).join(' ');
  const listed=await gmail.users.messages.list({userId:'me',q,maxResults:parsedMax.data,fields:'messages(id,threadId)',timeout:10000});
  const listing=z.object({messages:z.array(z.object({id:z.string().min(1).max(200),threadId:z.string().max(200).optional()}).passthrough()).max(100).optional()}).passthrough().safeParse(listed.data);
  if(!listing.success) throw new Error('Google Gmail returned an invalid search response.');
  const candidates:BookingCandidate[]=[];
  const items=listing.data.messages?.slice(0,parsedMax.data)??[];
  for(const item of items) {
    if(typeof item?.id!=='string'||!item.id||item.id.length>200) continue;
      const msg=await gmail.users.messages.get({userId:'me',id:item.id,format:'full',fields:'id,threadId,internalDate,payload(mimeType,filename,headers(name,value),body(data),parts)',timeout:10000});
    const candidate=parseBookingMessage(msg.data);
    if(candidate) candidates.push(candidate);
  }
  return candidates;
}

export async function findEmailCandidates(query:string, maxResults=5) {
  if(!credentials&&env.DEMO_MODE) return demoEmailCandidates.filter(c=>!query||`${c.subject} ${c.snippet}`.toLowerCase().includes(query.toLowerCase())).slice(0,Math.min(10,maxResults)).map(c=>({...c}));
  requireGoogleScope(GOOGLE_GMAIL_SCOPE,'Gmail');
  const gmail: any=google.gmail({version:'v1',auth:googleAuth() as any} as any);
  return findEmailCandidatesWithApi(query,maxResults,gmail);
}
export async function createCalendarEvents(events:TripEvent[],calendarId='primary') {
  const result:string[]=[]; for(const event of events) result.push(await createCalendarEvent(event,calendarId)); return result;
}

export const stableCalendarEventId=(tripEventId:string)=>`ts${tripEventId.replaceAll('-','')}`;
export const calendarSyncFingerprint=(event:TripEvent)=>createHash('sha256').update(JSON.stringify({title:event.title,start:event.start,end:event.end,timeZone:event.timeZone,location:event.location?.address??event.location?.name??event.location?.placeId??''})).digest('hex');
export async function createCalendarEventWithApi(event:TripEvent,calendarId:string,api:any):Promise<string> {
  const marker=`tripsync:${event.id}`;
  // Hex is a valid base32hex subset. A deterministic ID lets a retry recover after
  // Google accepted an insert but the process died before persisting its response.
  const stableId=stableCalendarEventId(event.id);
  const fingerprint=calendarSyncFingerprint(event);
  try {
    const created=await api.events.insert({calendarId,requestBody:{id:stableId,summary:event.title,start:{dateTime:event.start,timeZone:event.timeZone},end:{dateTime:event.end,timeZone:event.timeZone},location:event.location?.address??event.location?.name,description:marker,extendedProperties:{private:{tripsyncEventId:event.id,tripsyncFingerprint:fingerprint}}},fields:'id',timeout:10000});
    if(created.data.id) return created.data.id;
    throw new Error('Google Calendar did not return an event identifier.');
  } catch(error) {
    const status=(error as {code?:number;response?:{status?:number}})?.code??(error as {response?:{status?:number}})?.response?.status;
    if(status!==409) throw error;
    try {
      const existing=await api.events.get({calendarId,eventId:stableId,fields:'id,description,extendedProperties,status',timeout:10000});
      const found=existing.data;
      if(found.id===stableId&&found.status!=='cancelled'&&found.extendedProperties?.private?.tripsyncEventId===event.id&&found.extendedProperties?.private?.tripsyncFingerprint===fingerprint) return stableId;
      throw new Error('A Google Calendar event ID collision prevented safe recovery.');
    } catch(recoveryError) {
      const recoveryStatus=(recoveryError as {code?:number;response?:{status?:number}})?.code??(recoveryError as {response?:{status?:number}})?.response?.status;
      if(recoveryStatus===404) throw error;
      throw recoveryError;
    }
  }
}
export async function createCalendarEvent(event:TripEvent,calendarId='primary'):Promise<string> { return createCalendarEventWithApi(event,calendarId,calendarApi()); }
