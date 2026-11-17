// Auswertungen: Wochenrückblick, Rekorde, Deload, Muskelgruppen, Streaks, Prognose,
// Vorschläge zum Schließen der Kalorienlücke, Gerichte aus Zutaten, Plattenrechner.
// Plattformneutral (ohne DOM), in Node getestet.
import * as C from './core.js';

// ---------- Kalenderwoche (Montag–Sonntag, lokal)
export function weekStart(d) {
  const s = C.startOfDay(d);
  return C.addDays(s, -((s.getDay() + 6) % 7));
}
export const weekDays = start => Array.from({ length: 7 }, (_, i) => C.addDays(start, i));
const inRange = (date, from, to) => { const t = new Date(date); return t >= from && t < to; };

// ---------- Muskelgruppen
export const MUSCLES = ['Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Beine', 'Po & Beinbeuger', 'Waden', 'Bauch', 'Sonstiges'];
const MUSCLE_RULES = [
  [/wade/i, 'Waden'],
  [/crunch|plank|bauch|sit.?up|leg raise|beinheben/i, 'Bauch'],
  [/beinbeuger|leg curl|hip thrust|deadlift|kreuzheben|abduktor|glute|po\b/i, 'Po & Beinbeuger'],
  [/kniebeug|squat|beinpresse|beinstrecker|ausfallschritt|lunge|adduktor|bein/i, 'Beine'],
  [/trizeps|dips|french|skull|pushdown/i, 'Trizeps'],
  [/bizeps|curl/i, 'Bizeps'],
  [/seitheben|schulter|reverse butterfly|face pull|military|overhead/i, 'Schultern'],
  [/bank|brust|butterfly|fly|liegestütz|push.?up|chest/i, 'Brust'],
  [/latzug|rudern|klimmz|pull|row|rücken|lat\b/i, 'Rücken'],
];
export function guessMuscle(name) {
  for (const [re, m] of MUSCLE_RULES) if (re.test(name)) return m;
  return 'Sonstiges';
}
export const muscleOf = ex => ex.muscle || guessMuscle(ex.name);

// ---------- Rekorde (geschätztes 1RM pro Satz)
const isLoadEx = ex => !ex.timed && ex.basis !== 'bodyweight';
export function setE1RM(set, ex) {
  if (!set.completed || set.warmup || !isLoadEx(ex)) return null;
  return C.estimated1RM((set.weight ?? 0) * C.basisMultiplier(ex.basis), set.reps);
}
const finished = workouts => workouts.filter(w => w.ended);
/** Bester e1RM einer Übung in abgeschlossenen Einheiten, die vor `before` begonnen haben. */
export function bestBefore(exerciseId, workouts, before) {
  let best = 0;
  for (const w of finished(workouts)) {
    if (before && new Date(w.started) >= new Date(before)) continue;
    for (const it of w.exercises) if (it.exercise.id === exerciseId)
      for (const s of it.sets) { const e = setE1RM(s, it.exercise); if (e && e > best) best = e; }
  }
  return best;
}
/** IDs der Sätze einer Einheit, die einen neuen Rekord darstellen (erste Einheit einer Übung zählt nicht). */
export function prSetIds(workout, history) {
  const ids = new Set();
  const others = history.filter(w => w.id !== workout.id);
  for (const it of workout.exercises) {
    let best = bestBefore(it.exercise.id, others, workout.started);
    if (!(best > 0)) continue;
    for (const s of it.sets) {
      const e = setE1RM(s, it.exercise);
      if (e && e > best + 1e-9) { ids.add(s.id); best = e; }
    }
  }
  return ids;
}
export function prsInRange(workouts, from, to) {
  return finished(workouts).filter(w => inRange(w.started, from, to)).reduce((n, w) => n + prSetIds(w, workouts).size, 0);
}
/** Bestleistung je Übung: { id, name, muscle, weight, reps, e1rm, date } – sortiert nach Muskelgruppe. */
export function records(workouts) {
  const map = new Map();
  for (const w of finished(workouts)) for (const it of w.exercises) for (const s of it.sets) {
    const e = setE1RM(s, it.exercise);
    if (!e) continue;
    const cur = map.get(it.exercise.id);
    if (!cur || e > cur.e1rm) map.set(it.exercise.id, { id: it.exercise.id, name: it.exercise.name, muscle: muscleOf(it.exercise), weight: s.weight, reps: s.reps, e1rm: e, date: w.started, basis: it.exercise.basis });
  }
  return [...map.values()].sort((a, b) => MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle) || a.name.localeCompare(b.name, 'de'));
}
/** Die letzten n abgeschlossenen Durchgänge einer Übung (neueste zuerst). */
export function exerciseHistory(exerciseId, workouts, n = 5) {
  return finished(workouts).sort((a, b) => new Date(b.started) - new Date(a.started))
    .map(w => ({ date: w.started, item: w.exercises.find(e => e.exercise.id === exerciseId) }))
    .filter(x => x.item && x.item.sets.some(s => s.completed)).slice(0, n);
}

// ---------- Deload-Hinweis
/** Stagnation: ≥4 Einheiten über ≥3 Wochen, und die letzten 3 schlagen den früheren Bestwert nicht. */
export function deloadCheck(workouts, now = new Date(), windowDays = 42) {
  const from = C.addDays(C.startOfDay(now), -windowDays);
  const sessions = new Map();
  for (const w of finished(workouts)) {
    if (new Date(w.started) < from || w.volleyball) continue;
    for (const it of w.exercises) {
      const best = Math.max(0, ...it.sets.map(s => setE1RM(s, it.exercise) ?? 0));
      if (!best) continue;
      if (!sessions.has(it.exercise.id)) sessions.set(it.exercise.id, { name: it.exercise.name, list: [] });
      sessions.get(it.exercise.id).list.push({ date: new Date(w.started), best });
    }
  }
  let total = 0; const stagnant = [];
  for (const { name, list } of sessions.values()) {
    list.sort((a, b) => a.date - b.date);
    if (list.length < 4 || C.daysBetween(list[0].date, list[list.length - 1].date) < 21) continue;
    total++;
    const earlier = Math.max(...list.slice(0, -3).map(x => x.best));
    const recent = Math.max(...list.slice(-3).map(x => x.best));
    if (recent <= earlier + 1e-9) stagnant.push(name);
  }
  return { total, stagnant, suggested: total >= 3 && stagnant.length / total >= 0.5 };
}

// ---------- Muskelgruppen pro Woche
/** Abgeschlossene Arbeitssätze je Muskelgruppe im Zeitraum (inkl. laufender Einheit, falls übergeben). */
export function muscleSets(workouts, from, to, active = null) {
  const out = Object.fromEntries(MUSCLES.map(m => [m, 0]));
  const list = finished(workouts).concat(active ? [active] : []);
  for (const w of list) {
    if (w.volleyball || !inRange(w.started, from, to)) continue;
    for (const it of w.exercises) out[muscleOf(it.exercise)] += it.sets.filter(s => s.completed && !s.warmup).length;
  }
  return out;
}

// ---------- Streaks
/** Aufeinanderfolgende Tage, an denen dayOk(tag) gilt – endet heute (falls erfüllt) oder gestern. */
export function streak(dayOk, today = new Date()) {
  let d = C.startOfDay(today), n = 0;
  if (!dayOk(d)) d = C.addDays(d, -1);
  while (n < 3650 && dayOk(d)) { n++; d = C.addDays(d, -1); }
  return n;
}

// ---------- Gewichtstrend & Zielprognose
/** Lineare Regression über die Tagesmittel der letzten `days` Tage → kg pro Woche. */
export function weightTrend(entries, now = new Date(), days = 28) {
  const end = C.startOfDay(now), start = C.addDays(end, -(days - 1));
  const pts = C.dailyWeights(entries).filter(d => d.date >= start && d.date <= end);
  if (pts.length < 4 || C.daysBetween(pts[0].date, pts[pts.length - 1].date) < 7) return null;
  const xs = pts.map(p => C.daysBetween(start, p.date)), ys = pts.map(p => p.kg);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den ? (num / den) * 7 : null;
}
export function forecast(entries, goalKG, now = new Date()) {
  const rate = weightTrend(entries, now);
  const current = C.weightMean(entries, now);
  if (rate == null || current == null) return null;
  const left = goalKG - current;
  if (left <= 0) return { rate, current, reached: true };
  if (rate < 0.02) return { rate, current, reachable: false };
  const weeks = left / rate;
  return { rate, current, reachable: true, weeks, date: C.addDays(C.startOfDay(now), Math.round(weeks * 7)) };
}

// ---------- Wochenrückblick
export function weeklyReview(state, start) {
  const end = C.addDays(start, 7);
  const days = weekDays(start).map(d => C.nutritionTotal(state.foodEntries, d));
  const logged = days.filter(m => m.calories > 0);
  const avg = k => (logged.length ? logged.reduce((s, m) => s + m[k], 0) / logged.length : null);
  const g = state.profile.goals;
  const ws = finished(state.workouts).filter(w => inRange(w.started, start, end));
  const lastDay = C.addDays(start, 6);
  const now = C.weightMean(state.weights, lastDay), before = C.weightMean(state.weights, C.addDays(start, -1));
  return {
    start, end, loggedDays: logged.length,
    avgCalories: avg('calories'), avgProtein: avg('protein'),
    calorieDays: logged.filter(m => m.calories >= g.calories * 0.95).length,
    proteinDays: logged.filter(m => m.protein >= g.protein).length,
    gym: ws.filter(w => !w.volleyball).length, volleyball: ws.filter(w => w.volleyball).length,
    plannedGym: state.plans.filter(p => !p.volleyball).length, plannedVolleyball: state.plans.filter(p => p.volleyball).length,
    volume: ws.reduce((s, w) => s + C.volume(w), 0),
    prs: prsInRange(state.workouts, start, end),
    weight: now, weightChange: now != null && before != null ? now - before : null,
  };
}

// ---------- Kalorienlücke schließen
/**
 * Kombinationen aus 1–2 Lebensmitteln (je in üblicher Portion, Portionen ggf. doppelt),
 * die die verbleibenden Kalorien möglichst treffen und viel vom fehlenden Protein liefern.
 * candidates: [{ food, amount }]
 */
export function suggestFill(remaining, candidates, max = 3) {
  if (!(remaining.calories >= 150)) return [];
  const opts = [];
  const items = candidates.map(c => { try { return { ...c, m: C.portion(c.food, c.amount) }; } catch { return null; } }).filter(x => x && x.m.calories > 0);
  const add = list => {
    const m = list.reduce((s, x) => C.addMacros(s, x.m), C.macros());
    if (m.calories > remaining.calories * 1.1 + 60) return;
    const kcalFit = 1 - Math.abs(remaining.calories - m.calories) / remaining.calories;
    const protFit = remaining.protein > 0 ? Math.min(1, m.protein / remaining.protein) : 1;
    opts.push({ items: list.map(x => ({ food: x.food, amount: x.amount })), macros: m, score: kcalFit * 0.6 + protFit * 0.4 - (list.length - 1) * 0.03 });
  };
  for (let i = 0; i < items.length; i++) {
    add([items[i]]);
    if (!['g', 'ml'].includes(items[i].food.unit)) add([{ ...items[i], amount: items[i].amount * 2, m: C.scaleMacros(items[i].m, 2) }]);
    for (let j = i + 1; j < items.length; j++) add([items[i], items[j]]);
  }
  opts.sort((a, b) => b.score - a.score);
  const seen = new Set(), out = [];
  for (const o of opts) {
    const key = o.items.map(x => x.food.id).sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key); out.push(o);
    if (out.length >= max) break;
  }
  return out;
}

// ---------- Gerichte aus Zutaten
/** components: [{ food, amount }] → Nährwerte je Portion */
export function dishMacros(components, portions = 1) {
  if (!components.length) throw new C.FitnessError('Bitte mindestens eine Zutat hinzufügen.');
  if (!(portions > 0)) throw new C.FitnessError('Die Anzahl der Portionen muss größer als null sein.');
  const total = components.reduce((s, c) => C.addMacros(s, C.portion(c.food, c.amount)), C.macros());
  return C.scaleMacros(total, 1 / portions);
}

// ---------- Plattenrechner
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
export function plates(total, bar = 20, available = DEFAULT_PLATES) {
  if (!(total > 0) || !(bar >= 0)) throw new C.FitnessError('Bitte ein gültiges Gewicht eingeben.');
  if (total < bar) throw new C.FitnessError(`Das Gewicht ist kleiner als die Stange (${bar} kg).`);
  let side = Math.round(((total - bar) / 2) * 1000) / 1000;
  const perSide = side, list = [];
  for (const p of [...available].sort((a, b) => b - a)) while (side >= p - 1e-9) { list.push(p); side = Math.round((side - p) * 1000) / 1000; }
  return { perSide, plates: list, rest: side };
}
