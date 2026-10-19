import 'dotenv/config';
import { z } from 'zod';

const optionalString = z.preprocess(value => value === '' ? undefined : value, z.string().optional());
const optionalBraveKey = z.preprocess(value => value === '' || value === 'your_brave_search_api_key_here' ? undefined : value, z.string().optional());
const optionalTavilyKey = z.preprocess(value => value === '' ? undefined : value, z.string().optional());
const optionalEmail = z.preprocess(value => value === '' ? undefined : value, z.string().email().optional());
const googleRedirectUri = z.string().url().default('http://localhost:3000/auth/google/callback').refine(value => {
  try { return new URL(value).pathname === '/auth/google/callback'; } catch { return false; }
}, 'GOOGLE_REDIRECT_URI must use the implemented /auth/google/callback path.');
const encryptionKey = z.preprocess(value => value === '' ? undefined : value, z.string().optional()).superRefine((value, ctx) => {
  if (value === undefined) return;
  const decoded=Buffer.from(value,'base64');
  if (decoded.length!==32 || decoded.toString('base64')!==value) ctx.addIssue({code:'custom',message:'TOKEN_ENCRYPTION_KEY must be canonical base64 for exactly 32 random bytes.'});
});

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().default('info'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  MCP_AUTH_TOKEN: optionalString,
  GOOGLE_CLIENT_ID: optionalString, GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: googleRedirectUri,
  GOOGLE_ALLOWED_EMAIL: optionalEmail, TOKEN_ENCRYPTION_KEY: encryptionKey,
  GOOGLE_CALENDAR_ENABLED: z.enum(['true','false']).default('false').transform(v => v === 'true'),
  GOOGLE_MAPS_API_KEY: optionalString, BRAVE_SEARCH_API_KEY: optionalBraveKey, TAVILY_API_KEY: optionalTavilyKey, DATABASE_URL: optionalString,
  DEMO_MODE: z.enum(['true','false']).default('false').transform(v => v === 'true'),
  DEFAULT_TRANSFER_BUFFER_MINUTES: z.coerce.number().int().min(0).max(1440).default(30)
});

export const environmentSchema=baseEnvironmentSchema.superRefine((v,ctx)=>{
  const issue=(path:string[],message:string)=>ctx.addIssue({code:'custom',path,message});
  if(v.NODE_ENV==='production'&&!v.MCP_AUTH_TOKEN)issue(['MCP_AUTH_TOKEN'],'MCP_AUTH_TOKEN is required in production.');
  if(v.NODE_ENV==='production'&&!v.DATABASE_URL)issue(['DATABASE_URL'],'DATABASE_URL is required in production; refusing to start with in-memory persistence.');
  if(Boolean(v.GOOGLE_CLIENT_ID)!==Boolean(v.GOOGLE_CLIENT_SECRET))issue(['GOOGLE_CLIENT_ID'],'Configure both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.');
  if(v.GOOGLE_CLIENT_ID&&!v.MCP_AUTH_TOKEN)issue(['MCP_AUTH_TOKEN'],'MCP_AUTH_TOKEN is required whenever Google integrations are configured.');
  if(v.GOOGLE_CLIENT_ID&&v.DATABASE_URL&&!v.TOKEN_ENCRYPTION_KEY)issue(['TOKEN_ENCRYPTION_KEY'],'TOKEN_ENCRYPTION_KEY is required when Google integrations and PostgreSQL are configured.');
  if(v.NODE_ENV==='production'&&v.GOOGLE_CLIENT_ID&&!v.GOOGLE_ALLOWED_EMAIL)issue(['GOOGLE_ALLOWED_EMAIL'],'GOOGLE_ALLOWED_EMAIL is required for the single-account Google OAuth integration in production.');
});

export const env = environmentSchema.parse(process.env);
