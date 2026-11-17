// Startdaten – übernommen aus Core/Seed.swift (deine Vorgaben, keine gemessenen Bestleistungen).
import { SCHEMA_VERSION, macros, newFood, plan, exercise as ex, uid } from './core.js';
import { guessMuscle } from './insights.js';

export function defaultProfile() {
  return {
    heightCM: 185, startKG: 63, goalKG: 70,
    goals: macros(3400, 130, 495, 100),
    gymPerWeek: 4, volleyballPerWeek: 3, trainingGoal: 'Muskel- und Masseaufbau',
    onlineFoodEnabled: false, restSeconds: 120,
    barWeight: 20, theme: 'auto', backupDays: 7,
  };
}

const supp = (name, dose, note = '') => ({ id: uid(), name, dose, note, paused: false });

export function seedState() {
  const state = buildSeed();
  for (const p of state.plans) for (const e of p.exercises) { e.muscle = guessMuscle(e.name); e.supersetNext = false; }
  return state;
}

function buildSeed() {
  const shake = newFood('Masseshake', macros(684, 39, 77, 26), {
    basisAmount: 1, unit: 'Portion', favorite: true, recipe: true,
    source: 'Deine Vorgabe · Richtwerte für das gesamte Rezept, bitte Etiketten prüfen',
    ingredients: [
      { id: uid(), name: 'Vollmilch', amount: 300, unit: 'ml' },
      { id: uid(), name: 'Haferflocken', amount: 50, unit: 'g' },
      { id: uid(), name: 'Banane', amount: 120, unit: 'g' },
      { id: uid(), name: 'Erdnussmus', amount: 20, unit: 'g' },
      { id: uid(), name: 'Whey', amount: 20, unit: 'g' },
    ],
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: defaultProfile(),
    foods: [shake],
    foodEntries: [],
    weights: [],
    measurements: [],
    plans: [
      plan('Volleyball', 2, 19, { duration: 120, volleyball: true }),
      plan('Oberkörper A', 3, 16, { minute: 45, exercises: [
        ex('Schrägbankdrücken KH', 3, 8, 10, { weight: 17.5, step: 2, basis: 'perHand' }),
        ex('Latzug', 3, 8, 12, { weight: 45 }),
        ex('Brustpresse', 3, 8, 12, { weight: 32 }),
        ex('Rudern einarmig', 3, 8, 12, { weight: 40, note: 'Pro Seite; Volumen je protokollierter Seite. Gleiche Ausführung beibehalten.' }),
        ex('Seitheben Maschine', 3, 10, 15, { weight: 32 }),
        ex('Hammer Curls', 2, 10, 12, { step: 2, basis: 'perHand' }),
        ex('Trizepsdrücken', 2, 10, 12, { weight: 45, note: 'Unverbindlicher Startwert: ca. 45 kg' }),
      ] }),
      plan('Volleyball', 4, 18, { duration: 120, volleyball: true }),
      plan('Unterkörper A', 5, 16, { minute: 45, exercises: [
        ex('Kniebeugen', 3, 8, 10, { basis: 'total', note: 'Bisher 20 kg je Seite; Stangengewicht unbekannt. Gesamtgewicht einschließlich Stange selbst eintragen.' }),
        ex('Beinbeuger sitzend', 3, 10, 12),
        ex('Beinstrecker', 2, 10, 15),
        ex('Hip Thrust', 2, 8, 12, { basis: 'total' }),
        ex('Wadenheben', 3, 12, 15, { basis: 'total', note: 'Bisher 20 kg je Seite; Gesamtlast einschließlich Gerät/Stange prüfen.' }),
        ex('Cable Crunch', 3, 12, 15),
      ] }),
      plan('Oberkörper B', 6, 14, { exercises: [
        ex('Rudern Maschine', 3, 8, 12),
        ex('Butterfly', 3, 10, 12, { weight: 52 }),
        ex('Schulterdrücken Maschine', 3, 8, 12, { weight: 55 }),
        ex('Latzug neutral', 2, 10, 12, { weight: 40, note: 'Bisher ca. 40–45 kg' }),
        ex('Reverse Butterfly', 2, 12, 15),
        ex('Bizepscurl Maschine', 3, 10, 12, { weight: 45 }),
        ex('Trizepsdrücken', 2, 10, 15),
      ] }),
      plan('Volleyball', 6, 18, { duration: 120, volleyball: true }),
      plan('Unterkörper B', 7, 11, { flexible: true, exercises: [
        ex('Beinpresse', 3, 10, 12),
        ex('Romanian Deadlift KH', 3, 8, 10, { step: 2, basis: 'perHand' }),
        ex('Beinbeuger liegend', 2, 10, 15),
        ex('Abduktoren', 2, 12, 15, { weight: 48 }),
        ex('Adduktoren', 2, 12, 15, { weight: 60 }),
        ex('Wadenheben sitzend', 2, 12, 15),
        ex('Plank', 3, 45, 60, { weight: 0, basis: 'bodyweight', timed: true }),
      ] }),
    ],
    workouts: [],
    activeWorkout: null,
    supplements: [
      supp('Kreatin-Monohydrat', '3–5 g täglich'),
      supp('Whey', '20–30 g nach Bedarf'),
      supp('Elektrolyte', 'Nach Produktangabe', 'Bei starkem Schwitzen'),
      supp('Kohlenhydratpulver', 'Nach Bedarf', 'Bei längerer Belastung'),
      supp('Vitamin D3', 'Nur bei entsprechendem Bedarf', 'Dosierung individuell medizinisch abklären'),
      supp('Omega-3', 'Nach individuellem Bedarf', 'Bei geringer Fischzufuhr'),
      supp('Beta-Alanin', 'Optional', 'Nach individueller Abklärung'),
    ],
    supplementLogs: [],
    photos: [], // nur Metadaten; Bilddaten liegen separat in IndexedDB
    templates: [], // Mahlzeiten-Vorlagen
    lastBackup: null,
  };
}
