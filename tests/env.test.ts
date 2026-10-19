import { describe,it,expect } from 'vitest';
import { environmentSchema } from '../src/config/env.js';

describe('environment configuration',()=>{
  it('accepts blank optional email and credential fields from .env.example',()=>{
    const parsed=environmentSchema.parse({GOOGLE_ALLOWED_EMAIL:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',MCP_AUTH_TOKEN:''});
    expect(parsed.GOOGLE_ALLOWED_EMAIL).toBeUndefined();
    expect(parsed.GOOGLE_CLIENT_ID).toBeUndefined();
  });
  it('rejects malformed configured allow-list addresses',()=>{
    expect(environmentSchema.safeParse({GOOGLE_ALLOWED_EMAIL:'not-an-email'}).success).toBe(false);
  });
  it('requires a canonical 32-byte base64 token encryption key',()=>{
    expect(environmentSchema.safeParse({TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')}).success).toBe(true);
    expect(environmentSchema.safeParse({TOKEN_ENCRYPTION_KEY:'short'}).success).toBe(false);
    expect(environmentSchema.safeParse({NODE_ENV:'production',MCP_AUTH_TOKEN:'configured'}).success).toBe(false);
  });
  it('requires the configured OAuth redirect URI to use the implemented callback path',()=>{
    expect(environmentSchema.safeParse({GOOGLE_REDIRECT_URI:'http://localhost:3000/auth/google/callback'}).success).toBe(true);
    expect(environmentSchema.safeParse({GOOGLE_REDIRECT_URI:'http://localhost:3000/oauth/callback'}).success).toBe(false);
  });
});
