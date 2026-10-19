import { z } from 'zod';
import { env } from '../config/env.js';

export const travelWebSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(300).refine(value => value.split(/\s+/).length <= 75, 'Query must contain no more than 75 words.'),
  country: z.string().regex(/^[A-Za-z]{2}$/).transform(value => value.toUpperCase()).optional(),
  language: z.string().regex(/^[A-Za-z]{2,12}$/).transform(value => value.toLowerCase()).optional(),
  count: z.number().int().min(1).max(10).default(5),
  officialDomain: z.string().max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i).optional(),
}).strict();

export type TravelWebSearchInput = z.infer<typeof travelWebSearchInputSchema>;
export type TravelWebSearchResult = {
  status: 'live' | 'unavailable';
  provider: 'Brave Search' | 'Tavily';
  retrievedAt: string;
  officialDomain?: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    domain: string;
    officialDomainMatch: boolean;
    sourceType: 'matches_requested_domain' | 'third_party_or_unverified';
    publishedAt?: string;
    untrustedContent: true;
  }>;
  error?: string;
};

const resultSchema = z.object({
  title: z.string().max(2_000),
  url: z.string().max(4_096),
  description: z.string().max(10_000).nullable().optional(),
  page_age: z.string().max(200).nullable().optional(),
}).passthrough();
const responseSchema = z.object({ web: z.object({ results: z.array(z.unknown()).max(100) }).nullable() }).passthrough();

function unavailable(retrievedAt: string, reason: string, officialDomain?: string): TravelWebSearchResult {
  return { status: 'unavailable', provider: 'Brave Search', retrievedAt, ...(officialDomain ? { officialDomain } : {}), results: [], error: reason };
}

export async function searchTravelWeb(
  input: TravelWebSearchInput,
  options: { apiKey?: string; fetcher?: typeof fetch; now?: () => Date; timeoutMs?: number } = {},
): Promise<TravelWebSearchResult> {
  const parsed = travelWebSearchInputSchema.safeParse(input);
  const now = (options.now ?? (() => new Date()))().toISOString();
  if (!parsed.success) return unavailable(now, 'Invalid search input. Check the tool schema.');
  const { query, country, language, count, officialDomain } = parsed.data;
  const apiKey = options.apiKey ?? env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return unavailable(now, 'Brave Search is not configured.', officialDomain);
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', `${query}${officialDomain ? ` site:${officialDomain}` : ''}`);
  url.searchParams.set('count', String(count));
  if (country) url.searchParams.set('country', country);
  if (language) url.searchParams.set('search_lang', language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET', signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    });
    if (!response.ok) return unavailable(now, response.status === 429 ? 'Brave Search rate limit reached.' : `Brave Search returned HTTP ${response.status}.`, officialDomain);
    const raw = await response.text();
    if (raw.length > 1_000_000) return unavailable(now, 'Brave Search returned an oversized response.', officialDomain);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return unavailable(now, 'Brave Search returned malformed data.', officialDomain); }
    const responseData = responseSchema.safeParse(json);
    if (!responseData.success) return unavailable(now, 'Brave Search returned an invalid response.', officialDomain);
    const results: TravelWebSearchResult['results'] = [];
    for (const candidate of responseData.data.web?.results ?? []) {
      const parsedResult = resultSchema.safeParse(candidate);
      if (!parsedResult.success) return unavailable(now, 'Brave Search returned an invalid result.', officialDomain);
      let pageUrl: URL;
      try { pageUrl = new URL(parsedResult.data.url); } catch { return unavailable(now, 'Brave Search returned an invalid result URL.', officialDomain); }
      if (!['https:', 'http:'].includes(pageUrl.protocol) || pageUrl.username || pageUrl.password || !pageUrl.hostname) return unavailable(now, 'Brave Search returned an invalid result URL.', officialDomain);
      const domain = pageUrl.hostname.toLowerCase();
      const target = officialDomain?.toLowerCase();
      results.push({
        title: parsedResult.data.title.slice(0, 300), url: pageUrl.toString(),
        snippet: (parsedResult.data.description ?? '').slice(0, 1_000), domain,
        officialDomainMatch: Boolean(target && (domain === target || domain.endsWith(`.${target}`))),
        sourceType: target && (domain === target || domain.endsWith(`.${target}`)) ? 'matches_requested_domain' : 'third_party_or_unverified',
        ...(parsedResult.data.page_age ? { publishedAt: parsedResult.data.page_age } : {}),
        untrustedContent: true,
      });
      if (results.length >= count) break;
    }
    return { status: 'live', provider: 'Brave Search', retrievedAt: now, ...(officialDomain ? { officialDomain } : {}), results };
  } catch {
    return unavailable(now, 'Brave Search request failed or timed out.', officialDomain);
  } finally { clearTimeout(timer); }
}
