// Reserveringen uit de gedeelde Google-agenda (geheim iCal-adres in CALENDAR_ICS). Alleen lezen.
// Bewust simpel: losse afspraken (geen herhalingen), Klein/Groot herkend aan het woord in de titel.

const unfold = (t) => t.replace(/\r?\n[ \t]/g, '');

/** Lokale tijd in een tijdzone → UTC-milliseconden (zonder bibliotheek). */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return guess - (asLocal - guess);
}

function parseTime(line, calTz) {
  if (!line) return null;
  const [head, value] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()];
  const tz = (head.match(/TZID=([^;:]+)/) || [])[1] || calTz || 'Europe/Amsterdam';
  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}`, ms: zonedToUtc(+m[1], +m[2], +m[3], 0, 0, 0, calTz || 'Europe/Amsterdam') };
  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const ms = m[7] ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], tz);
  return { allDay: false, ms };
}

const text = (v) => String(v || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
export const hhOfTitle = (t) => (/\bklein\b/i.test(t) ? 'Klein' : /\bgroot\b/i.test(t) ? 'Groot' : null);

/** Afspraken die (deels) in het venster vallen, oplopend. */
export function parseIcs(ics, { from, to }) {
  const t = unfold(ics);
  const calTz = (t.match(/^X-WR-TIMEZONE:(.+)$/m) || [])[1]?.trim();
  const out = [];
  for (const block of t.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = (k) => (body.match(new RegExp(`^${k}[;:][^\\n]*`, 'm')) || [])[0]?.replace(/\r$/, '');
    if (/^STATUS:CANCELLED/m.test(body) || get('RECURRENCE-ID')) continue;
    const s = parseTime(get('DTSTART'), calTz);
    if (!s) continue;
    let e = parseTime(get('DTEND'), calTz);
    if (!e) e = { ...s, ms: s.ms + (s.allDay ? 86400e3 : 3600e3) };
    if (e.ms <= from || s.ms >= to) continue;
    const title = text((get('SUMMARY') || '').replace(/^SUMMARY[^:]*:/, '')).slice(0, 60);
    out.push({ start: s.ms, end: e.ms, allDay: s.allDay, title, hh: hhOfTitle(title) });
  }
  return out.sort((a, b) => a.start - b.start);
}

let cache = null;
/** Komende twee weken (en wat nu loopt). null = geen agenda ingesteld. */
export async function fetchAgenda(url, { fetchFn = fetch, now = Date.now(), maxAgeMs = 5 * 60e3 } = {}) {
  if (!url) return null;
  if (cache && cache.url === url && now - cache.at < maxAgeMs) return cache.data;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Agenda gaf ${res.status}`);
  const data = parseIcs(await res.text(), { from: now - 86400e3, to: now + 14 * 86400e3 }).slice(0, 20);
  cache = { url, at: now, data };
  return data;
}
export const _resetAgendaCache = () => { cache = null; };
