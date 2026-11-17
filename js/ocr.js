// Nährwerte per Texterkennung (OCR) aus Fotos von Etiketten oder Screenshots – ohne KI, offline, auf dem Gerät.
import { FitnessError } from './core.js';

/** Deutsche/englische Zahl aus OCR-Text: „1.580“ → 1580, „7,0“ → 7, „<0,5“ → 0,5, „7.5“ → 7,5. */
export function parseNumber(raw) {
  let s = String(raw ?? '').trim().replace(/^[<>~≈]\s*/, '').replace(/[oO](?=[\d,.])|(?<=[\d,.])[oO]/g, '0');
  if (!/\d/.test(s)) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

const NUM = String.raw`[<>~]?\s*\d[\d.,oO]*`;
const LABELS = {
  fat: { re: /\b(fett|fat|lipide|matières grasses)\b/i, not: /(davon|gesätt|gesatt|saturat|fettsäur|fettsaur|ungesätt|trans)/i },
  carbs: { re: /(kohlen\s*-?\s*hydrat|kohlehydrat|carbohydrate|carbs|\bkh\b|glucides)/i, not: /(davon|zucker|sugar|mehrwertig|polyol|stärke)/i },
  protein: { re: /(eiwei|eiwel|elwei|protein|prote[il]n|eiweiss)/i, not: /(pulver|riegel)/i },
};

// Liefert den ersten Zahlen-Token nach dem Label samt möglicher Korrekturen typischer OCR-Fehler
// („7,0 g“ wird oft als „7,09“ gelesen, „10 g“ als „109g“).
function numberCandidates(line, re) {
  const m = line.match(re);
  const rest = m ? line.slice(m.index + m[0].length) : line;
  const n = rest.match(new RegExp(NUM));
  if (!n) return null;
  const tok = n[0].replace(/\s+/g, '');
  const after = rest.slice(n.index + n[0].length);
  const value = parseNumber(tok);
  if (!Number.isFinite(value)) return null;
  if (/^\d+,\d9$/.test(tok) && !/^\s*g\b/i.test(after)) return { value: parseNumber(tok.slice(0, -1)), alt: value, fixed: true };
  if (/^\d*\d9$/.test(tok) && /^g\b/i.test(after)) return { value, alt: parseNumber(tok.slice(0, -1)), fixed: false };
  return { value };
}

/** Liest Brennwert und Makros aus erkanntem Text. Fehlende Werte bleiben null. */
export function parseNutritionText(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join('\n');
  const out = { calories: null, protein: null, carbs: null, fat: null };
  const found = {};

  // Energie: bevorzugt kcal, sonst kJ umrechnen
  const energyLines = lines.filter(l => /(brennwert|energie|energy|kalorien|calories|kcal|kj)/i.test(l));
  for (const l of energyLines.length ? energyLines : lines) {
    const k = l.match(new RegExp(`(${NUM})\\s*k\\s*ca[l1i]`, 'i'));
    if (k) { out.calories = parseNumber(k[1]); found.calories = 'kcal'; break; }
  }
  if (out.calories == null) {
    const k = all.match(new RegExp(`(?:kalorien|calories|energie|energy|brennwert)[^\\d\\n]{0,20}(${NUM})(?!\\s*k\\s*j)`, 'i'));
    if (k && !/k\s*j/i.test(all.slice(k.index, k.index + k[0].length + 6))) { out.calories = parseNumber(k[1]); found.calories = 'kcal'; }
  }
  if (out.calories == null) {
    const j = all.match(new RegExp(`(${NUM})\\s*k\\s*j`, 'i'));
    if (j) { out.calories = parseNumber(j[1]) / 4.184; found.calories = 'kJ'; }
  }

  const cand = {};
  for (const [key, { re, not }] of Object.entries(LABELS)) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!re.test(l) || not.test(l)) continue;
      // Wert steht manchmal in der nächsten Zeile (Tabellen)
      const c = numberCandidates(l, re) ?? (lines[i + 1] && /^\s*[<>~]?\s*\d/.test(lines[i + 1]) ? numberCandidates(lines[i + 1], /^/) : null);
      if (c) { cand[key] = c; out[key] = c.value; found[key] = true; break; }
    }
  }
  // Zweifelsfälle mit den Kalorien abgleichen (4/4/9 kcal je g)
  let corrected = Object.values(cand).some(c => c.fixed);
  const keys = Object.keys(cand).filter(k => cand[k].alt != null);
  if (out.calories > 20 && keys.length && ['protein', 'carbs', 'fat'].every(k => out[k] != null)) {
    const err = o => Math.abs(o.protein * 4 + o.carbs * 4 + o.fat * 9 - out.calories);
    let best = { ...out }, bestErr = err(out);
    for (let mask = 1; mask < 1 << keys.length; mask++) {
      const o = { ...out };
      keys.forEach((k, b) => { if (mask & (1 << b)) o[k] = cand[k].alt; });
      if (err(o) < bestErr - out.calories * 0.1) { best = o; bestErr = err(o); }
    }
    if (best !== out) { Object.assign(out, best); corrected = true; }
  }

  // Bezugsgröße
  const basis = /(?<!\/\s*)\b100\s*m\s*l\b/i.test(all) ? { amount: 100, unit: 'ml' }
    : /(?<!\/\s*)\b100\s*g\b/i.test(all) ? { amount: 100, unit: 'g' }
    : /(portion|serving|stück|stuck)/i.test(all) || /\d\s*g?\s*\/\s*\d/.test(all) ? { amount: 1, unit: 'Portion' } // „98 / 130 g“ = Tagessumme einer App
    : { amount: 100, unit: 'g', guessed: true };

  for (const k of Object.keys(out)) if (out[k] != null && !(out[k] >= 0 && out[k] < (k === 'calories' ? 10000 : 1000))) { out[k] = null; delete found[k]; }

  const warnings = [];
  const have = ['protein', 'carbs', 'fat'].filter(k => out[k] != null);
  if (out.calories == null && have.length === 3) {
    out.calories = out.protein * 4 + out.carbs * 4 + out.fat * 9; found.calories = 'berechnet';
    warnings.push('Kalorien nicht gefunden – aus den Makros berechnet.');
  } else if (out.calories != null && have.length === 3) {
    const calc = out.protein * 4 + out.carbs * 4 + out.fat * 9;
    if (out.calories > 20 && Math.abs(calc - out.calories) / out.calories > 0.25) warnings.push('Kalorien und Makros passen nicht ganz zusammen – bitte mit dem Bild vergleichen.');
  }
  if (corrected) warnings.push('Einzelne Zahlen wurden korrigiert (z. B. „7,09“ → „7,0 g“) – bitte kurz prüfen.');
  if (basis.guessed) warnings.push('Keine Bezugsgröße erkannt – „100 g“ angenommen.');
  const missing = Object.keys(out).filter(k => out[k] == null);
  // Produktname: erste Textzeile, die weder Zahl noch Tabellenbegriff ist (v. a. bei Screenshots)
  const skip = /(nährwert|nahrwert|nutrition|durchschnitt|heute|gegessen|energie|brennwert|kalorien|fett|kohlen|eiwei|protein|zucker|salz|ballast|portion|pro |je |per |tagebuch|übersicht|frühstück|mittag|abend|snack)/i;
  const name = lines.find(l => /^[\p{L}][\p{L}\s'’&.-]{2,40}$/u.test(l) && !skip.test(l)) ?? '';
  return { name, macros: out, basis, found, missing, warnings, text: lines.join('\n') };
}

const NAMES = { calories: 'Kalorien', protein: 'Protein', carbs: 'Kohlenhydrate', fat: 'Fett' };
export function summary(r) {
  const ok = Object.keys(NAMES).filter(k => r.macros[k] != null).map(k => NAMES[k]);
  const miss = r.missing.map(k => NAMES[k]);
  return `${ok.length ? `Erkannt: ${ok.join(', ')}` : 'Keine Nährwerte erkannt'}${miss.length ? ` · fehlt: ${miss.join(', ')}` : ''}.`;
}

let workerPromise = null;
function vendorUrl(p) { return new URL(`../vendor/ocr/${p}`, import.meta.url).href; }
async function getWorker(onProgress) {
  workerPromise ??= (async () => {
    const { default: Tesseract } = await import('../vendor/ocr/tesseract.esm.min.js');
    return Tesseract.createWorker('deu', Tesseract.OEM.LSTM_ONLY, {
      workerPath: vendorUrl('worker.min.js'), corePath: vendorUrl(''), langPath: vendorUrl(''),
      workerBlobURL: false, gzip: true, logger: m => progressSink?.(m),
    });
  })().catch(e => { workerPromise = null; throw e; });
  progressSink = onProgress;
  return workerPromise;
}
let progressSink = null;

/** Erkennt Text auf dem Bild (Data-URL oder Blob) und liest die Nährwerte aus. */
export async function readNutrition(image, onProgress = () => {}) {
  let worker;
  try { worker = await getWorker(m => {
    const label = m.status?.includes('recogniz') ? 'Text wird erkannt' : 'Texterkennung wird geladen (nur beim ersten Mal)';
    onProgress(label, m.progress ?? 0);
  }); } catch (e) { throw new FitnessError('Die Texterkennung konnte nicht geladen werden. Beim ersten Mal ist eine Internetverbindung nötig.'); }
  const { data } = await worker.recognize(image);
  const r = parseNutritionText(data.text);
  if (Object.values(r.macros).every(v => v == null)) throw new FitnessError('Auf dem Bild wurden keine Nährwerte gefunden. Fotografiere die Nährwerttabelle gerade, scharf und ohne Spiegelung – oder nutze einen Screenshot.');
  return r;
}
