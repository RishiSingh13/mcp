import { z } from 'zod';

const encodedBodyLimit = 128_000;
const totalTextLimit = 160_000;

type GmailPart = {
  mimeType?: unknown;
  filename?: unknown;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: unknown };
  parts?: GmailPart[];
};

function decodeHtml(text: string): string {
  return text
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Math.min(0x10ffff, Number(value))))
    .replace(/&#x([\da-f]+);/gi, (_match, value: string) => String.fromCodePoint(Math.min(0x10ffff, parseInt(value, 16))))
    .replace(/\s+/g, ' ').trim();
}

export function extractGmailText(payload: GmailPart | undefined): { text: string; truncated: boolean } {
  const plain: string[] = [];
  const html: string[] = [];
  let consumed = 0;
  let truncated = false;
  const visit = (part: GmailPart): void => {
    if (consumed >= totalTextLimit) { truncated = true; return; }
    for (const child of part.parts ?? []) visit(child);
    if (typeof part.filename === 'string' && part.filename.length > 0) return;
    const type = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
    if (type !== 'text/plain' && type !== 'text/html') return;
    const encoded = part.body?.data;
    if (typeof encoded !== 'string' || !encoded) return;
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(encoded)) { truncated = true; return; }
    const limited = encoded.slice(0, encodedBodyLimit);
    if (limited.length !== encoded.length) truncated = true;
    const remaining = totalTextLimit - consumed;
    const contentType = part.headers?.find(header => header.name?.toLowerCase() === 'content-type')?.value ?? '';
    const charset = /charset\s*=\s*["']?([\w.-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
    let decodedBytes: string;
    try { decodedBytes = new TextDecoder(charset, { fatal: false }).decode(Buffer.from(limited, 'base64url')); }
    catch { decodedBytes = Buffer.from(limited, 'base64url').toString('utf8'); }
    const decoded = decodedBytes.slice(0, remaining);
    consumed += decoded.length;
    if (type === 'text/plain') plain.push(decoded);
    else html.push(decoded);
  };
  if (payload) visit(payload);
  const selected = plain.length ? plain.join('\n') : html.map(decodeHtml).join('\n');
  if (selected.length > totalTextLimit) truncated = true;
  return { text: selected.slice(0, totalTextLimit), truncated };
}

const headerSchema = z.object({ name: z.string().optional(), value: z.string().optional() });
const messageSchema = z.object({
  id: z.string().min(1).max(200),
  threadId: z.string().max(200).optional(),
  internalDate: z.string().regex(/^\d{1,16}$/).optional(),
  payload: z.object({
    headers: z.array(headerSchema).max(100).optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    body: z.object({ data: z.unknown().optional() }).optional(),
    parts: z.array(z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

function headerValue(headers: { name?: string; value?: string }[], name: string): string | undefined {
  return headers.find(item => item.name?.toLowerCase() === name.toLowerCase())?.value?.slice(0, 300);
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim().slice(0, 160);
  }
  return undefined;
}

function eventValue(text: string, label: string): string | undefined {
  const value = new RegExp(`(?:${label})\\s*(?:at|:|-)\\s*([^\\r\\n]{1,100})`, 'i').exec(text)?.[1]?.trim().replace(/[.;,]+$/, '');
  if (!value || !/(?:\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm)\b)/i.test(value)) return undefined;
  return value.slice(0, 100);
}

export type BookingCandidate = {
  id: string;
  threadId?: string;
  subject: string;
  date?: string;
  providerDomain?: string;
  extracted: {
    referenceAvailable: boolean;
    departure?: string;
    arrival?: string;
    checkIn?: string;
    checkOut?: string;
    activityStart?: string;
    location?: string;
    timezoneStatus: 'explicit' | 'ambiguous' | 'missing';
    timeZoneByField: {
      departure: 'explicit' | 'ambiguous' | 'missing';
      arrival: 'explicit' | 'ambiguous' | 'missing';
      checkIn: 'explicit' | 'ambiguous' | 'missing';
      checkOut: 'explicit' | 'ambiguous' | 'missing';
      activityStart: 'explicit' | 'ambiguous' | 'missing';
    };
  };
  source: 'live';
  sourceType: 'gmail_message';
  untrustedContent: true;
  bodyTruncated: boolean;
};

export function parseBookingMessage(input: unknown): BookingCandidate | undefined {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const message = parsed.data;
  const headers = message.payload?.headers ?? [];
  const subject = headerValue(headers, 'Subject') ?? '(no subject)';
  const dateHeader = headerValue(headers, 'Date');
  const from = headerValue(headers, 'From');
  const domain = from?.match(/@([a-z\d.-]+)\s*>?$/i)?.[1]?.toLowerCase();
  const { text, truncated } = extractGmailText(message.payload as GmailPart | undefined);
  const context = `${subject}\n${text}`;
  const bookingContext = /\b(?:booking|reservation|confirmation|confirmed|e-?ticket|ticket\s+(?:issued|number)|itinerary|check-?in|check-?out|voucher)\b/i.test(context);
  const travelContext = /\b(?:flight|airline|boarding|hotel|accommodation|train|rail|bus|ferry|transfer|rental\s+car|tour|excursion|activity|venue)\b/i.test(context);
  const confirmationLanguage = /\b(?:your\s+(?:booking|reservation|flight|stay|ticket|tour)|has been confirmed|is confirmed|booking confirmed|reservation confirmed|confirmation (?:number|code)|ticket (?:number|issued)|check-?in confirmation)\b/i.test(context);
  const referenceEvidence = /\b(?:booking|reservation|confirmation)\s*(?:reference|number|code|#)\s*[:#-]?\s*[A-Z0-9-]{4,40}\b/i.test(context);
  const irrelevant = /\b(?:job alert|career opportunity|internship|newsletter|unsubscribe|weekly digest|github notification|pull request|repository|promotion|limited time offer|sale ends)\b/i.test(`${subject} ${text.slice(0, 5000)}`);
  if (!travelContext || !bookingContext || (!confirmationLanguage && !referenceEvidence) || (irrelevant && !confirmationLanguage)) return undefined;
  const reference = firstMatch(text, [/(?:booking|confirmation|reservation)\s*(?:reference|number|#|code)\s*[:#-]?\s*([a-z\d-]{4,40})/i]);
  const departure = eventValue(text, 'departure|departs?|leaves?');
  const arrival = eventValue(text, 'arrival|arrives?');
  const checkIn = eventValue(text, 'check[ -]?in');
  const checkOut = eventValue(text, 'check[ -]?out');
  const activityStart = eventValue(text, 'activity starts?|start time');
  const location = firstMatch(text, [/(?:property address|venue|location)\s*:\s*([^.;\n]{3,160})/i]);
  const eventTime = [departure, arrival, checkIn, checkOut, activityStart].filter(Boolean).join(' ');
  const timezoneStatus = (value: string | undefined): 'explicit' | 'ambiguous' | 'missing' => !value ? 'missing'
    : /(?:\b(?:UTC|GMT|JST|PST|PDT|EST|EDT|CST|CDT|IST|CET|CEST)\b|[+-]\d{2}:?\d{2}|\b[A-Z][a-z]+\/[A-Z][A-Za-z_+-]+\b)/.test(value) ? 'explicit' : 'ambiguous';
  const timeZoneByField = { departure: timezoneStatus(departure), arrival: timezoneStatus(arrival), checkIn: timezoneStatus(checkIn), checkOut: timezoneStatus(checkOut), activityStart: timezoneStatus(activityStart) };
  return {
    id: message.id,
    ...(message.threadId ? { threadId: message.threadId } : {}),
    subject,
    ...(dateHeader ? { date: dateHeader } : message.internalDate && Number.isFinite(Number(message.internalDate)) && Number(Number(message.internalDate)) <= 8.64e15 ? { date: new Date(Number(message.internalDate)).toISOString() } : {}),
    ...(domain ? { providerDomain: domain } : {}),
    extracted: {
      referenceAvailable: Boolean(reference),
      ...(departure ? { departure } : {}), ...(arrival ? { arrival } : {}),
      ...(checkIn ? { checkIn } : {}), ...(checkOut ? { checkOut } : {}),
      ...(activityStart ? { activityStart } : {}), ...(location ? { location } : {}),
      timezoneStatus: eventTime ? (Object.values(timeZoneByField).some(value => value === 'ambiguous') ? 'ambiguous' : 'explicit') : 'missing',
      timeZoneByField,
    },
    source: 'live', sourceType: 'gmail_message', untrustedContent: true, bodyTruncated: truncated,
  };
}
