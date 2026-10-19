export function instant(value: string): number { const n = Date.parse(value); if (!Number.isFinite(n)) throw new Error('Invalid RFC3339 timestamp'); return n; }
export function minutesBetween(a: string, b: string): number { return (instant(b) - instant(a)) / 60000; }
