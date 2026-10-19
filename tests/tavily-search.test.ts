import { describe,expect,it,vi } from 'vitest';
import { searchTravelWebWithProviders,searchTravelWebWithTavily } from '../src/integrations/tavily-search.js';

const fixedNow=()=>new Date('2026-10-18T10:00:00.000Z');
const jsonResponse=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

describe('Tavily travel web adapter',()=>{
  it('maps validated results and sends a minimal bounded basic-search request',async()=>{
    const fetcher=vi.fn(async(_input:URL|string|Request,init?:RequestInit)=>jsonResponse({results:[{title:'Rail timetable',url:'https://rail.example/timetable',content:'Service times',score:0.9}]}));
    const result=await searchTravelWebWithTavily({query:'Tokyo trains',country:'JP',language:'en',count:10,officialDomain:'rail.example'},{apiKey:'private-test-key',fetcher:fetcher as typeof fetch,now:fixedNow});
    const [,init]=fetcher.mock.calls[0]??[];
    expect((init?.headers as Record<string,string>).Authorization).toBe('Bearer private-test-key');
    const body=JSON.parse(String(init?.body));
    expect(body).toMatchObject({query:'Tokyo trains site:rail.example',country:'Japan',search_depth:'basic',max_results:5,include_raw_content:false,include_answer:false});
    expect(body).not.toHaveProperty('language');
    expect(result).toMatchObject({status:'live',provider:'Tavily',retrievedAt:'2026-10-18T10:00:00.000Z',results:[{title:'Rail timetable',url:'https://rail.example/timetable',snippet:'Service times',domain:'rail.example',officialDomainMatch:true,sourceType:'matches_requested_domain',untrustedContent:true}]});
    expect(JSON.stringify(result)).not.toContain('private-test-key');
  });

  it('preserves valid empty searches and reports a missing key without making a request',async()=>{
    const fetcher=vi.fn(async()=>jsonResponse({results:[]}));
    expect(await searchTravelWebWithTavily({query:'train'},{apiKey:'key',fetcher:fetcher as typeof fetch,now:fixedNow})).toMatchObject({status:'live',results:[]});
    expect(await searchTravelWebWithTavily({query:'train'},{apiKey:'',fetcher:fetcher as typeof fetch,now:fixedNow})).toMatchObject({status:'unavailable',error:'Tavily is not configured.'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('omits country when not supplied and rejects unsupported country codes before requesting Tavily',async()=>{
    const fetcher=vi.fn(async()=>jsonResponse({results:[]}));
    const withoutCountry=await searchTravelWebWithTavily({query:'train'},{apiKey:'key',fetcher:fetcher as typeof fetch});
    expect(withoutCountry.status).toBe('live');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty('country');
    const invalid=await searchTravelWebWithTavily({query:'train',country:'ZZ'},{apiKey:'key',fetcher:fetcher as typeof fetch});
    expect(invalid).toMatchObject({status:'unavailable',error:'Tavily does not support the supplied country code.'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed payloads, malformed results, and unsafe URLs',async()=>{
    expect(await searchTravelWebWithTavily({query:'x'},{apiKey:'key',fetcher:async()=>new Response('{bad'),now:fixedNow})).toMatchObject({status:'unavailable',error:'Tavily returned malformed data.'});
    expect(await searchTravelWebWithTavily({query:'x'},{apiKey:'key',fetcher:async()=>jsonResponse({results:[{title:'Missing'}]}),now:fixedNow})).toMatchObject({status:'unavailable',error:'Tavily returned an invalid result.'});
    expect(await searchTravelWebWithTavily({query:'x'},{apiKey:'key',fetcher:async()=>jsonResponse({results:[{title:'Bad',url:'javascript:alert(1)',content:'no'}]}),now:fixedNow})).toMatchObject({status:'unavailable',error:'Tavily returned an invalid result URL.'});
  });

  it('handles authentication errors, rate limits, and unavailable network access safely',async()=>{
    expect(await searchTravelWebWithTavily({query:'x'},{apiKey:'key',fetcher:async()=>new Response('',{status:401}),now:fixedNow})).toMatchObject({status:'unavailable',error:'Tavily authentication failed. Check TAVILY_API_KEY and account access.'});
    expect(await searchTravelWebWithTavily({query:'x'},{apiKey:'key',fetcher:async()=>new Response('',{status:429}),now:fixedNow})).toMatchObject({status:'unavailable',error:'Tavily rate limit reached.'});
    expect(await searchTravelWebWithTavily({query:'x'},{apiKey:'key',fetcher:async()=>{throw new Error('network detail');},now:fixedNow})).toMatchObject({status:'unavailable',error:'Tavily request failed or timed out.'});
  });

  it('prefers Tavily, falls back to configured Brave, and never invents a provider result',async()=>{
    const fetcher=vi.fn(async()=>jsonResponse({results:[{title:'Tavily',url:'https://tavily.example',content:'result'}]}));
    expect(await searchTravelWebWithProviders({query:'x'},{tavilyApiKey:'tavily-key',braveApiKey:'brave-key',fetcher:fetcher as typeof fetch,now:fixedNow})).toMatchObject({provider:'Tavily',status:'live'});
    expect(await searchTravelWebWithProviders({query:'x'},{tavilyApiKey:'',braveApiKey:'',now:fixedNow})).toMatchObject({status:'unavailable',results:[],error:'Public web search is not configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.'});
    const braveFetcher=async()=>jsonResponse({web:{results:[{title:'Brave result',url:'https://brave.example',description:'result'}]}});
    expect(await searchTravelWebWithProviders({query:'x'},{tavilyApiKey:'',braveApiKey:'brave-key',fetcher:braveFetcher as typeof fetch,now:fixedNow})).toMatchObject({provider:'Brave Search',status:'live',results:[{title:'Brave result'}]});
  });
});
