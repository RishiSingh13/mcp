import { describe, expect, it, vi } from 'vitest';
import { verifyGmailAuthorization } from '../src/integrations/google.js';

describe('Gmail preflight', () => {
  it('checks only Gmail profile authorization and returns no account identity', async () => {
    const getProfile=vi.fn(async()=>({data:{emailAddress:'private@example.test',messagesTotal:123}}));
    const connected=await verifyGmailAuthorization({users:{getProfile}});
    expect(connected).toBe(true);
    expect(getProfile).toHaveBeenCalledWith({userId:'me',fields:'emailAddress',timeout:8000});
    expect(JSON.stringify(connected)).not.toContain('private@example.test');
  });

  it('returns false when Gmail does not return a valid profile identity', async () => {
    expect(await verifyGmailAuthorization({users:{getProfile:async()=>({data:{}})}})).toBe(false);
  });
});
