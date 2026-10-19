import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../mcp/create-server.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { oauthClient, setGoogleCredentials, googleStatus, initializeGoogleCredentials, scopesForGoogleAuthorization } from '../integrations/google.js';
import { initializeRepository, repository } from '../persistence/instance.js';

export async function initializeApplication() { await initializeRepository(); await initializeGoogleCredentials(); }
export const oauthStateHash=(state:string)=>createHash('sha256').update(state).digest('hex');
const app=express(); app.use(express.json({limit:'1mb'}));
app.get('/health',(_req,res)=>res.json({status:'ok',service:'tripsync',demoMode:env.DEMO_MODE}));
app.get('/auth/status',(_req,res)=>res.json(googleStatus()));
const startGoogleAuthorization=(capability:'gmail'|'calendar')=>async(_req:express.Request,res:express.Response)=>{try{
  if(capability==='calendar'&&!env.GOOGLE_CALENDAR_ENABLED)return res.status(404).json({error:'Calendar authorization is disabled. Set GOOGLE_CALENDAR_ENABLED=true to enable it.'});
  const state=randomBytes(32).toString('base64url');const expires=Date.now()+10*60_000;await repository.storeOAuthState(oauthStateHash(state),expires);
  res.redirect(oauthClient().generateAuthUrl({access_type:'offline',prompt:'consent',include_granted_scopes:true,scope:[...scopesForGoogleAuthorization(capability),...(env.GOOGLE_ALLOWED_EMAIL?['openid','email']:[])],state}));
}catch(e){logger.warn({name:e instanceof Error?e.name:'Error'},'Google OAuth start failed');res.status(503).json({error:'Google OAuth is unavailable. Check server configuration and storage.'});}};
app.get('/auth/google',startGoogleAuthorization('gmail'));
app.get('/auth/google/calendar',startGoogleAuthorization('calendar'));
app.get('/auth/google/callback',async(req,res)=>{
  const state=typeof req.query.state==='string'?req.query.state:'';
  if(!state||state.length>200||!await repository.consumeOAuthState(oauthStateHash(state),Date.now()))return res.status(400).send('Invalid or expired OAuth state.');
  const code=typeof req.query.code==='string'?req.query.code:'';
  if(!code||code.length>4096)return res.status(400).send('Authorization response is invalid.');
  let tokens;
  try { ({tokens}=await oauthClient().getToken(code)); }
  catch(e) { logger.warn({category:'code_exchange',status:(e as {response?:{status?:number}})?.response?.status,name:e instanceof Error?e.name:'Error'},'Google OAuth callback failed');return res.status(502).send('Google authorization failed. Check server configuration and reconnect.'); }
  const auth=oauthClient();auth.setCredentials(tokens);
  if(env.GOOGLE_ALLOWED_EMAIL) {
    try {
      const oauth2=(await import('googleapis')).google.oauth2 as any;const identity=await oauth2({version:'v2',auth}).userinfo.get();
      if(identity.data.email?.toLowerCase()!==env.GOOGLE_ALLOWED_EMAIL.toLowerCase()||identity.data.verified_email!==true) { logger.warn({category:'account_mismatch'},'Google OAuth account rejected');return res.status(403).send('This Google account is not allow-listed.'); }
    } catch(e) { logger.warn({category:'identity_verification',status:(e as {response?:{status?:number}})?.response?.status,name:e instanceof Error?e.name:'Error'},'Google OAuth account verification failed');return res.status(502).send('Google account could not be verified. Check OAuth configuration and retry.'); }
  }
  try { await setGoogleCredentials(tokens);res.send('TripSync connected. You can close this window.'); }
  catch(e) { logger.error({category:'credential_persistence',name:e instanceof Error?e.name:'Error'},'Google OAuth credentials could not be persisted');res.status(503).send('Google authorization was verified but could not be saved. Check PostgreSQL and token encryption configuration, then reconnect.'); }
});
app.post('/mcp',async(req,res)=>{
  if(env.MCP_AUTH_TOKEN){const auth=req.header('authorization')??'';const provided=auth.startsWith('Bearer ')?auth.slice(7):'';const a=Buffer.from(provided),b=Buffer.from(env.MCP_AUTH_TOKEN);if(a.length!==b.length||!timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});}
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  res.on('close',()=>{void transport.close();});
  try{await createServer().connect(transport);await transport.handleRequest(req,res,req.body);}catch(e){logger.warn({name:e instanceof Error?e.name:'Error'},'MCP request failed');if(!res.headersSent)res.status(500).json({error:'MCP request failed'});}
});
app.all('/mcp',(_req,res)=>res.status(405).json({error:'Use POST for stateless Streamable HTTP MCP.'}));
app.use((error:Error&{status?:number;type?:string},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error.type==='entity.parse.failed') return res.status(400).json({error:'Malformed JSON request.'});
  if(error.status===413) return res.status(413).json({error:'Request body exceeds the 1 MB limit.'});
  logger.warn({status:error.status??500,name:error.name},'HTTP request rejected');
  return res.status(error.status===400?400:500).json({error:error.status===400?'Invalid request body.':'Request failed.'});
});
export { app };
