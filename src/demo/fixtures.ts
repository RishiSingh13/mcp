export const demoEmailCandidates = [
  {id:'demo-gmail-flight-001',from:'noreply@example.test',subject:'DEMO: Flight confirmation',date:'2027-03-09T08:00:00Z',snippet:'SYNTHETIC demo confirmation: Example Air flight EX123 arrives at Tokyo Haneda on 2027-03-10 at 09:00 JST. No real booking exists.',untrustedContent:true,source:'simulated'},
  {id:'demo-gmail-hotel-001',from:'booking@example.test',subject:'DEMO: Hotel reservation',date:'2027-03-09T08:05:00Z',snippet:'SYNTHETIC demo confirmation: Example Hotel check-in 2027-03-10 at 12:00 JST. No real booking exists.',untrustedContent:true,source:'simulated'}
];
export const demoCalendarEvents = [
  {id:'demo-calendar-001',title:'DEMO: Existing planning meeting',start:'2027-03-10T14:00:00+09:00',end:'2027-03-10T15:00:00+09:00',timeZone:'Asia/Tokyo',location:'',status:'confirmed',source:'simulated' as const}
];
