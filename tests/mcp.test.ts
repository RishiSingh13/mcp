import { afterEach,describe,expect,it,vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/mcp/create-server.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';

describe('MCP server protocol',()=>{
  const transports:InMemoryTransport[]=[];
  afterEach(async()=>{await Promise.all(transports.splice(0).map(t=>t.close()));});
  it('discovers and exercises all eight tools with valid and invalid inputs',async()=>{
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();transports.push(clientTransport,serverTransport);
    const reads=vi.fn(async()=>[]); const writes=vi.fn(async(event:{id:string})=>`google-${event.id}`);
    const server=createServer({repository:new MemoryRepository(),integrations:{calendarSource:()=> 'live',liveRoutes:async()=>({status:'live',source:'test route',durationMinutes:20}),estimateRoute:async()=>({status:'live',source:'test route',durationMinutes:20,distanceMeters:1000}),findEmailCandidates:async()=>[{id:'mail',untrustedContent:true}],searchTravelWeb:async()=>({status:'live',provider:'Brave Search',retrievedAt:'2026-10-18T00:00:00.000Z',results:[]}),readCalendar:reads,createCalendarEvent:writes}});
    const client=new Client({name:'test-client',version:'1.0.0'});
    await server.connect(serverTransport);await client.connect(clientTransport);
    const listed=await client.listTools();
    expect(listed.tools.map(t=>t.name).sort()).toEqual(['analyze_itinerary','commit_calendar_sync','create_itinerary','estimate_transfer','get_calendar_events','get_itinerary','preview_calendar_sync','search_booking_emails','search_travel_web'].sort());
    const invalidArgs:Record<string,Record<string,unknown>>={create_itinerary:{title:'',timeZone:'bad',events:[]},get_itinerary:{itineraryId:'bad'},search_booking_emails:{maxResults:0},search_travel_web:{query:'',count:100},get_calendar_events:{timeMin:'2027-03-11T00:00:00Z',timeMax:'2027-03-10T00:00:00Z'},estimate_transfer:{origin:'',destination:'x'},analyze_itinerary:{itineraryId:'bad'},preview_calendar_sync:{itineraryId:'bad'},commit_calendar_sync:{itineraryId:'bad',previewId:'bad',confirm:false}};
    const invalid=await Promise.all(listed.tools.map(tool=>client.callTool({name:tool.name,arguments:invalidArgs[tool.name]})));
    expect(invalid.every(r=>r.isError===true)).toBe(true);

    const created=await client.callTool({name:'create_itinerary',arguments:{title:'Tokyo',timeZone:'Asia/Tokyo',events:[{kind:'activity',title:'Museum',start:'2027-03-10T09:00:00+09:00',end:'2027-03-10T10:00:00+09:00',timeZone:'Asia/Tokyo',location:{address:'Ueno'}}]}});
    expect(created.isError).not.toBe(true);
    const payload=JSON.parse((created.content[0] as {text:string}).text) as {itineraryId:string};
    const fetched=await client.callTool({name:'get_itinerary',arguments:{itineraryId:payload.itineraryId}});
    expect((JSON.parse((fetched.content[0] as {text:string}).text) as {title:string}).title).toBe('Tokyo');
    const emails=await client.callTool({name:'search_booking_emails',arguments:{searchTerms:'reservation',maxResults:1}});
    expect(emails.isError).not.toBe(true); expect((JSON.parse((emails.content[0] as {text:string}).text) as {contentIsUntrusted:boolean}).contentIsUntrusted).toBe(true); expect(writes).not.toHaveBeenCalled();
    const web=await client.callTool({name:'search_travel_web',arguments:{query:'Tokyo train timetable',officialDomain:'rail.example',count:3}});
    expect(web.isError).not.toBe(true); expect(JSON.parse((web.content[0] as {text:string}).text)).toMatchObject({status:'live',provider:'Brave Search',results:[]});
    expect((await client.callTool({name:'get_calendar_events',arguments:{timeMin:'2027-03-10T00:00:00Z',timeMax:'2027-03-11T00:00:00Z'}})).isError).not.toBe(true);
    expect((await client.callTool({name:'estimate_transfer',arguments:{origin:'Ueno',destination:{address:'Tokyo Station'},departureTime:'2027-03-10T10:00:00+09:00'}})).isError).not.toBe(true);
    expect((await client.callTool({name:'analyze_itinerary',arguments:{itineraryId:payload.itineraryId}})).isError).not.toBe(true);

    const readsBeforePreview=reads.mock.calls.length;
    const previewResponse=await client.callTool({name:'preview_calendar_sync',arguments:{itineraryId:payload.itineraryId}});
    expect(previewResponse.isError).not.toBe(true); expect(reads).toHaveBeenCalledTimes(readsBeforePreview+1); expect(writes).not.toHaveBeenCalled();
    const preview=JSON.parse((previewResponse.content[0] as {text:string}).text) as {previewId:string};
    const unconfirmed=await client.callTool({name:'commit_calendar_sync',arguments:{itineraryId:payload.itineraryId,previewId:preview.previewId,confirm:false}});
    expect(unconfirmed.isError).toBe(true); expect(writes).not.toHaveBeenCalled();
    const committed=await client.callTool({name:'commit_calendar_sync',arguments:{itineraryId:payload.itineraryId,previewId:preview.previewId,confirm:true}});
    expect(committed.isError).not.toBe(true); expect(writes).toHaveBeenCalledTimes(1);
    const replay=await client.callTool({name:'commit_calendar_sync',arguments:{itineraryId:payload.itineraryId,previewId:preview.previewId,confirm:true}});
    expect(replay.isError).not.toBe(true); expect(writes).toHaveBeenCalledTimes(1);
    expect(JSON.parse((replay.content[0] as {text:string}).text).idempotentReplay).toBe(true);
  });
  it('resumes partial calendar synchronization without repeating persisted event work',async()=>{
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();transports.push(clientTransport,serverTransport);
    const repository=new MemoryRepository();let calls=0;
    const server=createServer({repository,integrations:{calendarSource:()=> 'live',readCalendar:async()=>[],createCalendarEvent:async(event)=>{calls++;if(calls===2)throw new Error('provider transport dropped');return `external-${event.id}`;}}});
    const client=new Client({name:'retry-test',version:'1.0.0'});await server.connect(serverTransport);await client.connect(clientTransport);
    const created=await client.callTool({name:'create_itinerary',arguments:{title:'Two stops',timeZone:'Asia/Tokyo',events:[
      {kind:'activity',title:'First',start:'2027-03-10T09:00:00+09:00',end:'2027-03-10T10:00:00+09:00',timeZone:'Asia/Tokyo'},
      {kind:'activity',title:'Second',start:'2027-03-10T11:00:00+09:00',end:'2027-03-10T12:00:00+09:00',timeZone:'Asia/Tokyo'}
    ]}});
    const itineraryId=(JSON.parse((created.content[0] as {text:string}).text) as {itineraryId:string}).itineraryId;
    const previewResponse=await client.callTool({name:'preview_calendar_sync',arguments:{itineraryId}});
    const previewId=(JSON.parse((previewResponse.content[0] as {text:string}).text) as {previewId:string}).previewId;
    const args={itineraryId,previewId,confirm:true};
    expect((await client.callTool({name:'commit_calendar_sync',arguments:args})).isError).toBe(true); expect(calls).toBe(2);
    const retried=await client.callTool({name:'commit_calendar_sync',arguments:args});
    expect(retried.isError).not.toBe(true); expect(calls).toBe(3);
    expect((JSON.parse((retried.content[0] as {text:string}).text) as {eventIds:string[]}).eventIds).toHaveLength(2);
  });
  it('keeps Calendar event retrieval read-only and represents failed Gmail as unavailable',async()=>{
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();transports.push(clientTransport,serverTransport);
    const reads=vi.fn(async()=>[{id:'read-only',title:'Existing event',start:'2027-03-10T09:00:00Z',end:'2027-03-10T10:00:00Z',timeZone:'UTC',location:'',status:'confirmed'}]);
    const writes=vi.fn(async()=> 'should-not-run');
    const server=createServer({repository:new MemoryRepository(),integrations:{calendarSource:()=> 'unavailable',findEmailCandidates:async()=>{throw new Error('private provider failure detail');},readCalendar:reads,createCalendarEvent:writes}});
    const client=new Client({name:'read-only-test',version:'1.0.0'});await server.connect(serverTransport);await client.connect(clientTransport);
    const events=await client.callTool({name:'get_calendar_events',arguments:{timeMin:'2027-03-10T00:00:00Z',timeMax:'2027-03-11T00:00:00Z'}});
    expect(events.isError).not.toBe(true);expect(reads).toHaveBeenCalledTimes(1);expect(writes).not.toHaveBeenCalled();
    const gmail=await client.callTool({name:'search_booking_emails',arguments:{searchTerms:'booking',maxResults:1}});
    const result=JSON.parse((gmail.content[0] as {text:string}).text);
    expect(result).toMatchObject({status:'unavailable',provider:'Google Gmail',candidates:[]});
    expect(JSON.stringify(result)).not.toContain('private provider failure detail');
    expect(writes).not.toHaveBeenCalled();
  });
});
