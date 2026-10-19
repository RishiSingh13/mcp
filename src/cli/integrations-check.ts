import { Pool } from 'pg';
import { checkPostgresSchema, gmailFailure, parsePreflightArgs, providerFailureStatus, requiredCheckFailures, type DiagnosticCheck } from '../integrations/preflight-status.js';

async function main():Promise<void> {
  let env:typeof import('../config/env.js').env;
  try { ({env}=await import('../config/env.js')); }
  catch {
    console.log(JSON.stringify({configuration:{status:'invalid',message:'Environment validation failed. Review .env.example and the documented configuration relationships; values were not printed.'}},null,2));
    process.exitCode=2;
    return;
  }
  const args=parsePreflightArgs(process.argv.slice(2));
  const checks:Record<string,DiagnosticCheck>={};
  let databaseStatus:DiagnosticCheck;
  if(!env.DATABASE_URL) databaseStatus={status:'not_configured',message:env.NODE_ENV==='production'?'DATABASE_URL is required in production.':'PostgreSQL is optional for local development; this process uses the in-memory repository.'};
  else {
    let pool:Pool|undefined;
    try {
      const activePool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:8000,statement_timeout:7000,application_name:'tripsync-integrations-preflight'});
      pool=activePool;
      databaseStatus=await checkPostgresSchema(async()=>{
        const result=await activePool.query<{accounts:string|null;oauth_credentials:string|null}>("SELECT 1 AS ok,to_regclass('public.accounts')::text AS accounts,to_regclass('public.oauth_credentials')::text AS oauth_credentials");
        return result.rows[0]??{};
      });
    } catch {
      databaseStatus={status:'unavailable',message:'PostgreSQL could not be reached or checked. Verify DATABASE_URL, network access, and database availability.'};
    } finally { await pool?.end().catch(()=>undefined); }
  }
  checks.postgres=databaseStatus;

  const {env:validatedEnv}=await import('../config/env.js');
  const {googleStatus,initializeGoogleCredentials,verifyGmailAuthorization}=await import('../integrations/google.js');
  let gmail:DiagnosticCheck;
  if(!validatedEnv.GOOGLE_CLIENT_ID||!validatedEnv.GOOGLE_CLIENT_SECRET) gmail={status:'not_configured',message:'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then authorize at /auth/google.'};
  else if(validatedEnv.DATABASE_URL&&databaseStatus.status!=='connected') gmail={status:'unavailable',message:'Stored Google credentials cannot be checked until PostgreSQL is connected and migrated.'};
  else {
    let gmailPhase:'credentials'|'profile'='credentials';
    try {
      await initializeGoogleCredentials();
      if(!googleStatus().connected) gmail={status:'not_connected',message:validatedEnv.DATABASE_URL?'No stored Google authorization was found. Open /auth/google and grant Gmail read-only access.':'No persisted authorization is visible to this separate CLI process. Use PostgreSQL for reloadable OAuth credentials or verify Gmail through the already connected app process.'};
      else { gmailPhase='profile'; if(await verifyGmailAuthorization()) gmail={status:'connected',message:'Gmail profile authorization succeeded. This check did not search for booking messages.'};
      else gmail={status:'unavailable',message:'Gmail returned an invalid profile response.'};
      }
    } catch(error) { gmail=gmailFailure(error,gmailPhase); }
  }
  checks.gmail=gmail;

  const {searchTravelWebWithProviders}=await import('../integrations/tavily-search.js');
  const forcedProvider=args.require.includes('tavily')?'tavily':args.require.includes('brave')?'brave':undefined;
  const selectedProvider=forcedProvider??(validatedEnv.TAVILY_API_KEY?'tavily':validatedEnv.BRAVE_SEARCH_API_KEY?'brave':'tavily');
  const webResult=await searchTravelWebWithProviders({query:'TripSync integration preflight public transport',count:1},{provider:selectedProvider});
  const selectedCheck:DiagnosticCheck=webResult.status==='live'
    ?{status:'available',message:`${webResult.provider} accepted a bounded preflight query.`}
    :{status:!validatedEnv.TAVILY_API_KEY&&!validatedEnv.BRAVE_SEARCH_API_KEY?'not_configured':webResult.error?.includes('authentication')?'unauthorized':webResult.error?.includes('rate limit')?'rate_limited':'unavailable',message:webResult.error??'Public web search is unavailable.'};
  checks.tavily=selectedProvider==='tavily'?selectedCheck:validatedEnv.TAVILY_API_KEY?{status:'configured',message:'TAVILY_API_KEY is configured; this preflight tested the selected provider only.'}:{status:'not_configured',message:'Set TAVILY_API_KEY to enable Tavily search.'};
  checks.brave=selectedProvider==='brave'?selectedCheck:validatedEnv.BRAVE_SEARCH_API_KEY?{status:'configured',message:'BRAVE_SEARCH_API_KEY is configured; this preflight tested the selected provider only.'}:{status:'not_configured',message:'Set BRAVE_SEARCH_API_KEY to enable Brave Search.'};

  let maps:DiagnosticCheck;
  if(!validatedEnv.GOOGLE_MAPS_API_KEY) maps={status:'not_configured',message:validatedEnv.DEMO_MODE?'No live Maps key is configured; demo routes remain simulated.':'Set GOOGLE_MAPS_API_KEY to enable live Routes API checks.'};
  else if(!args.mapsOrigin||!args.mapsDestination) maps={status:'configured',message:'GOOGLE_MAPS_API_KEY is set. Supply --maps-origin and --maps-destination to verify a live route.'};
  else {
    const {estimateRouteWithApi}=await import('../integrations/google.js');
    const route=await estimateRouteWithApi(args.mapsOrigin,args.mapsDestination,'','DRIVE',validatedEnv.GOOGLE_MAPS_API_KEY);
    if(route.status==='live') maps={status:'available',message:'Google Routes API returned a valid route. Route details were not printed.'};
    else {
      const match=/returned (\d{3})/.exec(route.source);
      const failureStatus=providerFailureStatus(match?Number(match[1]):undefined);
      maps={status:failureStatus,message:failureStatus==='unauthorized'?'Google Routes rejected the key or request. Verify Routes API enablement, key restrictions, billing, and quota.':failureStatus==='rate_limited'?'Google Routes API rate limit reached. Retry later.':'Google Routes API did not return a valid route. Check the supplied endpoints, billing, and API availability.'};
    }
  }
  checks.maps=maps;

  const required=[...args.require];
  if(validatedEnv.NODE_ENV==='production') required.push('postgres');
  const failures=requiredCheckFailures(required,checks);
  const report={
    configuration:{status:'valid',nodeEnv:validatedEnv.NODE_ENV,port:validatedEnv.PORT,demoMode:validatedEnv.DEMO_MODE,httpAuthConfigured:Boolean(validatedEnv.MCP_AUTH_TOKEN),oauthCallbackUri:safeCallbackUri(validatedEnv.GOOGLE_REDIRECT_URI),googleOAuthConfigured:Boolean(validatedEnv.GOOGLE_CLIENT_ID&&validatedEnv.GOOGLE_CLIENT_SECRET),mapsKeyConfigured:Boolean(validatedEnv.GOOGLE_MAPS_API_KEY),braveKeyConfigured:Boolean(validatedEnv.BRAVE_SEARCH_API_KEY),tavilyKeyConfigured:Boolean(validatedEnv.TAVILY_API_KEY),webSearchProvider:selectedProvider},
    checks:{postgres:databaseStatus,gmail,tavily:checks.tavily,brave:checks.brave,maps},
    requiredChecks:required,
    failedRequiredChecks:failures,
  };
  console.log(JSON.stringify(report,null,2));
  if(failures.length) process.exitCode=1;
}

function safeCallbackUri(value:string):string {
  try { const url=new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; } catch { return 'invalid'; }
}

try { await main(); }
catch {
  console.log(JSON.stringify({status:'unavailable',message:'Integration preflight could not complete. No credential or provider response details were printed.'},null,2));
  process.exitCode=1;
} finally {
  try {
    const [{repository},{PostgresRepository}]=await Promise.all([import('../persistence/instance.js'),import('../persistence/postgres-repository.js')]);
    if(repository instanceof PostgresRepository) await repository.close();
  } catch { /* The process may have failed before configuration or repository initialization. */ }
}
