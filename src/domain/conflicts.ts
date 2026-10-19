import type { TripEvent } from './itinerary.schema.js';
import { instant } from './time.js';
export type Finding = { type: 'conflict'|'tight_transfer'|'missing_information'|'not_checked'; code: string; eventIds: string[]; message: string; availableMinutes?: number; requiredMinutes?: number };
export type RouteEstimator = (from: string, to: string, departureTime: string) => Promise<{ status: 'live'|'simulated'|'unavailable'; durationMinutes?: number; distanceMeters?: number; source: string }>;
export async function analyzeEvents(events: TripEvent[], buffer: number, route: RouteEstimator, checkLocations = true): Promise<Finding[]> {
  const sorted = [...events].sort((a,b) => instant(a.start)-instant(b.start)); const findings: Finding[] = [];
  for (let i=0;i<sorted.length;i++) for (let j=i+1;j<sorted.length;j++) {
    const a=sorted[i]!, b=sorted[j]!; if (instant(b.start) >= instant(a.end)) break;
    findings.push({type:'conflict',code:'overlap',eventIds:[a.id,b.id],message:`${a.title} overlaps ${b.title}.`});
  }
  if (!checkLocations) return findings;
  for (let i=0;i<sorted.length-1;i++) {
    const a=sorted[i]!, b=sorted[i+1]!;
    if (a.kind==='flight' || b.kind==='flight') continue;
    const from=a.location?.address ?? a.location?.name ?? a.location?.placeId;
    const to=b.location?.address ?? b.location?.name ?? b.location?.placeId;
    if (!from || !to) { findings.push({type:'missing_information',code:'missing_location',eventIds:[a.id,b.id],message:`Location is missing for ${!from ? a.title : b.title}; transfer feasibility was not checked.`}); continue; }
    try {
      const result=await route(from,to,a.end); if (result.status==='unavailable' || result.durationMinutes===undefined) { findings.push({type:'not_checked',code:'route_unavailable',eventIds:[a.id,b.id],message:`Route estimate unavailable (${result.source}); transfer feasibility was not checked.`}); continue; }
      const available=(instant(b.start)-instant(a.end))/60000, required=result.durationMinutes+buffer;
      if (available<result.durationMinutes) findings.push({type:'conflict',code:'impossible_transfer',eventIds:[a.id,b.id],availableMinutes:available,requiredMinutes:required,message:`The ${result.status} route estimate (${result.durationMinutes} min) exceeds the available ${available} min.`});
      else if (available<required) findings.push({type:'tight_transfer',code:'tight_transfer',eventIds:[a.id,b.id],availableMinutes:available,requiredMinutes:required,message:`Only ${available} min are available; route plus ${buffer} min buffer needs ${required} min.`});
    } catch { findings.push({type:'not_checked',code:'route_unavailable',eventIds:[a.id,b.id],message:'Route estimate failed; transfer feasibility was not checked.'}); }
  }
  return findings;
}
