import { describe, expect, it, vi } from 'vitest';
import { searchTravelWeb } from '../src/integrations/brave-search.js';

const fixedNow = () => new Date('2026-10-18T10:00:00.000Z');
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('Brave travel web adapter', () => {
  it('returns attributed live results and scopes official domain searches', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => jsonResponse({ web: { results: [
      { title: 'Official timetable', url: 'https://www.rail.example/timetable', description: 'Service times', page_age: '2026-10-17' },
    ] } }));
    const result = await searchTravelWeb({ query: 'Tokyo train timetable', officialDomain: 'rail.example', count: 3, country: 'jp', language: 'en' }, { apiKey: 'test-key', fetcher: fetcher as typeof fetch, now: fixedNow });
    const [requestUrl, options] = fetcher.mock.calls[0] ?? [];
    expect(String(requestUrl)).toContain('site%3Arail.example');
    expect(String(requestUrl)).toContain('country=JP');
    expect((options?.headers as Record<string, string>)['X-Subscription-Token']).toBe('test-key');
    expect(result).toMatchObject({ status: 'live', provider: 'Brave Search', retrievedAt: '2026-10-18T10:00:00.000Z', results: [
      { title: 'Official timetable', domain: 'www.rail.example', officialDomainMatch: true, sourceType: 'matches_requested_domain', publishedAt: '2026-10-17', untrustedContent: true },
    ] });
  });

  it('distinguishes live empty results from missing credentials and provider failures', async () => {
    const empty = await searchTravelWeb({ query: 'train', count: 5 }, { apiKey: 'test-key', fetcher: async () => jsonResponse({ web: { results: [] } }), now: fixedNow });
    expect(empty).toMatchObject({ status: 'live', results: [] });
    const missing = await searchTravelWeb({ query: 'train' }, { apiKey: '', now: fixedNow });
    expect(missing).toMatchObject({ status: 'unavailable', results: [], error: 'Brave Search is not configured.' });
    const rateLimit = await searchTravelWeb({ query: 'train' }, { apiKey: 'test-key', fetcher: async () => new Response('', { status: 429 }), now: fixedNow });
    expect(rateLimit.error).toBe('Brave Search rate limit reached.');
    const malformed = await searchTravelWeb({ query: 'train' }, { apiKey: 'test-key', fetcher: async () => new Response('{bad', { status: 200 }), now: fixedNow });
    expect(malformed.error).toBe('Brave Search returned malformed data.');
  });

  it('rejects malformed inputs and provider result structures safely', async () => {
    expect((await searchTravelWeb({ query: ' ' } as never, { apiKey: 'test-key', now: fixedNow })).status).toBe('unavailable');
    const bad = await searchTravelWeb({ query: 'train' }, { apiKey: 'test-key', fetcher: async () => jsonResponse({ web: { results: [{ title: 'Missing URL' }] } }), now: fixedNow });
    expect(bad).toMatchObject({ status: 'unavailable', results: [], error: 'Brave Search returned an invalid result.' });
    const unsafeUrl = await searchTravelWeb({ query: 'train' }, { apiKey: 'test-key', fetcher: async () => jsonResponse({ web: { results: [{ title: 'Bad URL', url: 'javascript:alert(1)' }] } }), now: fixedNow });
    expect(unsafeUrl).toMatchObject({ status: 'unavailable', results: [], error: 'Brave Search returned an invalid result URL.' });
  });
});
