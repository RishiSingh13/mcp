import { z } from 'zod';

export const preflightArgsSchema=z.object({
  mapsOrigin:z.string().trim().min(1).max(500).optional(),
  mapsDestination:z.string().trim().min(1).max(500).optional(),
  require:z.array(z.enum(['postgres','gmail','brave','tavily','maps'])).default([]),
}).strict().refine(value=>Boolean(value.mapsOrigin)===Boolean(value.mapsDestination),{message:'Provide both Maps origin and destination.'});
export type PreflightArgs=z.infer<typeof preflightArgsSchema>;

export function parsePreflightArgs(argv:string[]):PreflightArgs {
  const values:Record<string,unknown>={require:[]};
  const seen=new Set<string>();
  for(let i=0;i<argv.length;i++) {
    const token=argv[i]!;
    if(!token.startsWith('--')) throw new Error('Invalid integration check arguments.');
    const [rawName,inlineValue]=token.slice(2).split('=',2);
    if(!['maps-origin','maps-destination','require'].includes(rawName!)||seen.has(rawName!)) throw new Error('Invalid integration check arguments.');
    seen.add(rawName!);
    const value=inlineValue??argv[++i];
    if(!value||value.startsWith('--')) throw new Error('Invalid integration check arguments.');
    if(rawName==='maps-origin') values.mapsOrigin=value;
    else if(rawName==='maps-destination') values.mapsDestination=value;
    else values.require=value.split(',').map(item=>item.trim().toLowerCase());
  }
  const parsed=preflightArgsSchema.safeParse(values);
  if(!parsed.success) throw new Error('Invalid integration check arguments. Provide a matching Maps origin/destination pair and supported required check names, including tavily.');
  return parsed.data;
}

export type DiagnosticStatus='connected'|'available'|'configured'|'not_configured'|'not_connected'|'unauthorized'|'unavailable'|'rate_limited'|'migration_required'|'needs_input';
export type DiagnosticCheck={status:DiagnosticStatus;message:string};

export function providerFailureStatus(status?:number):DiagnosticStatus {
  if(status===401||status===403) return 'unauthorized';
  if(status===429) return 'rate_limited';
  return 'unavailable';
}

/** Convert OAuth/storage failures into safe, actionable preflight results. */
export function gmailFailure(error:unknown,phase:'credentials'|'token_refresh'|'profile'='profile'):DiagnosticCheck {
  const e=error as {response?:{status?:number;data?:{error?:unknown;error_description?:unknown}};code?:number|string;cause?:{code?:string};message?:string;gmailFailureStage?:string};
  if(e?.gmailFailureStage==='token_refresh') phase='token_refresh';
  const message=typeof e?.message==='string'?e.message.toLowerCase():'';
  const providerError=e?.response?.data?.error;
  const providerCode=typeof providerError==='string'?providerError.toLowerCase():'';
  const status=e?.response?.status??(typeof e?.code==='number'?e.code:undefined);
  if(message.includes('gmail authorization is required')) return {status:'unauthorized',message:'Stored Google credentials do not include Gmail read-only authorization. Open /auth/google and grant Gmail read-only access.'};
  if(message.includes('could not be decrypted')||message.includes('token_encryption_key')) return {status:'unavailable',message:'Stored Google credentials could not be decrypted. Verify the configured encryption key matches the key used when authorization was stored.'};
  if(message.includes('no stored google authorization')||message.includes('not connected')||message.includes('credentials expired')) return {status:'not_connected',message:'No usable Gmail authorization was found. Reconnect at /auth/google.'};
  if(providerCode==='invalid_grant'||message.includes('invalid_grant')) return {status:'unauthorized',message:'Google rejected the stored authorization. It may have been revoked or expired; reconnect at /auth/google.'};
  const networkCode=typeof e?.code==='string'?e.code:e?.cause?.code;
  if(typeof networkCode==='string'&&['EACCES','EPERM','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','ENOTFOUND'].includes(networkCode)) return {status:'unavailable',message:phase==='token_refresh'?'Google OAuth token refresh could not reach Google. Check outbound network access and retry.':'Gmail API could not be reached. Check outbound network access and Gmail API availability.'};
  if(phase==='credentials'&&status!==undefined&&status>=500) return {status:'unavailable',message:'The credential database could not be read. Verify PostgreSQL availability and permissions.'};
  if(status===401||status===403) return {status:'unauthorized',message:'Google denied the Gmail profile check. Verify Gmail API enablement, Gmail read-only consent, and account access.'};
  if(status===429) return {status:'rate_limited',message:'Gmail API rate limit reached. Retry later.'};
  if(message.includes('stored google credentials')) return {status:'unavailable',message:'Stored Google credentials are invalid. Reconnect at /auth/google.'};
  if(phase==='credentials') return {status:'unavailable',message:'Stored Google credentials could not be loaded. Check PostgreSQL access and token encryption configuration.'};
  if(phase==='token_refresh') return {status:'unauthorized',message:'Google could not refresh the stored access token. Reconnect at /auth/google and check Google OAuth availability.'};
  if(status!==undefined) return {status:'unavailable',message:`Gmail profile check failed with HTTP ${status}. Check Gmail API availability and authorization.`};
  return {status:'unavailable',message:'Gmail profile check failed before a provider status was returned. Check network access and Google authorization.'};
}

export async function checkPostgresSchema(query:()=>Promise<{accounts?:string|null;oauth_credentials?:string|null}>):Promise<DiagnosticCheck> {
  try {
    const row=await query();
    return row.accounts&&row.oauth_credentials
      ?{status:'connected',message:'PostgreSQL is reachable and required TripSync tables exist.'}
      :{status:'migration_required',message:'PostgreSQL is reachable, but TripSync schema tables are missing. Run npm run db:migrate.'};
  } catch {
    return {status:'unavailable',message:'PostgreSQL could not be reached or checked. Verify DATABASE_URL, network access, and database availability.'};
  }
}

const successfulStatuses:Record<PreflightArgs['require'][number],DiagnosticStatus>={postgres:'connected',gmail:'connected',brave:'available',tavily:'available',maps:'available'};
export function requiredCheckFailures(required:PreflightArgs['require'],checks:Record<string,DiagnosticCheck>):string[] {
  return [...new Set(required)].filter(name=>checks[name]?.status!==successfulStatuses[name]);
}
