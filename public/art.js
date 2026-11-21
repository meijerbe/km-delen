// Illustraties: de vier poppetjes en het lichtblauwe autootje (inline SVG, geen externe bestanden).

const SKIN = '#F7CDAE';
const CHEEK = '<circle cx="23.5" cy="34" r="2.6" fill="#F29A8E" opacity=".45"/><circle cx="40.5" cy="34" r="2.6" fill="#F29A8E" opacity=".45"/>';
const INK = '#3B2F2A';
const face = `<rect x="28" y="38" width="8" height="10" rx="3" fill="${SKIN}"/>`;
const head = `<circle cx="32" cy="29" r="13" fill="${SKIN}"/>`;
const ears = `<circle cx="19.3" cy="30" r="2.8" fill="${SKIN}"/><circle cx="44.7" cy="30" r="2.8" fill="${SKIN}"/>`;
const shirt = (fill, extra = '') => `<path d="M11 64 Q13 47.5 32 46.5 Q51 47.5 53 64 Z" fill="${fill}" ${extra}/>`;

const PEOPLE = {
  // Groot — meisje: lang blond haar, zwarte ovale zonnebril, gouden oorringen, wit shirt, kettinkje
  grootM: () => `
    <path d="M17.5 28 Q17 12 32 12 Q47 12 46.5 28 L48 55 Q40 59 32 58 Q24 59 16 55 Z" fill="#EFCB7E"/>
    ${face}${shirt('#FFFFFF', 'stroke="#E9E2D8" stroke-width="1"')}
    <path d="M27 47.5 Q32 53.5 37 47.5" fill="none" stroke="#E0AE3A" stroke-width="1.1"/>
    <path d="M32 53 q1.8 .6 1.2 2.6 q-1.4 1 -2.4 -.2" fill="none" stroke="#E0AE3A" stroke-width="1.3"/>
    <path d="M17.5 38 L15.5 57 L21.5 56 L21.5 41 Z M46.5 38 L48.5 57 L42.5 56 L42.5 41 Z" fill="#EFCB7E"/>
    ${head}${CHEEK}
    <path d="M18.6 31 Q18 15 32 15 Q46 15 45.4 31 Q44 21 33 19.5 L32 23 L31 19.5 Q20 21 18.6 31 Z" fill="#F3D48F"/>
    <path d="M18.6 29 Q18 40 21 47 L23 46.5 Q20.5 38 21.2 28 Z M45.4 29 Q46 40 43 47 L41 46.5 Q43.5 38 42.8 28 Z" fill="#EFCB7E"/>
    <ellipse cx="26.3" cy="28.6" rx="5.2" ry="3.2" fill="#1E1B1A"/><ellipse cx="37.7" cy="28.6" rx="5.2" ry="3.2" fill="#1E1B1A"/>
    <path d="M31.3 28.4 h1.4" stroke="#1E1B1A" stroke-width="1.4"/>
    <ellipse cx="24.8" cy="27.6" rx="1.5" ry=".7" fill="#fff" opacity=".35"/><ellipse cx="36.2" cy="27.6" rx="1.5" ry=".7" fill="#fff" opacity=".35"/>
    <path d="M25.5 34.5 Q32 41.5 38.5 34.5 Z" fill="#fff" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="19.6" cy="35.5" r="2.7" fill="none" stroke="#E0AE3A" stroke-width="1.5"/>
    <circle cx="44.4" cy="35.5" r="2.7" fill="none" stroke="#E0AE3A" stroke-width="1.5"/>`,

  // Groot — jongen: kort geschoren haar, bruine rechthoekige zonnebril, snorretje, groen shirt, oordopjes
  grootJ: () => `
    ${face}${shirt('#A3B096')}
    ${ears}${head}${CHEEK}
    <path d="M19.4 27 Q19 14.5 32 14.3 Q45 14.5 44.6 27 Q42.5 19.5 32 19 Q21.5 19.5 19.4 27 Z" fill="#B48C62"/>
    <rect x="20.5" y="25" width="10" height="6.6" rx="2" fill="#2E241C" stroke="#7A5434" stroke-width="1"/>
    <rect x="33.5" y="25" width="10" height="6.6" rx="2" fill="#2E241C" stroke="#7A5434" stroke-width="1"/>
    <path d="M30.5 27.2 h3" stroke="#7A5434" stroke-width="1.3"/>
    <path d="M27 35.4 Q29.5 33.6 32 34.6 Q34.5 33.6 37 35.4" fill="none" stroke="#9C7650" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M28.2 38.2 Q32 40.4 35.8 38.2" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>
    <rect x="17.6" y="31" width="2.4" height="4.2" rx="1.2" fill="#fff" stroke="#ddd" stroke-width=".5"/>
    <rect x="44" y="31" width="2.4" height="4.2" rx="1.2" fill="#fff" stroke="#ddd" stroke-width=".5"/>`,

  // Klein — jongen: opzij gekamd blond haar, zonnebril op het hoofd, roze shirt, scheve glimlach
  kleinJ: () => `
    ${face}${shirt('#F4D9CD')}
    ${ears}${head}${CHEEK}
    <path d="M18.6 28 Q15.5 10.5 33 9.5 Q48.5 9 45.6 26 Q44 18 37.5 17.5 Q29 20.5 22 20 Q19.6 23 18.6 28 Z" fill="#C79C62"/>
    <path d="M21.5 20.5 Q31 10.5 45 17.5 Q37 16 30.5 21.5 Q26 20.6 21.5 20.5 Z" fill="#D7AE73"/>
    <circle cx="26" cy="12.6" r="4.4" fill="#5A6BC8" fill-opacity=".85" stroke="#1F2230" stroke-width="1.3"/>
    <circle cx="38" cy="12.6" r="4.4" fill="#5A6BC8" fill-opacity=".85" stroke="#1F2230" stroke-width="1.3"/>
    <path d="M30.4 12.4 h3.2" stroke="#1F2230" stroke-width="1.3"/>
    <path d="M24.5 25.6 q2.5 -1.4 5 0 M34.5 25.4 q2.5 -1.2 5 .2" fill="none" stroke="#A47E4E" stroke-width="1.2" stroke-linecap="round"/>
    <circle cx="27" cy="29.2" r="1.6" fill="${INK}"/><circle cx="37" cy="29.2" r="1.6" fill="${INK}"/>
    <path d="M27.2 36.2 Q33 39.8 38 35" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`,

  // Klein — meisje: bruin haar tot de schouders, schildpad-zonnebril op het hoofd, gouden oorringetjes
  kleinM: () => `
    <path d="M17 28 Q16 11 32 11 Q48 11 47 28 L47.5 47 Q40 50 32 49 Q24 50 16.5 47 Z" fill="#8B5A3C"/>
    ${face}${shirt('#E6E0D6')}
    <path d="M24 47.4 L23.5 64 M40 47.4 L40.5 64" stroke="#B8894F" stroke-width="2"/>
    ${head}${CHEEK}
    <path d="M18.8 30 Q18 13.5 32 13.4 Q46 13.5 45.2 30 Q43.5 18.5 29.5 17.8 Q22.5 19.5 18.8 30 Z" fill="#94613F"/>
    <path d="M18.8 28 Q18 38 20.5 45 L22.5 44.5 Q20.3 37 21 27.5 Z M45.2 28 Q46 38 43.5 45 L41.5 44.5 Q43.7 37 43 27.5 Z" fill="#8B5A3C"/>
    <rect x="20.5" y="9.6" width="10" height="5.6" rx="2.8" fill="#7A4A2A" stroke="#4A2C18" stroke-width=".8"/>
    <rect x="33.5" y="9.6" width="10" height="5.6" rx="2.8" fill="#7A4A2A" stroke="#4A2C18" stroke-width=".8"/>
    <path d="M30.5 12 h3" stroke="#4A2C18" stroke-width="1"/>
    <path d="M24.3 29.4 Q26.8 27 29.3 29.4 M34.7 29.4 Q37.2 27 39.7 29.4" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M26 34.6 Q32 41 38 34.6 Z" fill="#fff" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="19.8" cy="34.6" r="1.9" fill="none" stroke="#E0AE3A" stroke-width="1.3"/>
    <circle cx="44.2" cy="34.6" r="1.9" fill="none" stroke="#E0AE3A" stroke-width="1.3"/>`,
};

export const COUPLES = { Klein: ['kleinJ', 'kleinM'], Groot: ['grootM', 'grootJ'] };

/** Losse poppetje als <svg>. */
export function avatar(who, size = 44) {
  return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${PEOPLE[who]()}</svg>`;
}

/** Twee poppetjes van een stel, iets over elkaar heen. */
export function duo(hh, size = 40) {
  return `<span class="duo" aria-hidden="true">${COUPLES[hh].map((p) => avatar(p, size)).join('')}</span>`;
}

let uid = 0;
/** Lichtblauwe VW Polo (2008, zijaanzicht) met het stel achter de ramen. */
export function car(hh) {
  const n = ++uid;
  const [front, back] = hh ? [COUPLES[hh][0], COUPLES[hh][1]] : [null, null];
  const rear = 'M58 86 Q56 68 64 58 Q70 50 82 50 L121 50 L121 86 Z';
  const fwd = 'M130 50 L167 50 Q179 50 187 59 L210 86 L130 86 Z';
  const person = (who, x) => (who
    ? `<svg x="${x}" y="44" width="58" height="58" viewBox="0 0 64 64">${PEOPLE[who]()}</svg>` : '');
  const wheel = (cx) => `
    <g class="wheel" style="transform-origin:${cx}px 132px">
      <circle cx="${cx}" cy="132" r="21" fill="#2C2F33"/>
      <circle cx="${cx}" cy="132" r="12" fill="#D9E0E6"/>
      <path d="M${cx} 121 V143 M${cx - 11} 132 H${cx + 11} M${cx - 7.8} 124.2 L${cx + 7.8} 139.8 M${cx - 7.8} 139.8 L${cx + 7.8} 124.2" stroke="#A9B3BC" stroke-width="2"/>
      <circle cx="${cx}" cy="132" r="3.5" fill="#8B96A0"/>
    </g>`;
  return `
  <svg class="car" viewBox="0 0 300 176" role="img" aria-label="Lichtblauwe Polo${hh ? ` met ${hh}` : ''}">
    <defs>
      <clipPath id="w1-${n}"><path d="${rear}"/></clipPath>
      <clipPath id="w2-${n}"><path d="${fwd}"/></clipPath>
    </defs>
    <g class="road">
      <rect x="0" y="152" width="300" height="22" rx="4" fill="#E9E4DA"/>
      <g class="dashes">${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 44 - 20}" y="161" width="24" height="4" rx="2" fill="#fff"/>`).join('')}</g>
    </g>
    <ellipse cx="152" cy="153" rx="118" ry="6" fill="#000" opacity=".08"/>
    <g class="puffs"><circle cx="30" cy="132" r="5" fill="#D8D3CA"/><circle cx="17" cy="125" r="7" fill="#E4E0D8"/></g>
    <g class="body">
      <path d="M40 124 L40 96 Q40 70 52 58 Q60 43 78 42 L170 42 Q186 42 197 55 L222 84 L250 91 Q265 95 265 113 L265 124 Q265 133 256 133 L49 133 Q40 133 40 124 Z" fill="#A8D4F0"/>
      <path d="M40 112 H265 V124 Q265 133 256 133 H49 Q40 133 40 124 Z" fill="#8FC2E4"/>
      <rect x="36" y="114" width="20" height="9" rx="4" fill="#7C8C99"/><rect x="250" y="114" width="19" height="9" rx="4" fill="#7C8C99"/>
      <path d="M50 88 Q49 66 58 56 Q65 45 78 44.5 L170 44.5 Q183 44.5 193 56 L218 87 Z" fill="#7FB4D8"/>
      <path d="${rear}" fill="#E4F3FC"/><path d="${fwd}" fill="#E4F3FC"/>
      <g clip-path="url(#w1-${n})">${person(back, 62)}</g>
      <g clip-path="url(#w2-${n})">${person(front, 136)}</g>
      <path d="M63 66 L68 59 M136 55 L144 55" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
      <path d="M125.5 46 V128 M199 88 Q202 108 198 128" stroke="#7FB4D8" stroke-width="2.2" fill="none"/>
      <rect x="100" y="95" width="12" height="3.6" rx="1.8" fill="#6FA6CC"/><rect x="170" y="95" width="12" height="3.6" rx="1.8" fill="#6FA6CC"/>
      <path d="M205 79 q8 -4 11 2 l-1.5 6 h-8 z" fill="#8FC2E4" stroke="#6FA6CC" stroke-width="1.2"/>
      <path d="M248 95 q13 1 16 11 h-13 q-4 -5 -3 -11 z" fill="#FFF3C4" stroke="#E7D58E" stroke-width="1"/>
      <rect x="41" y="88" width="7" height="14" rx="2.5" fill="#F06B5E"/>
      <path d="M62 133 a24 24 0 0 1 48 0 M198 133 a24 24 0 0 1 48 0" fill="#6E8CA3"/>
    </g>
    ${wheel(86)}${wheel(222)}
  </svg>`;
}

/** App-icoon / logo: alleen het autootje. */
export const logo = () => car(null);
