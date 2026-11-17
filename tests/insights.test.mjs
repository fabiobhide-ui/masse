import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/core.js';
import * as I from '../js/insights.js';
import { seedState } from '../js/seed.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const day = (y, m, d, h = 18) => new Date(y, m - 1, d, h);
const done = (w, r, o = {}) => ({ ...C.trainingSet(w, r), completed: true, ...o });
function workout(date, items, extra = {}) {
  return { id: C.uid(), planID: 'p', name: 'Test', started: date.toISOString(), ended: C.addDays(date, 0).toISOString(), volleyball: false, note: '', exercises: items, ...extra };
}
const bench = C.exercise('Bankdrücken', 3, 8, 10, { weight: 60, basis: 'total' });

test('Woche beginnt montags', () => {
  const ws = I.weekStart(new Date(2026, 10, 19, 15)); // Donnerstag
  assert.equal(ws.getDay(), 1); assert.equal(ws.getDate(), 16);
  assert.equal(I.weekStart(new Date(2026, 10, 22, 23)).getDate(), 16); // Sonntag
  assert.equal(I.weekStart(new Date(2026, 10, 23, 0, 30)).getDate(), 23); // Montag
});

test('Muskelgruppen: alle Startübungen werden sinnvoll zugeordnet', () => {
  const map = Object.fromEntries(seedState().plans.flatMap(p => p.exercises).map(e => [e.name, I.guessMuscle(e.name)]));
  assert.equal(map['Schrägbankdrücken KH'], 'Brust');
  assert.equal(map['Latzug'], 'Rücken');
  assert.equal(map['Seitheben Maschine'], 'Schultern');
  assert.equal(map['Reverse Butterfly'], 'Schultern');
  assert.equal(map['Butterfly'], 'Brust');
  assert.equal(map['Hammer Curls'], 'Bizeps');
  assert.equal(map['Trizepsdrücken'], 'Trizeps');
  assert.equal(map['Kniebeugen'], 'Beine');
  assert.equal(map['Beinstrecker'], 'Beine');
  assert.equal(map['Beinbeuger sitzend'], 'Po & Beinbeuger');
  assert.equal(map['Romanian Deadlift KH'], 'Po & Beinbeuger');
  assert.equal(map['Wadenheben sitzend'], 'Waden');
  assert.equal(map['Plank'], 'Bauch');
  assert.ok(!Object.values(map).includes('Sonstiges'), JSON.stringify(map));
  assert.equal(I.guessMuscle('Klimmzüge'), 'Rücken');
});

test('Rekorde: erste Einheit zählt nicht, danach nur echte Verbesserungen', () => {
  const w1 = workout(day(2026, 11, 2), [{ exercise: bench, sets: [done(60, 8), done(60, 8)], note: '' }]);
  assert.equal(I.prSetIds(w1, [w1]).size, 0);
  const s1 = done(60, 9), s2 = done(60, 9), s3 = done(62.5, 8, { warmup: true });
  const w2 = workout(day(2026, 11, 5), [{ exercise: bench, sets: [s1, s2, s3], note: '' }]);
  const ids = I.prSetIds(w2, [w1, w2]);
  assert.deepEqual([...ids], [s1.id], 'nur der erste bessere Satz, Aufwärmsatz nie');
  assert.equal(I.prsInRange([w1, w2], day(2026, 11, 1, 0), day(2026, 11, 8, 0)), 1);
  const rec = I.records([w1, w2]);
  assert.equal(rec.length, 1); assert.equal(rec[0].reps, 9); close(rec[0].e1rm, 60 * (1 + 9 / 30));
  assert.equal(I.exerciseHistory(bench.id, [w1, w2])[0].date, w2.started);
});

test('Deload: Stagnation über drei Wochen wird erkannt', () => {
  const exs = ['A', 'B', 'C'].map(n => C.exercise('Übung ' + n, 3, 8, 10, { basis: 'total' }));
  const mk = (i, w) => workout(day(2026, 10, 1 + i * 7), exs.map(e => ({ exercise: e, sets: [done(w, 8)], note: '' })));
  const flat = [mk(0, 50), mk(1, 52.5), mk(2, 52.5), mk(3, 52.5), mk(4, 50)];
  const r = I.deloadCheck(flat, day(2026, 11, 2));
  assert.equal(r.total, 3); assert.equal(r.stagnant.length, 3); assert.equal(r.suggested, true);
  const rising = [mk(0, 50), mk(1, 52.5), mk(2, 55), mk(3, 57.5), mk(4, 60)];
  assert.equal(I.deloadCheck(rising, day(2026, 11, 2)).suggested, false);
  assert.equal(I.deloadCheck(flat.slice(0, 3), day(2026, 11, 2)).total, 0, 'zu wenig Daten');
});

test('Sätze je Muskelgruppe (ohne Aufwärmen, ohne Volleyball)', () => {
  const row = C.exercise('Rudern Maschine', 3, 8, 12);
  const w = workout(day(2026, 11, 17), [
    { exercise: bench, sets: [done(60, 8), done(60, 8), done(40, 10, { warmup: true }), C.trainingSet(60, 8)], note: '' },
    { exercise: { ...row, muscle: 'Rücken' }, sets: [done(50, 10)], note: '' },
  ]);
  const vb = workout(day(2026, 11, 17), [{ exercise: bench, sets: [done(1, 1)], note: '' }], { volleyball: true });
  const m = I.muscleSets([w, vb], day(2026, 11, 16, 0), day(2026, 11, 23, 0));
  assert.equal(m['Brust'], 2); assert.equal(m['Rücken'], 1);
});

test('Streak endet heute oder gestern', () => {
  const ok = new Set(['2026-11-14', '2026-11-15', '2026-11-16']);
  const f = d => ok.has(C.dayKey(d));
  assert.equal(I.streak(f, day(2026, 11, 17)), 3, 'heute noch offen → zählt bis gestern');
  ok.add('2026-11-17');
  assert.equal(I.streak(f, day(2026, 11, 17)), 4);
  assert.equal(I.streak(() => false, day(2026, 11, 17)), 0);
});

test('Gewichtstrend und Zielprognose', () => {
  const now = day(2026, 11, 28, 9);
  const entries = Array.from({ length: 28 }, (_, i) => ({ id: String(i), date: C.addDays(now, -27 + i).toISOString(), kg: 63 + i * (0.25 / 7) }));
  close(I.weightTrend(entries, now), 0.25, 1e-6);
  const f = I.forecast(entries, 70, now);
  assert.equal(f.reachable, true);
  assert.ok(f.weeks > 24 && f.weeks < 26, String(f.weeks));
  const flat = entries.map(e => ({ ...e, kg: 64 }));
  assert.equal(I.forecast(flat, 70, now).reachable, false);
  assert.equal(I.forecast(entries, 60, now).reached, true);
  assert.equal(I.weightTrend(entries.slice(0, 3), now), null);
});

test('Wochenrückblick', () => {
  const s = seedState();
  const shake = s.foods[0];
  s.foodEntries = [C.newFoodEntry(shake, 5, day(2026, 11, 16, 9)), C.newFoodEntry(shake, 2, day(2026, 11, 17, 9))];
  s.workouts = [workout(day(2026, 11, 17), [{ exercise: bench, sets: [done(60, 8)], note: '' }])];
  const r = I.weeklyReview(s, day(2026, 11, 16, 0));
  assert.equal(r.loggedDays, 2); close(r.avgCalories, 684 * 3.5);
  assert.equal(r.proteinDays, 1); assert.equal(r.calorieDays, 1);
  assert.equal(r.gym, 1); assert.equal(r.plannedGym, 4); assert.equal(r.plannedVolleyball, 3);
  assert.equal(r.weightChange, null);
});

test('Kalorienlücke: passende Vorschläge, nichts bei kleiner Lücke', () => {
  const shake = C.newFood('Shake', C.macros(684, 39, 77, 26), { basisAmount: 1, unit: 'Portion' });
  const nuts = C.newFood('Nüsse', C.macros(600, 20, 10, 50));
  const quark = C.newFood('Quark', C.macros(67, 12, 4, 0.2));
  const cands = [{ food: shake, amount: 1 }, { food: nuts, amount: 50 }, { food: quark, amount: 250 }];
  const s = I.suggestFill(C.macros(900, 50, 100, 20), cands);
  assert.ok(s.length >= 1 && s.length <= 3);
  for (const o of s) assert.ok(o.macros.calories <= 900 * 1.1 + 60);
  assert.ok(s[0].macros.calories > 600, 'beste Option füllt die Lücke weitgehend');
  assert.deepEqual(I.suggestFill(C.macros(100, 5, 5, 5), cands), []);
});

test('Gericht aus Zutaten: Nährwerte je Portion', () => {
  const rice = C.newFood('Reis', C.macros(350, 7, 77, 1));
  const chicken = C.newFood('Hähnchen', C.macros(110, 23, 0, 2));
  const m = I.dishMacros([{ food: rice, amount: 200 }, { food: chicken, amount: 300 }], 2);
  close(m.calories, (700 + 330) / 2); close(m.protein, (14 + 69) / 2);
  assert.throws(() => I.dishMacros([], 1));
  assert.throws(() => I.dishMacros([{ food: rice, amount: 100 }], 0));
});

test('Plattenrechner', () => {
  const r = I.plates(100);
  assert.equal(r.perSide, 40); assert.deepEqual(r.plates, [25, 15]); assert.equal(r.rest, 0);
  assert.deepEqual(I.plates(62.5).plates, [20, 1.25]);
  assert.deepEqual(I.plates(20).plates, []);
  assert.equal(I.plates(21).rest, 0.5);
  assert.throws(() => I.plates(15), /kleiner als die Stange/);
});
