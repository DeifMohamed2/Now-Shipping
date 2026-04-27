#!/usr/bin/env node
/**
 * Merges Arabic display labels from bosta_regionsAR.json into
 * public/assets/js/bosta-regions-data-processed.json for Cairo only.
 * Keeps English `value` fields unchanged (API / validation).
 *
 * Re-run when Bosta updates either source file.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROCESSED_PATH = path.join(ROOT, 'public/assets/js/bosta-regions-data-processed.json');
const AR_SOURCE_PATH = path.join(ROOT, 'bosta_regionsAR.json');
const GOV_AR = 'القاهره';
const CAIRO_GOV_LABEL_AR = 'القاهرة';

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

/** Higher = better match. Row = English zone index, Col = Arabic area index. */
function similarityScore(enValue, arArea) {
  const enNorm = enValue.toLowerCase().trim();
  const arTr = transliterate(arArea).toLowerCase();
  const lev = levenshteinRatio(enNorm, arTr);
  const d1 = diceBigram(bigramDice(enNorm), bigramDice(arTr));
  const d2 = tokenJaccard(enNorm, arTr);
  const d3 = tokenJaccard(enNorm, arArea);
  const base = 0.5 * lev + 0.18 * d1 + 0.14 * d2 + 0.1 * d3;
  const dist = districtNumberAgreementBonus(enValue, arArea);
  const hint = regionHintAdjustment(enValue, arArea);
  return Math.max(0, Math.min(1, base + dist + hint));
}

/**
 * Min-cost assignment for square cost matrix (Hungarian / Kuhn).
 * cost[i][j] = cost of assigning row i to column j.
 * Returns array assign[i] = j.
 */
function hungarianMin(cost) {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (n !== m) throw new Error('Expected square matrix');
  const INF = 1e12;
  const a = cost.map((row) => row.map((x) => x | 0));
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (!used[j]) {
          const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] !== 0) {
      assignment[p[j] - 1] = j - 1;
    }
  }
  return assignment;
}

function main() {
  const processed = JSON.parse(fs.readFileSync(PROCESSED_PATH, 'utf8'));
  const cairo = processed.Cairo;
  if (!cairo || !Array.isArray(cairo.areas)) {
    console.error('Invalid processed JSON: missing Cairo.areas');
    process.exit(1);
  }

  const arRows = JSON.parse(fs.readFileSync(AR_SOURCE_PATH, 'utf8'));
  if (!Array.isArray(arRows)) {
    console.error('bosta_regionsAR.json must be an array');
    process.exit(1);
  }

  const cairoAr = arRows.filter((r) => r && r.governorate === GOV_AR).map((r) => r.area);
  const enZones = cairo.areas.map((a) => a.value);

  if (cairoAr.length !== enZones.length) {
    console.error(
      `Count mismatch: Cairo areas in processed=${enZones.length}, Arabic Cairo rows=${cairoAr.length}`
    );
    process.exit(1);
  }

  const n = enZones.length;
  const SCALE = 1e6;
  const cost = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      const sim = similarityScore(enZones[i], cairoAr[j]);
      row.push(Math.round(SCALE * (1 - sim)));
    }
    cost.push(row);
  }

  const assign = hungarianMin(cost);
  const usedCols = new Set();
  let totalCost = 0;
  for (let i = 0; i < n; i++) {
    const j = assign[i];
    if (j < 0 || j >= n) {
      console.error('Invalid assignment at row', i);
      process.exit(1);
    }
    if (usedCols.has(j)) {
      console.error('Duplicate column assignment — not a permutation');
      process.exit(1);
    }
    usedCols.add(j);
    totalCost += cost[i][j];
  }
  if (usedCols.size !== n) {
    console.error('Assignment incomplete');
    process.exit(1);
  }

  const meanCost = totalCost / n;
  let minSim = 1;
  let worstI = 0;
  for (let i = 0; i < n; i++) {
    const sim = similarityScore(enZones[i], cairoAr[assign[i]]);
    if (sim < minSim) {
      minSim = sim;
      worstI = i;
    }
  }
  const minSimThreshold = 0.08;
  if (minSim < minSimThreshold) {
    console.error(
      `Worst assigned pair similarity ${minSim.toFixed(4)} < ${minSimThreshold} — check cost model or data. Mean cost ratio=${(meanCost / SCALE).toFixed(4)}`,
      `\n  worst EN: ${enZones[worstI]}\n  worst AR: ${cairoAr[assign[worstI]]}`
    );
    process.exit(1);
  }

  for (let i = 0; i < n; i++) {
    const j = assign[i];
    cairo.areas[i].label = cairo.areas[i].label || {};
    cairo.areas[i].label.en = enZones[i];
    cairo.areas[i].label.ar = cairoAr[j];
  }

  cairo.label = cairo.label || {};
  cairo.label.en = cairo.label.en || 'Cairo';
  cairo.label.ar = CAIRO_GOV_LABEL_AR;

  fs.writeFileSync(PROCESSED_PATH, JSON.stringify(processed, null, 2) + '\n', 'utf8');

  const spot = ['15 May', 'Nasr City - ElHay 06 (Nasr City)', 'Abdeen'];
  console.log('merge-cairo-bosta-ar-labels: OK');
  console.log(`  zones=${n}, totalCost=${totalCost}, meanCost=${(meanCost / SCALE).toFixed(4)}`);
  for (const v of spot) {
    const a = cairo.areas.find((x) => x.value === v);
    if (a) console.log(`  ${v} -> ar: ${a.label.ar}`);
  }
}

main();
