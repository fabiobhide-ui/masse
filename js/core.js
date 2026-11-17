// MASSE – Rechenkern (plattformneutral, ohne DOM). Portiert aus Core/*.swift.
// Läuft im Browser und in Node (für die automatischen Tests).

export const SCHEMA_VERSION = 1;

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

export class FitnessError extends Error {}

// ---------- Datum ----------
export const pad = n => String(n).padStart(2, '0');
/** Lokaler Kalendertag als "YYYY-MM-DD". */
export const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const startOfDay = d => { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
/** Kalendertage addieren (sommerzeitsicher, da über Datumsteile). */
export const addDays = (d, n) => { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds()); };
export const sameDay = (a, b) => dayKey(a) === dayKey(b);
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

// ---------- Makros ----------
export const macros = (calories = 0, protein = 0, carbs = 0, fat = 0) => ({ calories, protein, carbs, fat });
const KEYS = ['calories', 'protein', 'carbs', 'fat'];
export const macrosValid = m => !!m && KEYS.every(k => Number.isFinite(m[k]) && m[k] >= 0 && m[k] <= 1_000_000);
export const addMacros = (a, b) => macros(a.calories + b.calories, a.protein + b.protein, a.carbs + b.carbs, a.fat + b.fat);
export function scaleMacros(m, factor) {
  if (!macrosValid(m) || !Number.isFinite(factor) || factor <= 0) throw new FitnessError('Portion und Nährwerte müssen gültig sein.');
  const v = macros(m.calories * factor, m.protein * factor, m.carbs * factor, m.fat * factor);
  if (!macrosValid(v)) throw new FitnessError('Die Portion ist zu groß.');
  return v;
}
export const remaining = (m, goal) => macros(
  Math.max(0, goal.calories - m.calories), Math.max(0, goal.protein - m.protein),
  Math.max(0, goal.carbs - m.carbs), Math.max(0, goal.fat - m.fat));

// ---------- Ernährung ----------
export function newFood(name, m, extra = {}) {
  return { id: uid(), name, brand: '', basisAmount: 100, unit: 'g', macros: m, barcode: null,
    favorite: false, recipe: false, ingredients: [], source: 'Manuell · eigene Etikettangaben', ...extra };
}
export function portion(food, amount) {
  if (!Number.isFinite(food.basisAmount) || food.basisAmount <= 0) throw new FitnessError('Bezugsmenge muss größer als null sein.');
  return scaleMacros(food.macros, amount / food.basisAmount);
}
/** Eintrag mit unveränderlichem Nährwert-Snapshot: spätere Katalogänderungen schreiben die Historie nicht um. */
export function newFoodEntry(food, amount, date = new Date(), meal = 'Mahlzeit') {
  if (!Number.isFinite(amount) || amount <= 0) throw new FitnessError('Die Menge muss größer als null sein.');
  portion(food, amount); // validiert
  const snapshot = structuredClone(food);
  return { id: uid(), date: new Date(date).toISOString(), food: snapshot, amount, meal };
}
export const entryTotals = e => { try { return portion(e.food, e.amount); } catch { return macros(); } };
export const nutritionTotal = (entries, date) =>
  entries.filter(e => sameDay(e.date, date)).reduce((s, e) => addMacros(s, entryTotals(e)), macros());

// ---------- Training ----------
export const LOAD_BASIS = { total: 'Gesamtgewicht', perHand: 'kg je Hand', machine: 'Maschinenanzeige', bodyweight: 'Körpergewicht' };
export const basisMultiplier = b => (b === 'perHand' ? 2 : 1);

export function exercise(name, sets, low, high, { weight = null, step = 2.5, basis = 'machine', timed = false, note = '' } = {}) {
  return { id: uid(), name, sets, low, high, seedWeight: weight, increment: step, basis, timed, note };
}
export function plan(name, weekday, hour, { minute = 0, duration = 75, flexible = false, volleyball = false, exercises = [] } = {}) {
  // weekday wie in der iOS-App: 1 = Sonntag … 7 = Samstag
  return { id: uid(), name, weekday, hour, minute, durationMinutes: duration, flexible, volleyball, exercises };
}
export const trainingSet = (weight, reps, rir = null) => ({ id: uid(), weight, reps, rir, warmup: false, completed: false, note: '' });

export function volume(workout) {
  return workout.exercises.reduce((total, item) => {
    const ex = item.exercise;
    if (ex.timed || ex.basis === 'bodyweight') return total;
    return total + item.sets.filter(s => s.completed && !s.warmup)
      .reduce((t, s) => t + (s.weight ?? 0) * s.reps * basisMultiplier(ex.basis), 0);
  }, 0);
}
export function estimated1RM(weight, reps) {
  if (!Number.isFinite(weight) || weight <= 0 || !(reps >= 1 && reps <= 12)) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}
/** Double Progression: nur wenn alle Arbeitssätze abgeschlossen, ≥ geplante Anzahl, oberes Wdh.-Ziel und gleiche Last. */
export function suggestion(previous, increment = previous.exercise.increment) {
  const ex = previous.exercise;
  const work = previous.sets.filter(s => !s.warmup);
  const weight = work[0]?.weight;
  if (ex.timed || ex.basis === 'bodyweight' || !(increment > 0) || work.length < ex.sets || !(weight > 0)) return null;
  if (!work.every(s => s.completed && s.reps >= ex.high && s.weight === weight)) return null;
  return Math.round((weight + increment) * 1000) / 1000;
}
export function previousPerformance(exerciseID, workouts) {
  return [...workouts].filter(w => w.ended).sort((a, b) => new Date(b.started) - new Date(a.started))
    .map(w => w.exercises.find(e => e.exercise.id === exerciseID)).find(Boolean) ?? null;
}
/** Neue Einheit: vorherige abgeschlossene Arbeitssätze werden vorgeschlagen (neue IDs, nicht abgehakt, keine Auto-Steigerung). */
export function beginWorkout(p, history, date = new Date()) {
  return {
    id: uid(), planID: p.id, name: p.name, started: new Date(date).toISOString(), ended: null,
    volleyball: p.volleyball, note: '',
    exercises: p.exercises.map(ex => {
      const prior = previousPerformance(ex.id, history)?.sets.filter(s => !s.warmup && s.completed) ?? [];
      const sets = Array.from({ length: ex.sets }, (_, i) => {
        const old = prior[i];
        return trainingSet(old?.weight ?? ex.seedWeight, old?.reps ?? ex.low, old?.rir ?? null);
      });
      return { exercise: structuredClone(ex), sets, note: '' };
    }),
  };
}
export const workoutDuration = (w, now = new Date()) => Math.max(0, (w.ended ? new Date(w.ended) : now) - new Date(w.started)) / 1000;

/** Bester geschätzter e1RM je Übung und Einheit (für Fortschrittskurven). */
export function best1RM(item) {
  if (item.exercise.timed || item.exercise.basis === 'bodyweight') return null;
  const vals = item.sets.filter(s => s.completed && !s.warmup)
    .map(s => estimated1RM((s.weight ?? 0) * basisMultiplier(item.exercise.basis), s.reps)).filter(v => v != null);
  return vals.length ? Math.max(...vals) : null;
}

// ---------- Gewicht ----------
/** Tagesmittel (mehrere Messungen eines Tages verzerren das 7-Tage-Mittel nicht). */
export function dailyWeights(entries) {
  const groups = new Map();
  for (const e of entries) {
    const k = dayKey(e.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e.kg);
  }
  return [...groups.entries()].map(([k, v]) => {
    const [y, m, d] = k.split('-').map(Number);
    return { date: new Date(y, m - 1, d), kg: v.reduce((a, b) => a + b, 0) / v.length };
  }).sort((a, b) => a.date - b.date);
}
export function weightMean(entries, ending, days = 7) {
  const end = startOfDay(ending), start = addDays(end, -(days - 1));
  const vals = dailyWeights(entries).filter(d => d.date >= start && d.date <= end).map(d => d.kg);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
export function weightChange(entries, at, days = 7) {
  const now = weightMean(entries, at), then = weightMean(entries, addDays(at, -days));
  return now == null || then == null ? null : now - then;
}
export const weightSeries = entries => dailyWeights(entries).map(d => ({ ...d, average: weightMean(entries, d.date) ?? d.kg }));
export function weightStalled(entries, at) {
  const today = startOfDay(at), start = addDays(today, -13), boundary = addDays(today, -7);
  if (!entries.length) return false;
  const earliest = entries.map(e => new Date(e.date)).reduce((a, b) => (a < b ? a : b));
  if (startOfDay(earliest) > start) return false;
  const window = dailyWeights(entries).filter(d => d.date >= start && d.date <= at);
  const first = window.filter(d => d.date <= boundary).map(d => d.kg);
  const second = window.filter(d => d.date > boundary).map(d => d.kg);
  if (first.length < 4 || second.length < 4) return false;
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  return avg(second) - avg(first) <= 0.05;
}
export function gainPerWeek(entries) {
  const days = dailyWeights(entries);
  if (days.length < 2) return null;
  const first = days[0], last = days[days.length - 1], count = daysBetween(first.date, last.date);
  return count >= 7 ? ((last.kg - first.kg) / count) * 7 : null;
}
export const latestWeight = entries => entries.length
  ? entries.reduce((a, b) => (new Date(a.date) >= new Date(b.date) ? a : b)) : null;

// ---------- Wochenplan ----------
export function nextOccurrence(p, after) {
  after = new Date(after);
  for (let i = 0; i <= 7; i++) {
    const d = addDays(startOfDay(after), i);
    if (d.getDay() !== p.weekday - 1) continue;
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p.hour, p.minute);
    if (t > after) return t;
  }
  return null;
}
export function nextSession(plans, after) {
  return plans.map(p => [p, nextOccurrence(p, after)]).filter(([, d]) => d)
    .sort((a, b) => a[1] - b[1])[0] ?? null;
}

// ---------- Barcode / Open Food Facts ----------
export function normalizeBarcode(raw) {
  const text = String(raw).trim();
  if (![8, 12, 13, 14].includes(text.length) || !/^\d+$/.test(text))
    throw new FitnessError('Bitte einen gültigen EAN-8-, UPC-A-, EAN-13- oder GTIN-14-Code eingeben.');
  const digits = [...text].map(Number);
  const body = digits.slice(0, -1).reverse();
  const sum = body.reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - (sum % 10)) % 10 !== digits[digits.length - 1])
    throw new FitnessError('Die Barcode-Prüfziffer stimmt nicht. Bitte erneut scannen.');
  return text.length === 12 ? '0' + text : text;
}
export function productToFood(p) {
  const n = p?.nutriments;
  if (!n) throw new FitnessError('missing');
  const num = k => (n[k] == null || n[k] === '' ? null : Number(n[k]));
  const kcal = num('energy-kcal_100g') ?? (num('energy-kj_100g') != null ? num('energy-kj_100g') / 4.184 : null);
  const protein = num('proteins_100g'), carbs = num('carbohydrates_100g'), fat = num('fat_100g');
  const name = String(p.product_name_de || p.product_name || '').trim();
  const m = macros(kcal, protein, carbs, fat);
  if ([kcal, protein, carbs, fat].some(v => v == null) || !name || !macrosValid(m)) throw new FitnessError('missing');
  const unit = String(p.product_quantity_unit || '').toLowerCase();
  let barcode = null;
  try { barcode = p.code ? normalizeBarcode(p.code) : null; } catch { /* ignorieren */ }
  return newFood(name, m, {
    unit: ['ml', 'l', 'cl'].includes(unit) ? 'ml' : 'g', brand: p.brands || '', barcode,
    source: 'Open Food Facts · ODbL · pro 100 g/ml gemäß Produkt; Etikett und Einheit prüfen',
  });
}
/** Teilweise Produktdaten (für die Vorbelegung, wenn Nährwerte fehlen). Fehlende Werte sind null. */
export function productPartial(p) {
  const n = p?.nutriments ?? {};
  const num = k => { const v = n[k] == null || n[k] === '' ? null : Number(n[k]); return Number.isFinite(v) && v >= 0 ? v : null; };
  const kj = num('energy-kj_100g');
  const unit = String(p?.product_quantity_unit || '').toLowerCase();
  return {
    name: String(p?.product_name_de || p?.product_name || '').trim(),
    brand: String(p?.brands || '').trim(),
    unit: ['ml', 'l', 'cl'].includes(unit) ? 'ml' : 'g',
    basisAmount: 100,
    macros: {
      calories: num('energy-kcal_100g') ?? (kj != null ? kj / 4.184 : null),
      protein: num('proteins_100g'), carbs: num('carbohydrates_100g'), fat: num('fat_100g'),
    },
    source: 'Open Food Facts · ODbL · unvollständig, bitte mit dem Etikett ergänzen',
  };
}
export const MISSING_PRODUCT = 'Kein Produkt mit vollständigen Nährwerten gefunden. Bitte Werte vom Etikett manuell eingeben.';

// ---------- Validierung / Backup ----------
export function validateState(s) {
  if (!s || typeof s !== 'object') throw new FitnessError('Die Datei enthält keine MASSE-Daten.');
  if (s.schemaVersion !== SCHEMA_VERSION) throw new FitnessError(`Datenversion ${s.schemaVersion} wird nicht unterstützt.`);
  for (const k of ['foods', 'foodEntries', 'weights', 'plans', 'workouts', 'supplements', 'supplementLogs', 'photos'])
    if (!Array.isArray(s[k])) throw new FitnessError(`Feld „${k}“ fehlt oder ist ungültig.`);
  if (!s.profile || !macrosValid(s.profile.goals)) throw new FitnessError('Ungültige Ziele.');
  const ids = new Set();
  for (const k of ['foods', 'foodEntries', 'weights', 'plans', 'workouts', 'supplements', 'supplementLogs', 'photos'])
    for (const item of s[k]) {
      if (!item?.id || ids.has(item.id)) throw new FitnessError('Doppelte oder fehlende IDs in der Sicherung.');
      ids.add(item.id);
    }
  for (const w of s.weights) if (!(w.kg > 0 && w.kg < 500)) throw new FitnessError('Ungültiges Körpergewicht in der Sicherung.');
  for (const f of s.foods) if (!macrosValid(f.macros) || !(f.basisAmount > 0)) throw new FitnessError(`Ungültige Nährwerte bei „${f.name}“.`);
  return s;
}

// ---------- CSV ----------
/** CSV-Feld mit Quoting und Schutz vor Formel-Injektion in Tabellenprogrammen. */
export function csvField(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csv = rows => '﻿' + rows.map(r => r.map(csvField).join(';')).join('\r\n');
