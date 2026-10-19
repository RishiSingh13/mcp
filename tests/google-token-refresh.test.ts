import { describe, expect, it } from 'vitest';
import { mergeGoogleCredentialUpdate, persistEncryptedGoogleCredentials } from '../src/integrations/google.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { decryptTokenWithKey } from '../src/security/token-crypto.js';

const key = Buffer.alloc(32, 23).toString('base64');

describe('Google token refresh persistence', () => {
  it('retains the refresh token when Google returns an access-token refresh and stores credentials encrypted', async () => {
    const initial = mergeGoogleCredentialUpdate(undefined, { access_token: 'initial-access', refresh_token: 'long-lived-refresh', expiry_date: 1_900_000_000_000 });
    const refreshed = mergeGoogleCredentialUpdate(initial, { access_token: 'refreshed-access', refresh_token: null, expiry_date: 1_900_000_100_000 });
    expect(refreshed).toMatchObject({ access_token: 'refreshed-access', refresh_token: 'long-lived-refresh' });
    const repository = new MemoryRepository();
    const encrypted = await persistEncryptedGoogleCredentials(refreshed, repository, key);
    expect(encrypted).not.toContain('refreshed-access');
    expect(await repository.getCredentials()).toBe(encrypted);
    expect(decryptTokenWithKey(encrypted, key)).toBe(JSON.stringify(refreshed));
  });

  it('rejects malformed refresh payloads without replacing existing credentials', () => {
    const initial = mergeGoogleCredentialUpdate(undefined, { access_token: 'initial-access' });
    expect(() => mergeGoogleCredentialUpdate(initial, { expiry_date: 'invalid' })).toThrow(/invalid credentials/i);
    expect(initial.access_token).toBe('initial-access');
  });
});
