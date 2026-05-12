#!/usr/bin/env node
/**
 * Merges Arabic display labels from bosta_regionsAR.json into
 * public/assets/js/bosta-regions-data-processed.json for metro governorates:
 * Cairo, Giza, Qalyubia (Bosta ENG: El Kalioubia → app key Qalyubia).
 * English `value` fields follow Bosta ENG (API / validation).
 *
 * Re-run when Bosta updates either source file.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROCESSED_PATH = path.join(ROOT, 'public/assets/js/bosta-regions-data-processed.json');
const AR_SOURCE_PATH = path.join(ROOT, 'bosta_regionsAR.json');
const ENG_SOURCE_PATH = path.join(ROOT, 'bosta_regionsENG.json');

/** Metro: app JSON key, Bosta English governorate name, Arabic file governorate string, display labels */
const METRO_GOVERNORATES = [
  { key: 'Cairo', engGov: 'Cairo', arGov: 'القاهره', labelEn: 'Cairo', labelAr: 'القاهرة' },
  { key: 'Giza', engGov: 'Giza', arGov: 'الجيزه', labelEn: 'Giza', labelAr: 'الجيزة' },
  {
    key: 'Qalyubia',
    engGov: 'El Kalioubia',
    arGov: 'القليوبيه',
    labelEn: 'Qalyubia',
    labelAr: 'القليوبية',
  },
];

/** Basic Arabic → Latin transliteration (aligned with scripts/convert-bosta-regions.js) */
function transliterate(arabic) {
  if (!arabic || typeof arabic !== 'string') return '';
  const map = {
    '\u0627': 'a',
    '\u0623': 'a',
    '\u0625': 'i',
    '\u0622': 'a',
    '\u0628': 'b',
    '\u062a': 't',
    '\u062b': 'th',
    '\u062c': 'g',
    '\u062d': 'h',
    '\u062e': 'kh',
    '\u062f': 'd',
    '\u0630': 'dh',
    '\u0631': 'r',
    '\u0632': 'z',
    '\u0633': 's',
    '\u0634': 'sh',
    '\u0635': 's',
    '\u0636': 'd',
    '\u0637': 't',
    '\u0638': 'z',
    '\u0639': 'a',
    '\u063a': 'gh',
    '\u0641': 'f',
    '\u0642': 'q',
    '\u0643': 'k',
    '\u0644': 'l',
    '\u0645': 'm',
    '\u0646': 'n',
    '\u0647': 'h',
    '\u0648': 'w',
    '\u064a': 'y',
    '\u0649': 'a',
    '\u0629': 'a',
    '\u0626': 'e',
    '\u0624': 'o',
    '\u0660': '0',
    '\u0661': '1',
    '\u0662': '2',
    '\u0663': '3',
    '\u0664': '4',
    '\u0665': '5',
    '\u0666': '6',
    '\u0667': '7',
    '\u0668': '8',
    '\u0669': '9',
    '\u0654': '',
    '\u0670': '',
    '\u064b': '',
    '\u064c': '',
    '\u064d': '',
    '\u064e': '',
    '\u064f': '',
    '\u0650': '',
    '\u0651': '',
    '\u0652': '',
    '\u0640': '',
    '\ufefb': 'la',
    '\u0644\u0627': 'la',
    '\u0671': 'a',
    '\ufef7': 'la',
    '\ufef9': 'li',
    '\ufef5': 'la',
  };
  const keepChars = new Set([' ', '-', '_', '/', ',', '.', '(', ')', '[', ']', '&', "'", '’', ':']);
  let out = '';
  for (const ch of arabic) {
    if (keepChars.has(ch)) {
      out += ch;
    } else if (map[ch] !== undefined) {
      out += map[ch];
    } else {
      out += ch;
    }
  }
  out = out
    .split(/(\s+|\-|\/)/)
    .map((token) => {
      if (/^(\s+|\-|\/)$/.test(token)) return token;
      if (!token) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join('');
  return out.replace(/\s+/g, ' ').trim();
}

function tokenize(s) {
  return s
    .toLowerCase()
    .split(/[\s\-(),.]+/)
    .map((t) => t.replace(/^[\s'’`]+|[\s'’`]+$/g, ''))
    .filter(Boolean);
}

function tokenJaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter += 1;
  }
  return inter / (A.size + B.size - inter);
}

function bigramDice(s) {
  const t = s.toLowerCase().replace(/\s+/g, ' ');
  if (t.length < 2) return t.length ? 1 : 0;
  const a = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const bg = t.slice(i, i + 2);
    a.set(bg, (a.get(bg) || 0) + 1);
  }
  return a;
}

function diceBigram(mapA, mapB) {
  let inter = 0;
  let sumA = 0;
  let sumB = 0;
  for (const v of mapA.values()) sumA += v;
  for (const v of mapB.values()) sumB += v;
  if (sumA === 0 && sumB === 0) return 1;
  if (sumA === 0 || sumB === 0) return 0;
  for (const [k, va] of mapA) {
    const vb = mapB.get(k) || 0;
    inter += Math.min(va, vb);
  }
  return (2 * inter) / (sumA + sumB);
}

/** Levenshtein distance with early exit if already > maxDist. */
function levenshteinCapped(a, b, maxDist) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = cur;
  }
  return prev[n];
}

function levenshteinRatio(a, b) {
  const maxLen = Math.max(a.length, b.length, 1);
  const maxDist = Math.min(48, maxLen);
  const d = levenshteinCapped(a, b, maxDist);
  if (d > maxDist) return 0;
  return 1 - d / maxLen;
}

/** Extract primary district number from English Bosta names (Hay / Manteqa / etc.). */
function primaryDistrictNumberEn(en) {
  const m =
    en.match(/\bElHay\s*0*(\d+)\b/i) ||
    en.match(/\bHay\s*0*(\d+)\b/i) ||
    en.match(/\bElManteqa\s*0*(\d+)\b/i) ||
    en.match(/\bManteqa\s*0*(\d+)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Arabic digit char → int; also lone Western digits in Arabic string. */
function arabicDistrictDigits(ar) {
  const arabicDigit = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };
  const found = [];
  for (const ch of ar) {
    if (arabicDigit[ch] !== undefined) found.push(arabicDigit[ch]);
  }
  for (const m of ar.matchAll(/(\d{1,2})\b/g)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 15) found.push(n);
  }
  return found;
}

/** Ordinal words in Arabic area names (common in Bosta AR). */
const AR_ORDINAL = new Map([
  ['الاول', 1],
  ['الأول', 1],
  ['الثاني', 2],
  ['الثالث', 3],
  ['الرابع', 4],
  ['الخامس', 5],
  ['السادس', 6],
  ['السابع', 7],
  ['الثامن', 8],
  ['التاسع', 9],
  ['العاشر', 10],
]);

function arabicOrdinalHints(ar) {
  const nums = [];
  for (const [word, n] of AR_ORDINAL) {
    if (ar.includes(word)) nums.push(n);
  }
  return nums;
}

function districtNumberAgreementBonus(enValue, arArea) {
  const nEn = primaryDistrictNumberEn(enValue);
  if (nEn == null) return 0;
  const digits = arabicDistrictDigits(arArea);
  const ord = arabicOrdinalHints(arArea);
  const pool = [...digits, ...ord];
  if (pool.length === 0) return 0;
  if (pool.includes(nEn)) return 0.14;
  if (pool.some((x) => Math.abs(x - nEn) === 1)) return 0.02;
  return -0.12;
}

/**
 * Strong disambiguation for zones that share similar transliterations
 * (e.g. Nasr City vs New Cairo compounds).
 */
function regionHintAdjustment(enValue, arArea) {
  let adj = 0;
  const en = enValue;
  const ar = arArea;

  if (/^Nasr City\s-/i.test(en)) {
    const isNasrAr = /مدينه نصر|مدينة نصر/.test(ar) || (ar.includes('نصر') && ar.includes('مدينه'));
    if (isNasrAr) adj += 0.26;
    else adj -= 0.22;
    if (/القاهره الجديده|التجمع الخامس|التجمع الاول|التجمع الثالث|الرحاب|مدينتي/.test(ar)) adj -= 0.2;
  }

  if (/^New Cairo|^El Rehab|^Rehab|^Katameya|^Mirage|^Palm Hills|^Mountain View|^Mivida|^madinaty|^Madinaty/i.test(en)) {
    if (/القاهره الجديده|التجمع|الرحاب|مدينتي|المنجزات|الشيخ زايد/.test(ar)) adj += 0.2;
  }

  if (/^El Shorouk|^Shorouk|^ElShorouk/i.test(en)) {
    if (/الشروق/.test(ar)) adj += 0.22;
    else adj -= 0.08;
  }

  if (/^Minshat Nasir|^Mansheya Nasir/i.test(en)) {
    if (/منشاه ناصر|منشية ناصر|منشاه النصر|منشية النصر/.test(ar)) adj += 0.2;
  }

  if (/^6th of October|^6 October|^October Gardens|^Hadayek October|^Hadaeq|^Sheikh Zayed|^El Sheikh Zayed/i.test(en)) {
    if (/٦ اكتوبر|6 اكتوبر|اكتوبر|الشيخ زايد|حدايق اكتوبر|الحي المتميز|الواحات/.test(ar)) adj += 0.18;
  }

  if (/^15 May|^May 15/i.test(en)) {
    if (/مايو/.test(ar) && (/١٥|15/).test(ar)) adj += 0.25;
  }

  return Math.max(-0.45, Math.min(0.45, adj));
}

/**
 * High-confidence EN↔AR hints for Giza / Qalyubia (Bosta lists are same length but not row-aligned).
 * @type {Array<[RegExp, RegExp, number]>}
 */
const GIZA_QALY_AR_HINTS = [
  [/^Dokki(\s|-|$)/i, /الدقي|دقي|دقى/, 0.42],
  [/^Agouza(\s|-|$)/i, /العجوز|عجوزه|عجوزة/, 0.42],
  [/^Faisal$/i, /فيصل/, 0.38],
  [/^Haram$/i, /الهرم|هرم/, 0.35],
  [/^Warraq$/i, /وراق/, 0.35],
  [/^Imbaba$/i, /امبابه|إمبابة|امبابة/, 0.35],
  [/^Mohandessin$/i, /مهندسين|المهندسين/, 0.38],
  [/^Omrania$/i, /عمرانيه|عمرانية/, 0.35],
  [/^Manial$/i, /منيل|المنيل/, 0.35],
  [/^Boulaq El Dakrour$/i, /بولاق|الدكرور|دكرور/, 0.35],
  [/^Hadayek El Ahram$/i, /حدايق|الاهرام|أهرام/, 0.32],
  [/^ElSaff$/i, /الصف|صف/, 0.32],
  [/^Atfeeh$/i, /اطفيح|أطفيح/, 0.32],
  [/^Abu Nomros$/i, /ابو النمرس|أبو النمرس/, 0.32],
  [/^Oaseem$/i, /اويسم|أوسيم|عويسم/, 0.3],
  [/^Barageel$/i, /برجيل|البرجيل/, 0.3],
  [/desert road/i, /طريق|صحراو|اسكند|اسكندر|مطار|سفنكس|فايد|اسماعيل|اسماعيلي/, 0.22],
];

/** Higher = better match. Row = English zone index, Col = Arabic area index. */
function similarityScore(enValue, arArea, metroKey) {
  const enNorm = enValue.toLowerCase().trim();
  const arTr = transliterate(arArea).toLowerCase();
  const lev = levenshteinRatio(enNorm, arTr);
  const d1 = diceBigram(bigramDice(enNorm), bigramDice(arTr));
  const d2 = tokenJaccard(enNorm, arTr);
  const d3 = tokenJaccard(enNorm, arArea);
  const base = 0.5 * lev + 0.18 * d1 + 0.14 * d2 + 0.1 * d3;
  const dist = districtNumberAgreementBonus(enValue, arArea);
  const hint = regionHintAdjustment(enValue, arArea);
  let score = Math.max(0, Math.min(1, base + dist + hint));

  if (metroKey === 'Giza' || metroKey === 'Qalyubia') {
    const first = enValue.split(/\s*-\s*/)[0].trim();
    const fNorm = first.toLowerCase();
    if (fNorm.length >= 3 && fNorm.length <= 48) {
      const fj = Math.max(tokenJaccard(fNorm, arTr), tokenJaccard(fNorm, arArea.toLowerCase()));
      if (fj > 0.08) score += 0.08 * Math.min(1.5, fj / 0.25);
    }
    for (const [enRe, arRe, bump] of GIZA_QALY_AR_HINTS) {
      if (enRe.test(enValue.trim()) && arRe.test(arArea)) {
        score += bump;
        break;
      }
    }
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Greedy maximum-similarity bipartite matching (n iterations).
 * Avoids Hungarian pathologies where one very bad pair lowers total cost.
 */
function greedyMaxSimAssignment(enZones, arAreas, simFn) {
  const n = enZones.length;
  const sim = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(simFn(enZones[i], arAreas[j]));
    sim.push(row);
  }
  const rowUsed = new Array(n).fill(false);
  const colUsed = new Array(n).fill(false);
  /** assign[i] = j */
  const assign = new Array(n).fill(-1);
  for (let step = 0; step < n; step++) {
    let best = -1;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (rowUsed[i]) continue;
      for (let j = 0; j < n; j++) {
        if (colUsed[j]) continue;
        const s = sim[i][j];
        if (s > best) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || bj < 0) throw new Error('greedy matching stalled');
    assign[bi] = bj;
    rowUsed[bi] = true;
    colUsed[bj] = true;
  }
  return { assign, sim };
}

/**
 * @param {string} metroKey
 * @param {string[]} enZones
 * @param {string[]} arAreas
 * @returns {{ areas: Array<{value:string,label:{en:string,ar:string}}>, stats: object }}
 */
function mergeGovernorateZones(metroKey, enZones, arAreas) {
  if (enZones.length !== arAreas.length) {
    console.error(
      `Count mismatch for ${metroKey}: EN zones=${enZones.length}, Arabic rows=${arAreas.length}`
    );
    process.exit(1);
  }

  const n = enZones.length;
  if (n === 0) {
    console.error(`No zones for ${metroKey}`);
    process.exit(1);
  }

  const { assign, sim } = greedyMaxSimAssignment(enZones, arAreas, (e, a) =>
    similarityScore(e, a, metroKey)
  );

  let sumSim = 0;
  let minSim = 1;
  let worstI = 0;
  for (let i = 0; i < n; i++) {
    const j = assign[i];
    const s = sim[i][j];
    sumSim += s;
    if (s < minSim) {
      minSim = s;
      worstI = i;
    }
  }
  const meanSim = sumSim / n;

  const minSimThreshold =
    metroKey === 'Cairo' ? 0.08 : metroKey === 'Giza' ? 0.035 : metroKey === 'Qalyubia' ? 0.05 : 0.06;
  if (minSim < minSimThreshold) {
    console.error(
      `[${metroKey}] Worst assigned pair similarity ${minSim.toFixed(4)} < ${minSimThreshold} — check data. meanSim=${meanSim.toFixed(4)}`,
      `\n  worst EN: ${enZones[worstI]}\n  worst AR: ${arAreas[assign[worstI]]}`
    );
    process.exit(1);
  }

  const areas = [];
  for (let i = 0; i < n; i++) {
    const j = assign[i];
    const value = enZones[i];
    areas.push({
      value,
      label: {
        en: value,
        ar: arAreas[j],
      },
    });
  }

  return {
    areas,
    stats: { n, meanSim, minSim },
  };
}

function main() {
  const engRows = JSON.parse(fs.readFileSync(ENG_SOURCE_PATH, 'utf8'));
  const arRows = JSON.parse(fs.readFileSync(AR_SOURCE_PATH, 'utf8'));
  if (!Array.isArray(engRows) || !Array.isArray(arRows)) {
    console.error('bosta_regionsENG.json and bosta_regionsAR.json must be arrays');
    process.exit(1);
  }

  const processed = {};

  for (const m of METRO_GOVERNORATES) {
    const enZones = engRows
      .filter((r) => r && r.governorate === m.engGov)
      .map((r) => String(r.area || '').trim())
      .filter(Boolean);
    const arAreas = arRows
      .filter((r) => r && r.governorate === m.arGov)
      .map((r) => String(r.area || '').trim())
      .filter(Boolean);

    const { areas, stats } = mergeGovernorateZones(m.key, enZones, arAreas);

    processed[m.key] = {
      value: m.key,
      label: {
        en: m.labelEn,
        ar: m.labelAr,
      },
      areas,
    };

    console.log(
      `merge-metro-bosta-ar-labels: ${m.key} OK — zones=${stats.n}, meanSim=${stats.meanSim.toFixed(4)}, minSim=${stats.minSim.toFixed(4)}`
    );
  }

  fs.writeFileSync(PROCESSED_PATH, JSON.stringify(processed, null, 2) + '\n', 'utf8');

  const cairo = processed.Cairo;
  const spot = ['15 May', 'Nasr City - ElHay 06 (Nasr City)', 'Abdeen'];
  for (const v of spot) {
    const a = cairo.areas.find((x) => x.value === v);
    if (a) console.log(`  sample Cairo ${v} -> ar: ${a.label.ar}`);
  }
  const gizaSample = processed.Giza.areas[0];
  if (gizaSample) console.log(`  sample Giza ${gizaSample.value} -> ar: ${gizaSample.label.ar}`);
  const qSample = processed.Qalyubia.areas[0];
  if (qSample) console.log(`  sample Qalyubia ${qSample.value} -> ar: ${qSample.label.ar}`);

  console.log('merge-cairo-bosta-ar-labels: wrote', PROCESSED_PATH);
}

main();
