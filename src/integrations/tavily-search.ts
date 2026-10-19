import { z } from 'zod';
import { env } from '../config/env.js';
import { searchTravelWeb as searchBrave, travelWebSearchInputSchema, type TravelWebSearchInput, type TravelWebSearchResult } from './brave-search.js';

const tavilyResultSchema=z.object({title:z.string().max(2_000),url:z.string().max(4_096),content:z.string().max(20_000)}).passthrough();
const tavilyResponseSchema=z.object({results:z.array(z.unknown()).max(100)}).passthrough();
const isoAlpha2Codes=new Set(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' '));
const regionNames=new Intl.DisplayNames(['en'],{type:'region'});

export function tavilyCountryName(country:string):string|undefined {
  const code=country.toUpperCase();
  if(!isoAlpha2Codes.has(code))return undefined;
  const name=regionNames.of(code);
  return name&&name!==code&&!name.toLowerCase().startsWith('unknown')?name:undefined;
}

function unavailable(retrievedAt:string,reason:string,officialDomain?:string):TravelWebSearchResult {
  return {status:'unavailable',provider:'Tavily',retrievedAt,...(officialDomain?{officialDomain}:{}),results:[],error:reason};
}

export async function searchTravelWebWithTavily(
  input:TravelWebSearchInput,
  options:{apiKey?:string;fetcher?:typeof fetch;now?:()=>Date;timeoutMs?:number}={},
):Promise<TravelWebSearchResult> {
  const now=(options.now??(()=>new Date()))().toISOString();
  const parsed=travelWebSearchInputSchema.safeParse(input);
  if(!parsed.success)return unavailable(now,'Invalid search input. Check the tool schema.');
  // Tavily accepts a country name, but its Search API has no language parameter.
  const {query,country,count,officialDomain}=parsed.data;
  const tavilyCountry=country?tavilyCountryName(country):undefined;
  if(country&&!tavilyCountry)return unavailable(now,'Tavily does not support the supplied country code.',officialDomain);
  const apiKey=options.apiKey??env.TAVILY_API_KEY;
  if(!apiKey)return unavailable(now,'Tavily is not configured.',officialDomain);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),options.timeoutMs??8_000);
  try {
    const response=await (options.fetcher??fetch)('https://api.tavily.com/search',{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
      body:JSON.stringify({query:`${query}${officialDomain?` site:${officialDomain}`:''}`,search_depth:'basic',max_results:Math.min(count,5),include_raw_content:false,include_answer:false,...(tavilyCountry?{country:tavilyCountry}:{})}),
    });
    if(!response.ok) {
      const reason=response.status===401||response.status===403?'Tavily authentication failed. Check TAVILY_API_KEY and account access.':response.status===429?'Tavily rate limit reached.':`Tavily returned HTTP ${response.status}.`;
      return unavailable(now,reason,officialDomain);
    }
    const raw=await response.text();
    if(raw.length>1_000_000)return unavailable(now,'Tavily returned an oversized response.',officialDomain);
    let json:unknown;
    try{json=JSON.parse(raw);}catch{return unavailable(now,'Tavily returned malformed data.',officialDomain);}
    const responseData=tavilyResponseSchema.safeParse(json);
    if(!responseData.success)return unavailable(now,'Tavily returned an invalid response.',officialDomain);
    const results:TravelWebSearchResult['results']=[];
    for(const candidate of responseData.data.results) {
      const result=tavilyResultSchema.safeParse(candidate);
      if(!result.success)return unavailable(now,'Tavily returned an invalid result.',officialDomain);
      let pageUrl:URL;
      try{pageUrl=new URL(result.data.url);}catch{return unavailable(now,'Tavily returned an invalid result URL.',officialDomain);}
      if(!['https:','http:'].includes(pageUrl.protocol)||pageUrl.username||pageUrl.password||!pageUrl.hostname)return unavailable(now,'Tavily returned an invalid result URL.',officialDomain);
      const domain=pageUrl.hostname.toLowerCase();
      const target=officialDomain?.toLowerCase();
      const matches=Boolean(target&&(domain===target||domain.endsWith(`.${target}`)));
      results.push({title:result.data.title.slice(0,300),url:pageUrl.toString(),snippet:result.data.content.slice(0,1_000),domain,officialDomainMatch:matches,sourceType:matches?'matches_requested_domain':'third_party_or_unverified',untrustedContent:true});
      if(results.length>=Math.min(count,5))break;
    }
    return {status:'live',provider:'Tavily',retrievedAt:now,...(officialDomain?{officialDomain}:{}),results};
  }catch{return unavailable(now,'Tavily request failed or timed out.',officialDomain);}
  finally{clearTimeout(timer);}
}

export async function searchTravelWebWithProviders(
  input:TravelWebSearchInput,
  options:{tavilyApiKey?:string;braveApiKey?:string;provider?:'tavily'|'brave';fetcher?:typeof fetch;now?:()=>Date;timeoutMs?:number}={},
):Promise<TravelWebSearchResult> {
  const tavilyKey=options.tavilyApiKey??env.TAVILY_API_KEY;
  const braveKey=options.braveApiKey??env.BRAVE_SEARCH_API_KEY;
  if(options.provider==='tavily')return searchTravelWebWithTavily(input,{apiKey:tavilyKey,fetcher:options.fetcher,now:options.now,timeoutMs:options.timeoutMs});
  if(options.provider==='brave')return searchBrave(input,{apiKey:braveKey,fetcher:options.fetcher,now:options.now,timeoutMs:options.timeoutMs});
  if(tavilyKey)return searchTravelWebWithTavily(input,{apiKey:tavilyKey,fetcher:options.fetcher,now:options.now,timeoutMs:options.timeoutMs});
  if(braveKey)return searchBrave(input,{apiKey:braveKey,fetcher:options.fetcher,now:options.now,timeoutMs:options.timeoutMs});
  const now=(options.now??(()=>new Date()))().toISOString();
  return {status:'unavailable',provider:'Tavily',retrievedAt:now,results:[],error:'Public web search is not configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.'};
}
