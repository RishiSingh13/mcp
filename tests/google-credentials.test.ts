import { describe,expect,it } from 'vitest';
import { calendarSource,googleAuth,googleStatus,integrationProvenance,scopesForGoogleAuthorization,GOOGLE_GMAIL_SCOPE,GOOGLE_CALENDAR_SCOPE } from '../src/integrations/google.js';

describe('Google integration credential safety',()=>{
  it('requests only Gmail read scope in the default Gmail authorization flow',()=>{
    expect(scopesForGoogleAuthorization('gmail')).toEqual([GOOGLE_GMAIL_SCOPE]);
    expect(scopesForGoogleAuthorization('gmail')).not.toContain(GOOGLE_CALENDAR_SCOPE);
    expect(scopesForGoogleAuthorization('calendar')).toEqual([GOOGLE_CALENDAR_SCOPE]);
  });
  it('returns a clear safe error when Google credentials are missing',()=>{
    expect(()=>googleAuth()).toThrow(/Google is not connected or credentials expired/);
  });
  it('does not report disconnected integrations as live',()=>{
    expect(integrationProvenance(false,true)).toBe('simulated');
    expect(integrationProvenance(false,false)).toBe('unavailable');
    expect(integrationProvenance(true,false)).toBe('live');
    expect(['unavailable','simulated']).toContain(calendarSource());
  });
  it('keeps status responses free of OAuth material',()=>{
    expect(JSON.stringify(googleStatus())).not.toMatch(/access_token|refresh_token|secret|authorization/i);
  });
});
