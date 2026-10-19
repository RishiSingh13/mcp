import { describe,it,expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/http/app.js';
describe('HTTP endpoints',()=>{
  it('reports health without exposing configuration values',async()=>{
    const response=await request(app).get('/health');
    expect(response.status).toBe(200);expect(response.body.status).toBe('ok');expect(Object.keys(response.body).sort()).toEqual(['demoMode','service','status']);expect(JSON.stringify(response.body)).not.toMatch(/secret|token|credential|authorization/i);
  });
  it('rejects an OAuth callback without a valid state',async()=>{
    const response=await request(app).get('/auth/google/callback?state=invalid&code=x');
    expect(response.status).toBe(400);
  });
  it('rejects malformed JSON without returning parser diagnostics',async()=>{
    const response=await request(app).post('/mcp').set('content-type','application/json').send('{');
    expect(response.status).toBe(400);expect(response.body).toEqual({error:'Malformed JSON request.'});expect(JSON.stringify(response.body)).not.toMatch(/stack|syntaxerror|token/i);
  });
});
