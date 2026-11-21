// Grappige teksten en de toeter.

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });

export const startLine = (hh) => pick([
  `Goede reis, ${hh}! 🚗`,
  `Gordels om, ${hh}! 🎶`,
  'Disco Polo vertrekt 🪩',
  `Rij voorzichtig, ${hh}!`,
  'Muziekje aan, en gaan! 🎵',
]);

export function stopLine(km, hh) {
  if (km < 3) return { title: 'Even naar de bakker? 🥐', sub: `${km} km voor ${hh}` };
  if (km >= 150) return { title: 'Wat een tripje! 🛣️', sub: `${nf0.format(km)} km voor ${hh}, de Polo is moe` };
  return pick([
    { title: 'Polo staat weer veilig geparkeerd', sub: `${km} km voor ${hh}` },
    { title: 'Lekker gereden!', sub: `${km} km erbij voor ${hh}` },
    { title: 'Weer thuis, of in elk geval ergens', sub: `${km} km voor ${hh}` },
  ]);
}

export function tankLine(cost, lp) {
  const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
  const prijs = lp ? `${eur.format(lp)} per liter` : '';
  if (lp >= 2.3) return { emo: '😱', kind: 'shock', title: `Au! ${prijs}`, sub: `${eur.format(cost)} getankt` };
  if (lp && lp < 2.0) return { emo: '🤑', kind: 'wave', title: 'Koopje!', sub: `${prijs}, ${eur.format(cost)} getankt` };
  return { emo: '⛽', kind: 'wave', title: 'Vol is vol!', sub: `${eur.format(cost)} getankt${prijs ? ` · ${prijs}` : ''}` };
}

/** Vergelijking voor een aantal km: "zo'n 3× naar Parijs". Afstanden vanaf Rotterdam, enkele reis. */
const TRIPS = [
  [1500, 'naar Barcelona', '🏖️'], [1300, 'naar Rome', '🍕'], [650, 'naar Berlijn', '🥨'],
  [440, 'naar Parijs', '🥐'], [80, 'naar Amsterdam', '🚲'], [60, 'naar Utrecht', '🏛️'], [25, 'naar Den Haag', '🏖️'],
];
export function compareLine(km) {
  if (km < 25) return '';
  for (const [d, where, emo] of TRIPS) {
    const x = km / d;
    if (x >= 1) return `Samen ${nf0.format(km)} km: zo'n ${x >= 2 ? `${nf0.format(Math.floor(x))}×` : 'een keer'} ${where} ${emo}`;
  }
  return '';
}

let audio;
/** Tweetonige toeter met Web Audio (geen geluidsbestand nodig). Alleen na een tik. */
export function honk() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.setValueAtTime(0.18, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.2);
    gain.gain.setValueAtTime(0.18, t + 0.42);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 1800;
    filter.connect(gain); gain.connect(audio.destination);
    for (const f of [392, 494]) {
      const o = audio.createOscillator();
      o.type = 'square'; o.frequency.value = f;
      o.connect(filter); o.start(t); o.stop(t + 0.52);
    }
  } catch { /* geen geluid, dan alleen het wolkje */ }
}

/** IJscowagen-deuntje voor het broodkarretje (alleen na een tik). */
export function jingle() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = [659, 784, 880, 784, 659, 523, 587, 659];
    notes.forEach((f, i) => {
      const t = audio.currentTime + i * 0.16, o = audio.createOscillator(), g = audio.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.16);
    });
  } catch { /* geen geluid */ }
}
