import { describe, expect, it } from 'vitest';
import { estimateRouteWithApi } from '../src/integrations/google.js';

describe('Google Routes response validation', () => {
  it('uses the requested field mask and validates live duration and distance', async () => {
    let requestInit: RequestInit | undefined;
    const result = await estimateRouteWithApi('Tokyo Station', { placeId: 'place-1' }, '2027-03-10T10:00:00+09:00', 'TRANSIT', 'test-key', async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ routes: [{ duration: '1200s', distanceMeters: 5000 }] }), { status: 200 });
    });
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe('routes.duration,routes.distanceMeters');
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({ origin: { address: 'Tokyo Station' }, destination: { placeId: 'place-1' }, travelMode: 'TRANSIT' });
    expect(result).toMatchObject({ status: 'live', durationMinutes: 20, distanceMeters: 5000 });
  });

  it('returns no made-up live duration for API errors, empty or malformed routes', async () => {
    for (const fetcher of [
      async () => new Response('', { status: 429 }),
      async () => new Response(JSON.stringify({ routes: [] }), { status: 200 }),
      async () => new Response(JSON.stringify({ routes: [{ duration: 'soon', distanceMeters: 'far' }] }), { status: 200 }),
      async () => new Response('{bad', { status: 200 }),
    ]) {
      const result = await estimateRouteWithApi('A', 'B', '', 'DRIVE', 'test-key', fetcher as typeof fetch);
      expect(result.status).toBe('unavailable');
      expect(result).not.toHaveProperty('durationMinutes');
      expect(result).not.toHaveProperty('distanceMeters');
    }
  });
});
