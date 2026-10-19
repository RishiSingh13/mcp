import { describe, expect, it } from 'vitest';
import { checkPostgresSchema, gmailFailure, parsePreflightArgs, providerFailureStatus, requiredCheckFailures, type DiagnosticCheck } from '../src/integrations/preflight-status.js';

describe('integration preflight validation', () => {
  it('accepts explicit bounded Maps endpoints and requested checks', () => {
    expect(parsePreflightArgs(['--maps-origin','Heathrow Airport','--maps-destination','Paddington Station','--require','gmail,brave,maps'])).toEqual({
      mapsOrigin:'Heathrow Airport',mapsDestination:'Paddington Station',require:['gmail','brave','maps'],
    });
  });

  it('accepts Tavily as an explicitly required integration check',()=>{
    expect(parsePreflightArgs(['--require','tavily'])).toMatchObject({require:['tavily']});
  });

  it('rejects unpaired, duplicate, or unknown command-line arguments without echoing values', () => {
    expect(()=>parsePreflightArgs(['--maps-origin','sensitive address'])).toThrow(/Provide a matching Maps/);
    expect(()=>parsePreflightArgs(['--maps-origin','a','--maps-origin','b'])).toThrow(/Invalid integration/);
    expect(()=>parsePreflightArgs(['--unknown','secret'])).toThrow(/Invalid integration/);
  });

  it('classifies API errors and only gates explicitly required providers', () => {
    expect(providerFailureStatus(401)).toBe('unauthorized');
    expect(providerFailureStatus(403)).toBe('unauthorized');
    expect(providerFailureStatus(429)).toBe('rate_limited');
    expect(providerFailureStatus()).toBe('unavailable');
    const checks:Record<string,DiagnosticCheck>={postgres:{status:'not_configured',message:'optional'},gmail:{status:'not_connected',message:'not authorized'},brave:{status:'available',message:'ok'},maps:{status:'configured',message:'needs route'} };
    expect(requiredCheckFailures(['brave'],checks)).toEqual([]);
    expect(requiredCheckFailures(['gmail','maps'],checks)).toEqual(['gmail','maps']);
  });

  it('distinguishes missing, undecryptable, revoked, and provider-denied Gmail authorization safely',()=>{
    expect(gmailFailure(new Error('Google is not connected or credentials expired')).status).toBe('not_connected');
    expect(gmailFailure(new Error('Stored Google credentials could not be decrypted. Check TOKEN_ENCRYPTION_KEY')).message).toMatch(/encryption key/i);
    expect(gmailFailure(Object.assign(new Error('invalid_grant'),{response:{data:{error:'invalid_grant'}}})).message).toMatch(/revoked or expired/i);
    expect(gmailFailure(Object.assign(new Error('provider failure'),{response:{status:403}})).status).toBe('unauthorized');
    const diagnostic=gmailFailure(Object.assign(new Error('private provider payload'),{response:{status:503,data:{error:'private provider payload'}}}));
    expect(JSON.stringify(diagnostic)).not.toContain('private provider payload');
    expect(gmailFailure(Object.assign(new Error('socket reset'),{code:'ECONNRESET'})).message).toMatch(/outbound network/i);
    expect(gmailFailure(Object.assign(new Error('socket denied'),{cause:{code:'EACCES'}})).message).toMatch(/outbound network/i);
    expect(gmailFailure(Object.assign(new Error('transport'),{gmailFailureStage:'token_refresh'})).message).toMatch(/refresh the stored access token/i);
  });

  it('checks the required database tables without writing or exposing query errors', async () => {
    expect(await checkPostgresSchema(async()=>({accounts:'accounts',oauth_credentials:'oauth_credentials'}))).toMatchObject({status:'connected'});
    expect(await checkPostgresSchema(async()=>({accounts:'accounts',oauth_credentials:null}))).toMatchObject({status:'migration_required'});
    expect(await checkPostgresSchema(async()=>{throw new Error('connection string detail');})).toMatchObject({status:'unavailable',message:'PostgreSQL could not be reached or checked. Verify DATABASE_URL, network access, and database availability.'});
  });
});
