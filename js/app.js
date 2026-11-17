// MASSE Web-App – Oberfläche. Alle Daten bleiben lokal auf dem Gerät.
import * as C from './core.js';
import { seedState } from './seed.js';
import * as DB from './db.js';
import { lineChart, barChart, donut } from './charts.js';
import { startScanner } from './scanner.js';

// ---------------------------------------------------------------- Hilfen
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const numFlex = (v, max = 2) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: max });
const kg = v => (v == null ? '—' : num(v, 1) + ' kg');
const signedKg = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + num(Math.abs(v), 1) + ' kg');
const parseNum = s => { s = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'); return s === '' ? NaN : Number(s); };
const inVal = v => (v == null || Number.isNaN(v) ? '' : String(v).replace('.', ','));
const dtLocal = d => { d = new Date(d); return `${C.dayKey(d)}T${C.pad(d.getHours())}:${C.pad(d.getMinutes())}`; };
const parseDt = s => { const d = new Date(s); if (Number.isNaN(+d)) throw new C.FitnessError('Bitte ein gültiges Datum eingeben.'); return d; };
const time = d => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateShort = d => new Date(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
const dateLong = d => new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const dateTime = d => new Date(d).toLocaleString('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const weekdayName = w => WEEKDAYS[w - 1];
const mondayOrder = w => (w + 5) % 7; // Montag zuerst
const hhmm = (h, m) => `${C.pad(h)}:${C.pad(m)}`;
const duration = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}:${C.pad(m)}:${C.pad(sec)}` : `${m}:${C.pad(sec)}`; };
const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snack'];
const defaultMeal = (d = new Date()) => { const h = new Date(d).getHours(); return h < 11 ? 'Frühstück' : h < 15 ? 'Mittagessen' : h < 18 ? 'Snack' : 'Abendessen'; };
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// ---------------------------------------------------------------- Zustand
let S = null;               // persistente Daten
let loadError = null;
const ui = {
  tab: lsGet('masse.tab') || 'home',
  foodDay: new Date(),
  range: Number(lsGet('masse.range')) || 30,
  e1rmEx: null,
  rest: null,               // { end, total }
  sheets: [],
  compare: null,            // null oder Array von Foto-IDs
  lastOnline: { product: 0, search: 0 },
};

/** Änderung: Kopie → ändern → prüfen → speichern → erst dann übernehmen. */
async function commit(fn, { render: doRender = true } = {}) {
  if (loadError) throw new C.FitnessError('Die Daten konnten nicht gelesen werden. Bitte zuerst eine Sicherung importieren.');
  const next = structuredClone(S);
  const result = fn(next);
  C.validateState(next);
  try { await DB.saveState(next, S); } catch (e) {
    throw new C.FitnessError('Speichern fehlgeschlagen – die Änderung wurde nicht übernommen. ' + (e?.message ?? ''));
  }
  S = next;
  if (doRender) render();
  return result;
}

// ---------------------------------------------------------------- Rückmeldungen
let toastTimer;
function toast(text, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>` + (action ? `<button type="button" id="toast-act">${esc(action.label)}</button>` : '');
  el.classList.add('show');
  if (action) $('#toast-act').onclick = () => { el.classList.remove('show'); run(action.fn); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2600);
}
async function run(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast(e?.message || String(e)); }
}
function confirmBox(text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `<div class="dialog" role="alertdialog"><p>${esc(text)}</p><div class="row">
      <button type="button" class="btn ghost" data-r="0">Abbrechen</button>
      <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(okLabel)}</button></div></div>`;
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (b || e.target === wrap) { wrap.remove(); resolve(b?.dataset.r === '1'); }
    });
    document.body.appendChild(wrap);
  });
}

// ---------------------------------------------------------------- Sheets (Dialogfenster)
let sheetSeq = 0;
function openSheet(opts) {
  const sheet = { id: ++sheetSeq, live: false, ...opts };
  ui.sheets.push(sheet);
  renderSheets(true);
  sheet.onOpen?.($(`[data-sheet="${sheet.id}"]`));
  return sheet;
}
function closeSheet(id) {
  const s = id == null ? ui.sheets.pop() : ui.sheets.splice(ui.sheets.findIndex(x => x.id === id), 1)[0];
  s?.onClose?.();
  renderSheets(true);
}
function closeAllSheets() { while (ui.sheets.length) closeSheet(); }
function sheetHTML(s) {
  return `<div class="sheet-wrap" data-sheet="${s.id}"><div class="backdrop" data-act="closeSheet"></div>
    <section class="sheet ${s.full ? 'full' : ''}" role="dialog" aria-label="${esc(s.title)}">
      <header><button type="button" class="hbtn" data-act="closeSheet">${s.closeLabel ?? 'Schließen'}</button>
      <h2>${esc(typeof s.title === 'function' ? s.title() : s.title)}</h2><span class="hbtn"></span></header>
      <div class="sheet-body">${s.body()}</div></section></div>`;
}
function renderSheets(structural = false) {
  const host = $('#sheets');
  if (structural) {
    // Bestehende Sheets behalten (Formulareingaben bleiben), nur neue anhängen/entfernte löschen.
    const ids = new Set(ui.sheets.map(s => String(s.id)));
    host.querySelectorAll('.sheet-wrap').forEach(n => { if (!ids.has(n.dataset.sheet)) n.remove(); });
    for (const s of ui.sheets) if (!host.querySelector(`[data-sheet="${s.id}"]`)) host.insertAdjacentHTML('beforeend', sheetHTML(s));
  } else {
    for (const s of ui.sheets) {
      if (!s.live) continue;
      const node = host.querySelector(`[data-sheet="${s.id}"] .sheet-body`);
      if (!node) continue;
      const top = node.scrollTop;
      node.innerHTML = s.body();
      node.scrollTop = top;
      const h = host.querySelector(`[data-sheet="${s.id}"] h2`);
      if (h && typeof s.title === 'function') h.textContent = s.title();
    }
  }
  document.body.classList.toggle('has-sheet', ui.sheets.length > 0);
  hydratePhotos();
  tickClocks();
}

// ---------------------------------------------------------------- Render
const TABS = [
  ['home', 'Heute', 'home'], ['training', 'Training', 'dumbbell'], ['food', 'Ernährung', 'food'],
  ['progress', 'Fortschritt', 'chart'], ['more', 'Mehr', 'gear'],
];
function render() {
  const main = $('#main');
  const top = main.scrollTop;
  if (loadError) { main.innerHTML = renderLoadError(); return; }
  main.innerHTML = ({ home: renderHome, training: renderTraining, food: renderFood, progress: renderProgress, more: renderMore }[ui.tab] || renderHome)();
  main.scrollTop = top;
  $('#tabbar').innerHTML = TABS.map(([id, label, ic]) =>
    `<button type="button" class="${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`).join('');
  renderSheets(false);
}
function switchTab(tab) {
  ui.tab = tab; lsSet('masse.tab', tab);
  render(); $('#main').scrollTop = 0;
}

function renderLoadError() {
  return `<div class="pad"><div class="card warn"><h3>Daten benötigen Hilfe</h3><p>${esc(loadError)}</p>
  <p class="muted">Deine vorhandenen Daten werden nicht automatisch überschrieben.</p>
  <button type="button" class="btn" data-act="recoverPrevious">Letzte gültige Version laden</button>
  <button type="button" class="btn" data-act="importBackup">Sicherung importieren</button></div></div>`;
}

// ---------- Bausteine
function metric(title, value, goal, unit, cls) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const over = value > goal;
  return `<div class="metric"><div class="mrow"><span>${title}</span><span class="tnum">${num(value)} / ${num(goal)} ${unit}</span></div>
    <div class="bar"><i class="${cls}" style="width:${pct}%"></i></div>
    <div class="mini">${over ? `<b class="warn-t">Ziel um ${num(value - goal)} ${unit} überschritten</b>` : `Noch ${num(Math.max(0, goal - value))} ${unit}`}</div></div>`;
}
const stat = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b class="tnum">${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const empty = text => `<p class="muted center">${text}</p>`;

// ================================================================ HEUTE
function renderHome() {
  const now = new Date();
  const total = C.nutritionTotal(S.foodEntries, now);
  const g = S.profile.goals;
  const last = C.latestWeight(S.weights);
  const p = S.profile;
  const current = last?.kg ?? p.startKG;
  const progress = Math.abs(p.goalKG - p.startKG) < 0.001 ? 1 : Math.min(1, Math.max(0, (current - p.startKG) / (p.goalKG - p.startKG)));
  const todayPlans = S.plans.filter(x => x.weekday === now.getDay() + 1);
  const next = C.nextSession(S.plans, now);
  const lastWorkout = [...S.workouts].sort((a, b) => new Date(b.started) - new Date(a.started))[0];
  const hasData = S.foodEntries.length || S.weights.length || S.workouts.length;
  const backupDays = S.lastBackup ? C.daysBetween(S.lastBackup, now) : null;
  const showInstall = isIOS && !standalone() && lsGet('masse.hideInstall') !== '1';

  return `<div class="pad">
  <header class="hero"><div><p class="muted">${dateLong(now)}</p><h1>Dein Aufbau.<br>Dein Rhythmus.</h1></div><div class="logo">${icon('bolt')}</div></header>
  ${showInstall ? `<div class="card info"><b>Als App installieren</b><p>Tippe unten in Safari auf <b>Teilen</b> ${icon('share')} und dann auf <b>„Zum Home-Bildschirm“</b>. Danach startet MASSE wie eine App, auch offline.</p>
    <button type="button" class="link" data-act="hideInstall">Ausblenden</button></div>` : ''}
  ${hasData && (backupDays == null || backupDays >= 14) ? `<div class="card info"><b>Sicherung empfohlen</b><p>${backupDays == null ? 'Du hast noch keine Sicherung erstellt.' : `Letzte Sicherung vor ${backupDays} Tagen.`} Deine Daten liegen nur auf diesem iPhone.</p>
    <button type="button" class="btn small" data-act="exportBackup">Jetzt sichern</button></div>` : ''}
  ${S.activeWorkout ? `<button type="button" class="card resume" data-act="openWorkout">${icon('play')}<div><b>${esc(S.activeWorkout.name)} läuft</b><span class="muted" data-since="${S.activeWorkout.started}"></span></div>${icon('chev')}</button>` : ''}

  <section class="card">
    <p class="eyebrow">HEUTE IM FOKUS</p>
    <div class="big"><b class="tnum">${num(total.calories)}</b><span>/ ${num(g.calories)} kcal</span></div>
    ${metric('Kalorien', total.calories, g.calories, 'kcal', 'c-kcal')}
    ${metric('Protein', total.protein, g.protein, 'g', 'c-p')}
    ${metric('Kohlenhydrate', total.carbs, g.carbs, 'g', 'c-c')}
    ${metric('Fett', total.fat, g.fat, 'g', 'c-f')}
  </section>

  <div class="quick">
    <button type="button" data-act="addWeight">${icon('scale')}<span>Gewicht</span></button>
    <button type="button" data-act="openLibrary">${icon('plus')}<span>Essen</span></button>
    <button type="button" data-act="quickShake">${icon('cup')}<span>Masseshake</span></button>
    <button type="button" data-act="goTraining">${icon('dumbbell')}<span>Training</span></button>
  </div>

  ${renderSupplementsToday()}

  <section class="card">
    <h3>Körpergewicht</h3>
    <div class="stats">${stat('Zuletzt', kg(last?.kg), last ? dateShort(last.date) : '')}${stat('7-Tage-Mittel', kg(C.weightMean(S.weights, now)))}${stat('Zur Vorwoche', signedKg(C.weightChange(S.weights, now)))}</div>
    <div class="bar thin"><i class="c-kcal" style="width:${progress * 100}%"></i></div>
    <p class="mini">Start ${kg(p.startKG)} · Ziel ${kg(p.goalKG)}${last ? ` · noch ${kg(Math.max(0, p.goalKG - last.kg))}` : ''}</p>
    ${S.weights.length ? '' : `<p class="mini">Noch keine Messung. Der Ausgangswert zählt nicht als Messung.</p>`}
  </section>

  <section class="card">
    <h3>Dein Training</h3>
    ${todayPlans.map(x => `<p>${icon(x.volleyball ? 'ball' : 'dumbbell')} <b>Heute:</b> ${esc(x.name)} · ${hhmm(x.hour, x.minute)}${x.flexible ? ' · flexibel' : ''}</p>`).join('') || '<p class="muted">Heute kein Termin geplant.</p>'}
    ${next ? `<p>Nächste Einheit: <b>${esc(next[0].name)}</b> · ${weekdayName(next[0].weekday)} ${hhmm(next[0].hour, next[0].minute)}</p>` : ''}
    ${lastWorkout ? `<p class="muted">Zuletzt: ${esc(lastWorkout.name)} · ${dateShort(lastWorkout.started)}</p>` : ''}
  </section>
  </div>`;
}

function renderSupplementsToday() {
  const active = S.supplements.filter(s => !s.paused);
  if (!active.length) return '';
  const today = new Date();
  const count = id => S.supplementLogs.filter(l => l.supplementID === id && C.sameDay(l.date, today)).length;
  return `<section class="card"><h3>Supplemente heute</h3><div class="chips">
    ${active.map(s => { const n = count(s.id); return `<button type="button" class="chip ${n ? 'on' : ''}" data-act="logSupp" data-id="${s.id}">${n ? icon('check') : ''}${esc(s.name)}${n > 1 ? ` <b>${n}×</b>` : ''}</button>`; }).join('')}
  </div><p class="mini">Antippen zum Abhaken. Dosierungen in „Mehr → Supplemente“.</p></section>`;
}

// ================================================================ TRAINING
function renderTraining() {
  const plans = [...S.plans].sort((a, b) => mondayOrder(a.weekday) - mondayOrder(b.weekday) || a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const history = [...S.workouts].sort((a, b) => new Date(b.started) - new Date(a.started));
  return `<div class="pad"><h1 class="title">Training</h1>
  ${S.activeWorkout ? `<button type="button" class="card resume" data-act="openWorkout">${icon('play')}<div><b>${esc(S.activeWorkout.name)} fortsetzen</b><span class="muted" data-since="${S.activeWorkout.started}"></span></div>${icon('chev')}</button>` : ''}
  <h2 class="sec">Deine Woche</h2>
  ${plans.map(p => `<section class="card plan">
    <div class="row between"><h3>${icon(p.volleyball ? 'ball' : 'dumbbell')} ${esc(p.name)}</h3>
      <button type="button" class="iconbtn" data-act="editPlan" data-id="${p.id}" aria-label="${esc(p.name)} bearbeiten">${icon('edit')}</button></div>
    <p class="mini">${weekdayName(p.weekday)} · ${hhmm(p.hour, p.minute)} · ${p.durationMinutes} min${p.flexible ? ' · flexibel' : ''}</p>
    ${p.volleyball ? '' : `<p class="mini">${p.exercises.length} Übungen · ${p.exercises.reduce((n, e) => n + e.sets, 0)} Arbeitssätze</p>`}
    <button type="button" class="btn ${S.activeWorkout ? '' : 'primary'} small" data-act="startWorkout" data-id="${p.id}" ${S.activeWorkout ? 'disabled' : ''}>${icon('play')} Training starten</button>
  </section>`).join('')}
  <button type="button" class="btn block" data-act="newPlan">${icon('plus')} Eigener Trainingsplan</button>
  <p class="mini">Startlasten sind unverbindliche Vorgaben. Maschinenanzeigen sind nur am gleichen Gerät vergleichbar.</p>
  <h2 class="sec">Historie</h2>
  ${history.length ? `<div class="list">${history.map(w => `<button type="button" class="li" data-act="showWorkout" data-id="${w.id}">
    <div><b>${esc(w.name)}</b><span class="mini">${dateTime(w.started)} · ${Math.round(C.workoutDuration(w) / 60)} min${w.volleyball ? '' : ` · ${num(C.volume(w))} kg Volumen`}</span></div>${icon('chev')}</button>`).join('')}</div>`
    : empty('Deine abgeschlossenen Einheiten erscheinen hier.')}
  </div>`;
}

function workoutBody() {
  const w = S.activeWorkout;
  if (!w) return `<div class="center pad"><p>${icon('check')} Training gespeichert.</p><p class="muted">Du findest die Einheit in der Historie.</p></div>`;
  return `<div class="sticky-top">
      <div class="row between"><span>${icon('clock')} Dauer <b class="tnum" data-since="${w.started}"></b></span>
      <span class="tnum" data-rest-label></span></div>
      <div class="rest" data-rest-box hidden><div class="bar"><i data-rest-bar></i></div>
        <div class="row"><button type="button" class="btn small" data-act="restAdd">+30 s</button><button type="button" class="btn small ghost" data-act="restStop">Pause beenden</button></div></div>
    </div>
    ${w.volleyball ? `<div class="card"><p>Volleyball läuft. Beim Abschließen wird die Dauer gespeichert.</p></div>` : ''}
    ${w.exercises.map((item, i) => exerciseCard(item, i)).join('')}
    <section class="card"><h3>Trainingsnotiz</h3>
      <textarea rows="3" data-change="workoutNote" placeholder="Wie lief es?">${esc(w.note)}</textarea></section>
    <button type="button" class="btn primary block" data-act="finishWorkout">${icon('check')} Training abschließen</button>
    <button type="button" class="btn danger ghost block" data-act="discardWorkout">Training verwerfen</button>`;
}

function exerciseCard(item, i) {
  const ex = item.exercise;
  const prev = C.previousPerformance(ex.id, S.workouts);
  const sugg = prev ? C.suggestion(prev, ex.increment) : null;
  const doneWork = item.sets.filter(s => s.completed && !s.warmup).length;
  const unit = ex.timed ? 'Sek.' : 'Wdh.';
  const wLabel = ex.basis === 'perHand' ? 'kg/Hand' : ex.basis === 'bodyweight' ? 'kg Zusatz' : 'kg';
  const alreadyApplied = sugg != null && item.sets.filter(s => !s.warmup && !s.completed).every(s => s.weight === sugg);
  return `<section class="card ex ${doneWork >= ex.sets ? 'done' : ''}">
    <div class="row between"><h3>${esc(ex.name)}</h3><span class="pill">${doneWork}/${ex.sets}</span></div>
    <p class="mini">Ziel ${ex.sets} × ${ex.low}–${ex.high} ${unit} · ${C.LOAD_BASIS[ex.basis]}</p>
    ${ex.note ? `<p class="mini note">${esc(ex.note)}</p>` : ''}
    ${prev ? `<p class="mini">Letztes Mal: ${prev.sets.filter(s => s.completed && !s.warmup).map(s => `${s.weight != null ? numFlex(s.weight) : '—'}×${s.reps}`).join(' · ') || '—'}</p>` : ''}
    ${sugg != null && !alreadyApplied ? `<div class="suggest">${icon('up')} <span>Alle Sätze am oberen Ziel geschafft – <b>${numFlex(sugg)} kg</b> vorgeschlagen.</span>
      <button type="button" class="btn small primary" data-act="applySugg" data-ex="${i}" data-w="${sugg}">Übernehmen</button></div>` : ''}
    <div class="sets"><div class="sh"><span>Satz</span><span>${wLabel}</span><span>${unit}</span><span>RIR</span><span></span></div>
    ${item.sets.map((s, j) => `<div class="set ${s.completed ? 'ok' : ''} ${s.warmup ? 'warm' : ''}">
      <button type="button" class="sn" data-act="toggleWarm" data-ex="${i}" data-set="${j}" aria-label="Aufwärmsatz umschalten">${s.warmup ? 'A' : j + 1 - item.sets.slice(0, j).filter(x => x.warmup).length}</button>
      <input inputmode="decimal" enterkeyhint="next" value="${inVal(s.weight)}" placeholder="–" data-change="setField" data-field="weight" data-ex="${i}" data-set="${j}" aria-label="Gewicht">
      <input inputmode="numeric" enterkeyhint="done" value="${s.reps}" data-change="setField" data-field="reps" data-ex="${i}" data-set="${j}" aria-label="${unit}">
      <select data-change="setField" data-field="rir" data-ex="${i}" data-set="${j}" aria-label="RIR"><option value="">–</option>${[0, 1, 2, 3, 4, 5].map(r => `<option ${s.rir === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <button type="button" class="ck" data-act="toggleSet" data-ex="${i}" data-set="${j}" aria-label="Satz abhaken">${icon('check')}</button>
    </div>`).join('')}</div>
    <div class="row"><button type="button" class="btn small ghost" data-act="addSet" data-ex="${i}">${icon('plus')} Satz</button>
      ${item.sets.length > 1 ? `<button type="button" class="btn small ghost" data-act="removeSet" data-ex="${i}">Letzten Satz entfernen</button>` : ''}</div>
    <input class="exnote" value="${esc(item.note)}" placeholder="Notiz zur Übung" data-change="exNote" data-ex="${i}">
    <p class="mini">Tipp: Satznummer antippen markiert einen Aufwärmsatz (zählt nicht ins Volumen).</p>
  </section>`;
}

function openWorkout() {
  if (ui.sheets.some(s => s.kind === 'workout')) return;
  openSheet({ kind: 'workout', full: true, live: true, title: () => S.activeWorkout?.name ?? 'Training', closeLabel: 'Minimieren', body: workoutBody });
}

function workoutDetailBody(id) {
  const w = S.workouts.find(x => x.id === id);
  if (!w) return empty('Nicht gefunden.');
  return `<p class="muted">${dateTime(w.started)} · ${Math.round(C.workoutDuration(w) / 60)} min${w.volleyball ? '' : ` · ${num(C.volume(w))} kg Volumen`}</p>
  ${w.note ? `<div class="card"><p>${esc(w.note)}</p></div>` : ''}
  ${w.exercises.map(item => `<section class="card"><h3>${esc(item.exercise.name)}</h3>
    ${item.sets.map((s, j) => `<p class="mini">${s.warmup ? 'Aufwärmen' : `Satz ${j + 1}`}: ${s.weight != null ? numFlex(s.weight) + ' kg' : '—'} × ${s.reps} ${item.exercise.timed ? 'Sek.' : 'Wdh.'}${s.rir != null ? ` · RIR ${s.rir}` : ''}${s.completed ? '' : ' · <i>nicht abgeschlossen</i>'}</p>`).join('')}
    ${C.best1RM(item) ? `<p class="mini">Geschätztes 1RM: ${num(C.best1RM(item), 1)} kg</p>` : ''}
    ${item.note ? `<p class="mini note">${esc(item.note)}</p>` : ''}</section>`).join('')}
  <button type="button" class="btn danger ghost block" data-act="deleteWorkout" data-id="${w.id}">Einheit löschen</button>`;
}

// ---------- Planeditor
let draftPlan = null, draftOriginal = null;
function planEditorBody() {
  const p = draftPlan;
  const wd = [2, 3, 4, 5, 6, 7, 1];
  return `<form data-form="savePlan" class="form" id="plan-form">
    <label>Name<input name="name" value="${esc(p.name)}" data-input="plan" data-path="name" required></label>
    <div class="grid2"><label>Wochentag<select data-input="plan" data-path="weekday" data-type="int">${wd.map(d => `<option value="${d}" ${p.weekday === d ? 'selected' : ''}>${weekdayName(d)}</option>`).join('')}</select></label>
    <label>Uhrzeit<input type="time" value="${hhmm(p.hour, p.minute)}" data-input="plan" data-path="time"></label></div>
    <div class="grid2"><label>Dauer (min)<input inputmode="numeric" value="${p.durationMinutes}" data-input="plan" data-path="durationMinutes" data-type="int"></label>
    <label class="check"><input type="checkbox" ${p.flexible ? 'checked' : ''} data-input="plan" data-path="flexible" data-type="bool"> Termin flexibel</label></div>
    <label class="check"><input type="checkbox" ${p.volleyball ? 'checked' : ''} data-input="plan" data-path="volleyball" data-type="bool"> Volleyball / Sport ohne Übungen</label>
    ${p.volleyball ? '' : `<h3 class="sec">Übungen</h3>
    ${p.exercises.map((e, i) => `<fieldset class="card exedit">
      <div class="row between"><b>${i + 1}.</b><span class="row">
        <button type="button" class="iconbtn" data-act="exMove" data-i="${i}" data-d="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="iconbtn" data-act="exMove" data-i="${i}" data-d="1" aria-label="Nach unten" ${i === p.exercises.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="iconbtn danger" data-act="exDelete" data-i="${i}" aria-label="Übung entfernen">${icon('trash')}</button></span></div>
      <label>Übung<input value="${esc(e.name)}" data-input="plan" data-path="exercises.${i}.name" required></label>
      <div class="grid3"><label>Sätze<input inputmode="numeric" value="${e.sets}" data-input="plan" data-path="exercises.${i}.sets" data-type="int"></label>
      <label>Wdh. von<input inputmode="numeric" value="${e.low}" data-input="plan" data-path="exercises.${i}.low" data-type="int"></label>
      <label>bis<input inputmode="numeric" value="${e.high}" data-input="plan" data-path="exercises.${i}.high" data-type="int"></label></div>
      <div class="grid2"><label>Startgewicht (kg)<input inputmode="decimal" value="${inVal(e.seedWeight)}" placeholder="offen" data-input="plan" data-path="exercises.${i}.seedWeight" data-type="numOrNull"></label>
      <label>Steigerung (kg)<input inputmode="decimal" value="${inVal(e.increment)}" data-input="plan" data-path="exercises.${i}.increment" data-type="num"></label></div>
      <div class="grid2"><label>Lastangabe<select data-input="plan" data-path="exercises.${i}.basis">${Object.entries(C.LOAD_BASIS).map(([k, v]) => `<option value="${k}" ${e.basis === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" ${e.timed ? 'checked' : ''} data-input="plan" data-path="exercises.${i}.timed" data-type="bool"> In Sekunden</label></div>
      <label>Hinweis<input value="${esc(e.note)}" data-input="plan" data-path="exercises.${i}.note"></label>
    </fieldset>`).join('')}
    <button type="button" class="btn block" data-act="exAdd">${icon('plus')} Übung hinzufügen</button>`}
    <p class="mini">Neuer Name, andere Lastangabe oder Zeitmessung gelten als neue Übung, damit alte Leistungen nicht vermischt werden.</p>
    <button class="btn primary block">Speichern</button>
    ${S.plans.some(x => x.id === p.id) ? `<button type="button" class="btn danger ghost block" data-act="deletePlan">Plan löschen</button>` : ''}
  </form>`;
}
function openPlanEditor(p) {
  draftOriginal = p ? structuredClone(p) : null;
  draftPlan = p ? structuredClone(p) : C.plan('Mein Training', 7, 11);
  openSheet({ kind: 'plan', title: p ? 'Plan bearbeiten' : 'Neuer Plan', closeLabel: 'Abbrechen', body: planEditorBody });
}
function rerenderSheet(kind) {
  const s = ui.sheets.find(x => x.kind === kind);
  const node = s && $(`[data-sheet="${s.id}"] .sheet-body`);
  if (node) { const t = node.scrollTop; node.innerHTML = s.body(); node.scrollTop = t; }
}

// ================================================================ ERNÄHRUNG
function renderFood() {
  const d = ui.foodDay;
  const isToday = C.sameDay(d, new Date());
  const entries = S.foodEntries.filter(e => C.sameDay(e.date, d)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const t = C.nutritionTotal(S.foodEntries, d);
  const g = S.profile.goals;
  const groups = MEALS.concat([...new Set(entries.map(e => e.meal))].filter(m => !MEALS.includes(m)));
  const yesterdayCount = S.foodEntries.filter(e => C.sameDay(e.date, C.addDays(d, -1))).length;
  return `<div class="pad"><h1 class="title">Ernährung</h1>
  <div class="daynav"><button type="button" class="iconbtn" data-act="foodDay" data-d="-1" aria-label="Vorheriger Tag">‹</button>
    <b>${isToday ? 'Heute' : C.sameDay(d, C.addDays(new Date(), -1)) ? 'Gestern' : dateLong(d)}</b>
    <button type="button" class="iconbtn" data-act="foodDay" data-d="1" aria-label="Nächster Tag" ${isToday ? 'disabled' : ''}>›</button></div>
  <section class="card">
    <div class="big"><b class="tnum">${num(t.calories)}</b><span>/ ${num(g.calories)} kcal · noch ${num(Math.max(0, g.calories - t.calories))}</span></div>
    <div class="macros3">
      ${[['Protein', 'protein', 'c-p'], ['Kohlenh.', 'carbs', 'c-c'], ['Fett', 'fat', 'c-f']].map(([l, k, c]) => `<div><span class="mini">${l}</span><b class="tnum">${num(t[k])}<small>/${num(g[k])} g</small></b><div class="bar thin"><i class="${c}" style="width:${Math.min(100, (t[k] / g[k]) * 100)}%"></i></div></div>`).join('')}
    </div>
  </section>
  <div class="quick three">
    <button type="button" data-act="openLibrary">${icon('plus')}<span>Lebensmittel</span></button>
    <button type="button" data-act="scan">${icon('barcode')}<span>Barcode</span></button>
    <button type="button" data-act="quickShake">${icon('cup')}<span>Shake</span></button>
  </div>
  ${entries.length ? groups.map(m => {
    const list = entries.filter(e => e.meal === m);
    if (!list.length) return '';
    const sum = list.reduce((s, e) => C.addMacros(s, C.entryTotals(e)), C.macros());
    return `<h2 class="sec row between"><span>${esc(m)}</span><small class="muted">${num(sum.calories)} kcal · ${num(sum.protein)} g P</small></h2>
    <div class="list">${list.map(e => { const tt = C.entryTotals(e); return `<button type="button" class="li" data-act="editEntry" data-id="${e.id}">
      <div><b>${esc(e.food.name)}</b><span class="mini">${numFlex(e.amount)} ${esc(e.food.unit)} · ${time(e.date)}</span></div>
      <div class="r"><b class="tnum">${num(tt.calories)}</b><span class="mini">${num(tt.protein)} P · ${num(tt.carbs)} K · ${num(tt.fat)} F</span></div></button>`; }).join('')}</div>`;
  }).join('') : empty('Noch nichts eingetragen.')}
  ${yesterdayCount ? `<button type="button" class="btn block ghost" data-act="copyYesterday">${icon('copy')} Vortag übernehmen (${yesterdayCount} Einträge)</button>` : ''}
  </div>`;
}

function foodLabel(f) {
  return `<div><b>${f.favorite ? '★ ' : ''}${esc(f.name)}</b><span class="mini">${f.brand ? esc(f.brand) + ' · ' : ''}${num(f.macros.calories)} kcal · ${num(f.macros.protein, 1)} g P je ${numFlex(f.basisAmount)} ${esc(f.unit)}</span></div>`;
}
function libraryList(q = '') {
  q = q.trim().toLowerCase();
  const recentIds = [...new Set([...S.foodEntries].sort((a, b) => new Date(b.date) - new Date(a.date)).map(e => e.food.id))];
  const rank = f => (f.favorite ? 0 : 1) * 1e6 + (recentIds.includes(f.id) ? recentIds.indexOf(f.id) : 1e5);
  const foods = S.foods.filter(f => !q || f.name.toLowerCase().includes(q) || f.brand.toLowerCase().includes(q) || f.barcode === q)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'));
  return foods.length ? foods.map(f => `<div class="li"><button type="button" class="grow" data-act="pickFood" data-id="${f.id}">${foodLabel(f)}</button>
      <button type="button" class="iconbtn" data-act="editFood" data-id="${f.id}" aria-label="${esc(f.name)} bearbeiten">${icon('edit')}</button></div>`).join('')
    : `<p class="muted center">${q ? 'Nichts gefunden.' : 'Noch keine Lebensmittel.'}</p>`;
}
function libraryBody() {
  return `<div class="searchbar"><input type="search" id="lib-q" placeholder="Suchen …" data-input="libSearch" autocomplete="off"></div>
  <div class="row wrap"><button type="button" class="btn small" data-act="newFood">${icon('plus')} Neues Lebensmittel</button>
  <button type="button" class="btn small" data-act="scan">${icon('barcode')} Barcode</button>
  ${S.profile.onlineFoodEnabled ? `<button type="button" class="btn small" data-act="onlineSearch">${icon('globe')} Online suchen</button>` : ''}</div>
  <div class="list" id="lib-list">${libraryList()}</div>
  <div id="online-results"></div>
  ${S.profile.onlineFoodEnabled ? '' : `<p class="mini">Die Online-Suche (Open Food Facts) kannst du unter „Mehr“ einschalten.</p>`}`;
}
function openLibrary() {
  openSheet({ kind: 'library', title: 'Lebensmittel', body: libraryBody, live: false });
}

function amountSheet(food, entry = null) {
  const lastAmount = entry?.amount ?? [...S.foodEntries].filter(e => e.food.id === food.id).sort((a, b) => new Date(b.date) - new Date(a.date))[0]?.amount ?? food.basisAmount;
  const when = entry ? new Date(entry.date) : (C.sameDay(ui.foodDay, new Date()) ? new Date() : new Date(new Date(ui.foodDay).setHours(12, 0, 0, 0)));
  const meal = entry?.meal ?? defaultMeal(when);
  const presets = food.unit === 'g' || food.unit === 'ml' ? [50, 100, 150, 200, 250] : [0.5, 1, 1.5, 2];
  openSheet({
    kind: 'amount', title: entry ? 'Eintrag bearbeiten' : food.name, closeLabel: 'Abbrechen',
    body: () => `<form data-form="saveEntry" class="form" data-food="${food.id}" data-entry="${entry?.id ?? ''}">
      <div class="card flat">${foodLabel(food)}<p class="mini">${esc(food.source)}</p></div>
      <label>Menge (${esc(food.unit)})<input name="amount" inputmode="decimal" value="${inVal(lastAmount)}" required data-input="amountPreview" autofocus></label>
      <div class="chips">${presets.map(p => `<button type="button" class="chip" data-act="setAmount" data-v="${p}">${numFlex(p)} ${esc(food.unit)}</button>`).join('')}</div>
      <div class="card flat preview" id="amount-preview"></div>
      <div class="grid2"><label>Mahlzeit<select name="meal">${MEALS.concat(MEALS.includes(meal) ? [] : [meal]).map(m => `<option ${m === meal ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label>Zeitpunkt<input type="datetime-local" name="date" value="${dtLocal(when)}" required></label></div>
      <button class="btn primary block">${entry ? 'Speichern' : 'Hinzufügen'}</button>
      ${entry ? `<button type="button" class="btn danger ghost block" data-act="deleteEntry" data-id="${entry.id}">Eintrag löschen</button>` : ''}
    </form>`,
    onOpen: node => updateAmountPreview(node.querySelector('form')),
    food: entry ? entry.food : food,
  });
}
function updateAmountPreview(form) {
  const s = ui.sheets.find(x => x.kind === 'amount');
  const out = form.querySelector('#amount-preview');
  try {
    const m = C.portion(s.food, parseNum(form.amount.value));
    out.innerHTML = `<div class="macros4">${[['kcal', m.calories, 0], ['Protein', m.protein, 1], ['Kohlenh.', m.carbs, 1], ['Fett', m.fat, 1]].map(([l, v, d]) => `<div><b class="tnum">${num(v, d)}</b><span class="mini">${l}</span></div>`).join('')}</div>`;
  } catch { out.innerHTML = '<p class="mini">Bitte eine gültige Menge eingeben.</p>'; }
}

function foodEditor(food = null, prefill = {}) {
  const f = food ?? { ...C.newFood('', C.macros()), ...prefill };
  const ing = (f.ingredients ?? []).map(i => `${numFlex(i.amount)} ${i.unit} ${i.name}`).join('\n');
  openSheet({
    kind: 'foodEditor', title: food ? 'Lebensmittel bearbeiten' : 'Neues Lebensmittel', closeLabel: 'Abbrechen',
    body: () => `<form data-form="saveFood" class="form" data-id="${food?.id ?? ''}" data-then="${prefill.thenAdd ? '1' : ''}">
      <label>Name<input name="name" value="${esc(f.name)}" required></label>
      <label>Marke (optional)<input name="brand" value="${esc(f.brand)}"></label>
      <div class="grid2"><label>Nährwerte je<input name="basisAmount" inputmode="decimal" value="${inVal(f.basisAmount)}" required></label>
      <label>Einheit<select name="unit">${['g', 'ml', 'Portion', 'Stück'].concat(['g', 'ml', 'Portion', 'Stück'].includes(f.unit) ? [] : [f.unit]).map(u => `<option ${u === f.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label></div>
      <div class="grid2"><label>Kalorien (kcal)<input name="calories" inputmode="decimal" value="${food || prefill.macros ? inVal(+f.macros.calories.toFixed(1)) : ''}" required></label>
      <label>Protein (g)<input name="protein" inputmode="decimal" value="${food || prefill.macros ? inVal(+f.macros.protein.toFixed(1)) : ''}" required></label></div>
      <div class="grid2"><label>Kohlenhydrate (g)<input name="carbs" inputmode="decimal" value="${food || prefill.macros ? inVal(+f.macros.carbs.toFixed(1)) : ''}" required></label>
      <label>Fett (g)<input name="fat" inputmode="decimal" value="${food || prefill.macros ? inVal(+f.macros.fat.toFixed(1)) : ''}" required></label></div>
      <label>Barcode (optional)<input name="barcode" inputmode="numeric" value="${esc(f.barcode ?? '')}"></label>
      <label class="check"><input type="checkbox" name="favorite" ${f.favorite ? 'checked' : ''}> Favorit</label>
      <label class="check"><input type="checkbox" name="recipe" ${f.recipe ? 'checked' : ''}> Rezept / Gericht</label>
      <label>Zutaten (eine pro Zeile, nur zur Info)<textarea name="ingredients" rows="4" placeholder="300 ml Vollmilch">${esc(ing)}</textarea></label>
      <p class="mini">Zutatenänderungen berechnen die Nährwerte nicht neu – bitte Gesamtwerte prüfen.</p>
      <button class="btn primary block">Speichern</button>
      ${food ? `<button type="button" class="btn danger ghost block" data-act="deleteFood" data-id="${food.id}">Aus Katalog löschen</button><p class="mini">Bereits eingetragene Mahlzeiten bleiben unverändert.</p>` : ''}
    </form>`,
  });
}

// ---------- Scanner
function openScanner() {
  let stop = null;
  openSheet({
    kind: 'scanner', title: 'Barcode scannen', full: true,
    body: () => `<div class="scan"><video id="scan-video" playsinline muted></video><div class="scan-frame"></div></div>
      <p class="mini center" id="scan-status">Kamera wird gestartet …</p>
      <form data-form="manualBarcode" class="form row"><input name="code" inputmode="numeric" placeholder="Code manuell eingeben" aria-label="Barcode"><button class="btn">Suchen</button></form>`,
    onOpen: async node => {
      const status = node.querySelector('#scan-status');
      try {
        stop = await startScanner(node.querySelector('#scan-video'), code => run(async () => {
          closeSheet(ui.sheets.find(s => s.kind === 'scanner')?.id);
          await handleBarcode(code);
        }));
        status.textContent = 'Barcode in den Rahmen halten.';
      } catch (e) {
        status.textContent = (e?.name === 'NotAllowedError' ? 'Kamerazugriff wurde nicht erlaubt. Du kannst ihn in den iPhone-Einstellungen unter Safari freigeben.' : (e?.message || 'Kamera nicht verfügbar.')) + ' Du kannst den Code auch manuell eingeben.';
      }
    },
    onClose: () => stop?.(),
  });
}
async function handleBarcode(raw) {
  const code = C.normalizeBarcode(raw);
  const local = S.foods.find(f => f.barcode === code);
  if (local) return amountSheet(local);
  if (S.profile.onlineFoodEnabled) {
    toast('Suche bei Open Food Facts …');
    try {
      const food = await fetchProduct(code);
      await commit(s => { s.foods.push(food); }, { render: false });
      render();
      return amountSheet(S.foods.find(f => f.id === food.id));
    } catch (e) {
      toast(e.message);
    }
  }
  foodEditor(null, { barcode: code, thenAdd: true });
  if (!S.profile.onlineFoodEnabled) toast('Unbekannter Code – bitte Werte vom Etikett eingeben.');
}

// ---------- Open Food Facts
const OFF_FIELDS = 'code,product_name,product_name_de,brands,nutriments,product_quantity_unit';
async function offFetch(url) {
  if (!navigator.onLine) throw new C.FitnessError('Keine Internetverbindung. Bitte Werte manuell eingeben.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    if (res.status === 404) throw new C.FitnessError(C.MISSING_PRODUCT);
    if (!res.ok) throw new C.FitnessError(`Open Food Facts antwortet mit HTTP ${res.status}. Bitte später erneut versuchen.`);
    return await res.json();
  } catch (e) {
    if (e instanceof C.FitnessError) throw e;
    throw new C.FitnessError('Open Food Facts ist gerade nicht erreichbar. Bitte Werte manuell eingeben.');
  } finally { clearTimeout(timer); }
}
async function fetchProduct(code) {
  if (Date.now() - ui.lastOnline.product < 4000) throw new C.FitnessError('Bitte einige Sekunden bis zum nächsten Produktabruf warten.');
  ui.lastOnline.product = Date.now();
  const data = await offFetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  if (!data?.product) throw new C.FitnessError(C.MISSING_PRODUCT);
  try { const f = C.productToFood(data.product); f.barcode = code; return f; } catch { throw new C.FitnessError(C.MISSING_PRODUCT); }
}
async function onlineSearch(q) {
  if (!q.trim()) throw new C.FitnessError('Bitte zuerst einen Suchbegriff eingeben.');
  if (Date.now() - ui.lastOnline.search < 6000) throw new C.FitnessError('Bitte einige Sekunden zwischen zwei Onlinesuchen warten.');
  ui.lastOnline.search = Date.now();
  const p = new URLSearchParams({ search_terms: q, search_simple: '1', action: 'process', json: '1', page_size: '20', fields: OFF_FIELDS });
  const data = await offFetch(`https://world.openfoodfacts.org/cgi/search.pl?${p}`);
  return (data.products ?? []).map(x => { try { return C.productToFood(x); } catch { return null; } }).filter(Boolean);
}
let onlineCache = [];

// ================================================================ FORTSCHRITT
function inRange(date) {
  if (!ui.range) return true;
  return new Date(date) >= C.addDays(C.startOfDay(new Date()), -(ui.range - 1));
}
function dayRange() {
  const today = C.startOfDay(new Date());
  let days = ui.range;
  if (!days) {
    const first = [...S.foodEntries.map(e => e.date)].map(d => new Date(d)).sort((a, b) => a - b)[0];
    days = first ? Math.max(1, C.daysBetween(first, today) + 1) : 7;
  }
  return Array.from({ length: days }, (_, i) => C.addDays(today, -(days - 1 - i)));
}
function renderProgress() {
  const now = new Date();
  const series = C.weightSeries(S.weights).filter(d => inRange(d.date));
  const days = dayRange();
  const dailyTotals = days.map(d => ({ x: d, m: C.nutritionTotal(S.foodEntries, d) }));
  const logged = dailyTotals.filter(d => d.m.calories > 0);
  const avg = k => (logged.length ? logged.reduce((s, d) => s + d.m[k], 0) / logged.length : 0);
  const workouts = [...S.workouts].filter(w => inRange(w.started) && !w.volleyball).sort((a, b) => new Date(a.started) - new Date(b.started));
  const exNames = [...new Map(S.workouts.flatMap(w => w.exercises).filter(e => !e.exercise.timed && e.exercise.basis !== 'bodyweight').map(e => [e.exercise.id, e.exercise.name])).entries()];
  if (!ui.e1rmEx || !exNames.some(([id]) => id === ui.e1rmEx)) ui.e1rmEx = exNames[0]?.[0] ?? null;
  const e1rm = S.workouts.filter(w => w.ended && inRange(w.started)).sort((a, b) => new Date(a.started) - new Date(b.started))
    .map(w => { const it = w.exercises.find(e => e.exercise.id === ui.e1rmEx); const v = it && C.best1RM(it); return v ? { x: new Date(w.started), y: v } : null; }).filter(Boolean);
  const stalled = C.weightStalled(S.weights, now);
  const plateauKey = C.dayKey(now);

  return `<div class="pad"><h1 class="title">Fortschritt</h1>
  <div class="seg">${[[7, '7 T'], [30, '30 T'], [90, '90 T'], [0, 'Alles']].map(([v, l]) => `<button type="button" class="${ui.range === v ? 'on' : ''}" data-act="range" data-v="${v}">${l}</button>`).join('')}</div>

  <section class="card"><div class="row between"><h3>Körpergewicht</h3><button type="button" class="btn small primary" data-act="addWeight">${icon('plus')} Eintragen</button></div>
    ${lineChart([
      { points: series.map(d => ({ x: d.date, y: d.kg })), cls: 's1', dots: true, label: 'Tageswert' },
      { points: series.map(d => ({ x: d.date, y: d.average })), cls: 's2', label: '7-Tage-Mittel' },
    ], { decimals: 1, emptyText: 'Trage dein Gewicht ein, um die Kurve zu sehen.' })}
    <div class="stats">${stat('Zur Vorwoche', signedKg(C.weightChange(S.weights, now)))}${stat('Zum Vormonat', signedKg(C.weightChange(S.weights, now, 30)))}${stat('Ø pro Woche', signedKg(C.gainPerWeek(S.weights)))}</div>
    <button type="button" class="link" data-act="weightList">Alle Messungen (${S.weights.length})</button>
  </section>
  ${stalled && lsGet('masse.plateau') !== plateauKey ? `<section class="card info"><b>Gewicht stagniert seit etwa zwei Wochen</b>
    <p>Du könntest dein Tagesziel um <b>150 kcal</b> und <b>37,5 g Kohlenhydrate</b> erhöhen. Das ist ein Richtwert, keine medizinische Empfehlung.</p>
    <div class="row"><button type="button" class="btn small primary" data-act="plateauApply">Ziel erhöhen</button><button type="button" class="btn small ghost" data-act="plateauDismiss">Nicht jetzt</button></div></section>` : ''}

  <section class="card"><h3>Kalorien</h3>
    ${barChart(dailyTotals.map(d => ({ x: d.x, y: d.m.calories })), { goal: S.profile.goals.calories, cls: 'c-kcal', emptyText: 'Noch keine Ernährungseinträge im Zeitraum.' })}
    <div class="stats">${stat('Ø an erfassten Tagen', num(avg('calories')) + ' kcal')}${stat('Erfasste Tage', `${logged.length} / ${days.length}`)}</div></section>
  <section class="card"><h3>Protein</h3>
    ${barChart(dailyTotals.map(d => ({ x: d.x, y: d.m.protein })), { goal: S.profile.goals.protein, cls: 'c-p', emptyText: 'Noch keine Ernährungseinträge im Zeitraum.' })}
    <div class="stats">${stat('Ø Protein', num(avg('protein')) + ' g')}${stat('Ø Kohlenhydrate', num(avg('carbs')) + ' g')}${stat('Ø Fett', num(avg('fat')) + ' g')}</div></section>
  <section class="card"><h3>Makroverteilung (Energie)</h3>
    ${donut([{ value: avg('protein') * 4, cls: 'c-p', label: 'Protein' }, { value: avg('carbs') * 4, cls: 'c-c', label: 'Kohlenhydrate' }, { value: avg('fat') * 9, cls: 'c-f', label: 'Fett' }])}</section>

  <section class="card"><h3>Trainingsvolumen</h3>
    ${barChart(workouts.map(w => ({ x: new Date(w.started), y: C.volume(w) })), { cls: 'c-p', emptyText: 'Noch keine Krafteinheiten im Zeitraum.' })}
    <p class="mini">Summe Last × Wiederholungen abgeschlossener Arbeitssätze je Einheit.</p></section>
  <section class="card"><h3>Geschätztes 1RM</h3>
    ${exNames.length ? `<select data-change="e1rmEx">${exNames.map(([id, n]) => `<option value="${id}" ${id === ui.e1rmEx ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
    ${lineChart([{ points: e1rm, cls: 's1', dots: true }], { decimals: 1, emptyText: 'Schließe Sätze ab, um die Entwicklung zu sehen.' })}
    <p class="mini">Epley-Schätzung aus 1–12 Wiederholungen. Keine gemessene Bestleistung.</p></section>

  <section class="card"><div class="row between"><h3>Körpermaße</h3><button type="button" class="btn small" data-act="addMeasure">${icon('plus')} Messen</button></div>
    ${renderMeasurements()}</section>

  <section class="card"><div class="row between"><h3>Fotos</h3><div class="row">
    ${S.photos.length >= 2 ? `<button type="button" class="btn small ${ui.compare ? 'primary' : ''}" data-act="compareMode">${ui.compare ? `Vergleichen (${ui.compare.length}/2)` : 'Vergleichen'}</button>` : ''}
    <label class="btn small">${icon('camera')} Hinzufügen<input type="file" accept="image/*" hidden data-change="addPhoto"></label></div></div>
    ${ui.compare ? `<p class="mini">Wähle zwei Fotos zum Vergleichen.</p>` : ''}
    ${S.photos.length ? `<div class="photos">${[...S.photos].sort((a, b) => new Date(b.date) - new Date(a.date)).map(p => `<button type="button" class="ph ${ui.compare?.includes(p.id) ? 'sel' : ''}" data-act="photo" data-id="${p.id}">
      <img data-photo="${p.id}" alt="Foto vom ${dateShort(p.date)}"><span>${dateShort(p.date)} · ${esc(p.angle)}</span></button>`).join('')}</div>`
      : empty('Fotos bleiben nur auf diesem Gerät gespeichert.')}
  </section>
  </div>`;
}
const MEASURES = [['waist', 'Taille'], ['chest', 'Brust'], ['arm', 'Oberarm'], ['thigh', 'Oberschenkel'], ['hip', 'Hüfte']];
function renderMeasurements() {
  const list = [...(S.measurements ?? [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!list.length) return empty('Noch keine Messungen.');
  return `<div class="table"><div class="tr th"><span>Datum</span>${MEASURES.map(([, l]) => `<span>${l}</span>`).join('')}</div>
    ${list.slice(0, 12).map(m => `<button type="button" class="tr" data-act="editMeasure" data-id="${m.id}"><span>${dateShort(m.date)}</span>${MEASURES.map(([k]) => `<span class="tnum">${m[k] != null ? numFlex(m[k], 1) : '–'}</span>`).join('')}</button>`).join('')}</div>
    <p class="mini">Angaben in cm. Antippen zum Bearbeiten.</p>`;
}

function weightSheet(entry = null) {
  const last = C.latestWeight(S.weights);
  openSheet({
    kind: 'weight', title: entry ? 'Messung bearbeiten' : 'Gewicht eintragen', closeLabel: 'Abbrechen',
    body: () => `<form data-form="saveWeight" class="form" data-id="${entry?.id ?? ''}">
      <label>Gewicht (kg)<input name="kg" inputmode="decimal" value="${inVal(entry?.kg ?? last?.kg ?? S.profile.startKG)}" required autofocus></label>
      <label>Zeitpunkt<input type="datetime-local" name="date" value="${dtLocal(entry?.date ?? new Date())}" required></label>
      <label>Notiz (optional)<input name="note" value="${esc(entry?.note ?? '')}" placeholder="z. B. nüchtern, nach dem Aufstehen"></label>
      <button class="btn primary block">Speichern</button>
      ${entry ? `<button type="button" class="btn danger ghost block" data-act="deleteWeight" data-id="${entry.id}">Messung löschen</button>` : ''}
    </form>`,
  });
}
function weightListBody() {
  const list = [...S.weights].sort((a, b) => new Date(b.date) - new Date(a.date));
  return list.length ? `<div class="list">${list.map(w => `<button type="button" class="li" data-act="editWeight" data-id="${w.id}">
    <div><b class="tnum">${kg(w.kg)}</b><span class="mini">${dateTime(w.date)}${w.note ? ' · ' + esc(w.note) : ''}</span></div>${icon('chev')}</button>`).join('')}</div>` : empty('Noch keine Messungen.');
}
function measureSheet(m = null) {
  openSheet({
    kind: 'measure', title: m ? 'Messung bearbeiten' : 'Körpermaße', closeLabel: 'Abbrechen',
    body: () => `<form data-form="saveMeasure" class="form" data-id="${m?.id ?? ''}">
      <label>Datum<input type="datetime-local" name="date" value="${dtLocal(m?.date ?? new Date())}" required></label>
      <div class="grid2">${MEASURES.map(([k, l]) => `<label>${l} (cm)<input name="${k}" inputmode="decimal" value="${inVal(m?.[k])}"></label>`).join('')}</div>
      <label>Notiz<input name="note" value="${esc(m?.note ?? '')}"></label>
      <button class="btn primary block">Speichern</button>
      ${m ? `<button type="button" class="btn danger ghost block" data-act="deleteMeasure" data-id="${m.id}">Löschen</button>` : ''}
    </form>`,
  });
}

// ---------- Fotos
const photoURLs = new Map();
async function photoURL(id) {
  if (photoURLs.has(id)) return photoURLs.get(id);
  const blob = await DB.getPhoto(id);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  photoURLs.set(id, url);
  return url;
}
function hydratePhotos() {
  document.querySelectorAll('img[data-photo]:not([src])').forEach(img => photoURL(img.dataset.photo).then(u => { if (u) img.src = u; }));
}
async function compressImage(file, max = 1400) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Das Bild konnte nicht gelesen werden.')); i.src = URL.createObjectURL(file); });
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Bild konnte nicht verarbeitet werden.'))), 'image/jpeg', 0.85));
}
function photoSheet(id) {
  const p = S.photos.find(x => x.id === id);
  openSheet({
    kind: 'photo', title: dateShort(p.date), full: true, closeLabel: 'Fertig',
    body: () => `<img class="photo-big" data-photo="${p.id}" alt="">
      <form data-form="savePhoto" class="form" data-id="${p.id}">
        <div class="grid2"><label>Datum<input type="datetime-local" name="date" value="${dtLocal(p.date)}"></label>
        <label>Ansicht<select name="angle">${['Front', 'Seite', 'Rücken', 'Andere'].map(a => `<option ${a === p.angle ? 'selected' : ''}>${a}</option>`).join('')}</select></label></div>
        <label>Gewicht (kg, optional)<input name="kg" inputmode="decimal" value="${inVal(p.kg)}"></label>
        <button class="btn primary block">Speichern</button>
        <button type="button" class="btn danger ghost block" data-act="deletePhoto" data-id="${p.id}">Foto löschen</button>
      </form>`,
  });
}
function compareSheet(ids) {
  const ps = ids.map(id => S.photos.find(p => p.id === id)).sort((a, b) => new Date(a.date) - new Date(b.date));
  openSheet({
    kind: 'compare', title: 'Vergleich', full: true,
    body: () => `<div class="compare">${ps.map(p => `<figure><img data-photo="${p.id}" alt=""><figcaption>${dateShort(p.date)}${p.kg ? ' · ' + kg(p.kg) : ''}<br><span class="mini">${esc(p.angle)}</span></figcaption></figure>`).join('')}</div>
      <p class="mini center">${C.daysBetween(ps[0].date, ps[1].date)} Tage Abstand${ps[0].kg && ps[1].kg ? ` · ${signedKg(ps[1].kg - ps[0].kg)}` : ''}</p>`,
  });
}

// ================================================================ MEHR
function renderMore() {
  const p = S.profile;
  return `<div class="pad"><h1 class="title">Mehr</h1>
  <section class="card"><h3>Ziele & Profil</h3>
  <form data-form="saveProfile" class="form">
    <div class="grid2"><label>Kalorien (kcal)<input name="calories" inputmode="decimal" value="${inVal(p.goals.calories)}"></label>
    <label>Protein (g)<input name="protein" inputmode="decimal" value="${inVal(p.goals.protein)}"></label>
    <label>Kohlenhydrate (g)<input name="carbs" inputmode="decimal" value="${inVal(p.goals.carbs)}"></label>
    <label>Fett (g)<input name="fat" inputmode="decimal" value="${inVal(p.goals.fat)}"></label>
    <label>Größe (cm)<input name="heightCM" inputmode="decimal" value="${inVal(p.heightCM)}"></label>
    <label>Startgewicht (kg)<input name="startKG" inputmode="decimal" value="${inVal(p.startKG)}"></label>
    <label>Zielgewicht (kg)<input name="goalKG" inputmode="decimal" value="${inVal(p.goalKG)}"></label>
    <label>Satzpause (Sek.)<input name="restSeconds" inputmode="numeric" value="${p.restSeconds}"></label></div>
    <label>Trainingsziel<input name="trainingGoal" value="${esc(p.trainingGoal)}"></label>
    <p class="mini">Energie aus Makros: ${num(p.goals.protein * 4 + p.goals.carbs * 4 + p.goals.fat * 9)} kcal (4/4/9 kcal je g).</p>
    <button class="btn primary block">Ziele speichern</button>
  </form></section>

  <section class="card"><div class="row between"><h3>Supplemente</h3><button type="button" class="btn small" data-act="newSupp">${icon('plus')} Neu</button></div>
    <div class="list">${S.supplements.map(s => `<button type="button" class="li" data-act="editSupp" data-id="${s.id}"><div><b>${esc(s.name)}${s.paused ? ' <span class="pill">pausiert</span>' : ''}</b><span class="mini">${esc(s.dose)}${s.note ? ' · ' + esc(s.note) : ''}</span></div>${icon('chev')}</button>`).join('') || empty('Keine Supplemente.')}</div>
    <p class="mini">Keine medizinische Empfehlung. Dosierungen individuell abklären.</p></section>

  <section class="card"><h3>Lebensmittel</h3>
    <button type="button" class="btn block" data-act="openLibrary">${icon('food')} Katalog verwalten (${S.foods.length})</button>
    <label class="check toggle"><input type="checkbox" data-change="toggleOnline" ${p.onlineFoodEnabled ? 'checked' : ''}> Online-Suche über Open Food Facts</label>
    <p class="mini">Nur wenn eingeschaltet und von dir ausgelöst, wird der Barcode bzw. Suchbegriff an world.openfoodfacts.org gesendet. Daten: Open Food Facts, Lizenz ODbL – Werte bitte mit dem Etikett vergleichen.</p></section>

  <section class="card"><h3>Daten & Sicherung</h3>
    <p class="mini">Alle Daten liegen nur auf diesem Gerät im Speicher der Web-App. Wenn du die App vom Home-Bildschirm löschst oder Websitedaten in Safari entfernst, sind sie weg. Sichere regelmäßig, z. B. in iCloud Drive.</p>
    <p class="mini">Letzte Sicherung: <b>${S.lastBackup ? dateTime(S.lastBackup) : 'noch nie'}</b></p>
    <button type="button" class="btn primary block" data-act="exportBackup">${icon('download')} Sicherung exportieren</button>
    <button type="button" class="btn block" data-act="importBackup">${icon('upload')} Sicherung importieren</button>
    <div class="row wrap"><button type="button" class="btn small ghost" data-act="csv" data-k="food">CSV Ernährung</button>
    <button type="button" class="btn small ghost" data-act="csv" data-k="weight">CSV Gewicht</button>
    <button type="button" class="btn small ghost" data-act="csv" data-k="training">CSV Training</button></div>
    <p class="mini" id="storage-info"></p></section>

  <section class="card"><h3>Installation</h3>
    <p class="mini">${standalone() ? 'MASSE läuft als installierte App.' : 'In Safari: <b>Teilen</b> → <b>„Zum Home-Bildschirm“</b>. Danach startet MASSE im Vollbild und funktioniert offline.'}</p>
    <button type="button" class="btn small ghost" data-act="checkUpdate">Nach Update suchen</button></section>

  <section class="card"><h3>Über</h3>
    <p class="mini">MASSE Web · Version ${APP_VERSION}. Keine Konten, keine Werbung, kein Tracking. Barcode-Erkennung: zxing-wasm / barcode-detector (MIT, Apache-2.0).</p>
    <button type="button" class="btn danger ghost block" data-act="resetAll">Alle Daten löschen</button></section>
  </div>`;
}
function suppSheet(s = null) {
  openSheet({
    kind: 'supp', title: s ? s.name : 'Neues Supplement', closeLabel: 'Abbrechen',
    body: () => `<form data-form="saveSupp" class="form" data-id="${s?.id ?? ''}">
      <label>Name<input name="name" value="${esc(s?.name ?? '')}" required></label>
      <label>Dosis<input name="dose" value="${esc(s?.dose ?? '')}"></label>
      <label>Notiz<input name="note" value="${esc(s?.note ?? '')}"></label>
      <label class="check"><input type="checkbox" name="paused" ${s?.paused ? 'checked' : ''}> Pausiert</label>
      <button class="btn primary block">Speichern</button>
      ${s ? `<button type="button" class="btn danger ghost block" data-act="deleteSupp" data-id="${s.id}">Löschen</button>` : ''}
    </form>`,
  });
}

// ---------------------------------------------------------------- Pausentimer & Uhren
let audioCtx;
function beep() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach(d => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.25, t + d); g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.18);
      o.connect(g).connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.2);
    });
  } catch { /* kein Ton */ }
  navigator.vibrate?.([200, 100, 200]);
}
function unlockAudio() { try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch { /* egal */ } }
function startRest() { unlockAudio(); const total = S.profile.restSeconds; if (total > 0) ui.rest = { end: Date.now() + total * 1000, total }; }
function tickClocks() {
  const now = Date.now();
  document.querySelectorAll('[data-since]').forEach(el => { el.textContent = duration((now - new Date(el.dataset.since)) / 1000); });
  const box = document.querySelector('[data-rest-box]'), label = document.querySelector('[data-rest-label]');
  if (ui.rest) {
    const left = Math.max(0, (ui.rest.end - now) / 1000);
    if (box) { box.hidden = false; box.querySelector('[data-rest-bar]').style.width = `${(left / ui.rest.total) * 100}%`; }
    if (label) label.innerHTML = left > 0 ? `${icon('timer')} Pause <b>${duration(Math.ceil(left))}</b>` : '<b class="ok-t">Pause vorbei – los!</b>';
    if (left <= 0 && !ui.rest.done) { ui.rest.done = true; beep(); setTimeout(() => { if (ui.rest?.done) { ui.rest = null; tickClocks(); } }, 8000); }
  } else {
    if (box) box.hidden = true;
    if (label) label.textContent = '';
  }
}

// ---------------------------------------------------------------- Sicherung
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isIOS && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e?.name === 'AbortError') return false; }
  }
  download(blob, name);
  return true;
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function exportBackup() {
  const photos = {};
  for (const p of S.photos) { const b = await DB.getPhoto(p.id); if (b) photos[p.id] = await blobToDataURL(b); }
  const payload = { app: 'MASSE', format: 1, exported: new Date().toISOString(), state: S, photos };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  if (blob.size > 150 * 1024 * 1024) throw new C.FitnessError('Die Sicherung ist größer als 150 MB. Bitte einige Fotos löschen.');
  const ok = await shareOrDownload(blob, `MASSE-Sicherung-${C.dayKey(new Date())}.json`);
  if (ok) { await commit(s => { s.lastBackup = new Date().toISOString(); }); toast('Sicherung erstellt.'); }
}
function importBackup() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = () => run(async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) throw new C.FitnessError('Die Datei ist zu groß.');
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new C.FitnessError('Die Datei ist keine gültige MASSE-Sicherung.'); }
    if (data?.app !== 'MASSE' || !data.state) throw new C.FitnessError('Die Datei ist keine MASSE-Sicherung.');
    const state = migrate(data.state);
    C.validateState(state);
    for (const p of state.photos) if (!data.photos?.[p.id]?.startsWith?.('data:image/')) throw new C.FitnessError('Ein Foto in der Sicherung fehlt oder ist ungültig.');
    if (!(await confirmBox(`Sicherung vom ${dateTime(data.exported)} wiederherstellen? Deine aktuellen Daten auf diesem Gerät werden ersetzt.`, 'Wiederherstellen', true))) return;
    const blobs = await Promise.all(state.photos.map(async p => [p.id, await (await fetch(data.photos[p.id])).blob()]));
    const prev = S;
    await DB.clearAll();
    for (const [id, b] of blobs) await DB.putPhoto(id, b);
    await DB.saveState(state, prev ?? undefined);
    S = state; loadError = null; photoURLs.clear(); ui.rest = null;
    closeAllSheets(); render();
    toast('Sicherung wiederhergestellt.');
  });
  input.click();
}
function exportCSV(kind) {
  let rows, name;
  if (kind === 'food') {
    rows = [['Datum', 'Uhrzeit', 'Mahlzeit', 'Lebensmittel', 'Marke', 'Menge', 'Einheit', 'kcal', 'Protein g', 'Kohlenhydrate g', 'Fett g']];
    for (const e of [...S.foodEntries].sort((a, b) => new Date(a.date) - new Date(b.date))) {
      const t = C.entryTotals(e);
      rows.push([C.dayKey(e.date), time(e.date), e.meal, e.food.name, e.food.brand, numFlex(e.amount), e.food.unit, num(t.calories, 0), num(t.protein, 1), num(t.carbs, 1), num(t.fat, 1)]);
    }
    name = 'ernaehrung';
  } else if (kind === 'weight') {
    rows = [['Datum', 'Uhrzeit', 'Gewicht kg', 'Notiz']];
    for (const w of [...S.weights].sort((a, b) => new Date(a.date) - new Date(b.date))) rows.push([C.dayKey(w.date), time(w.date), num(w.kg, 2), w.note]);
    name = 'gewicht';
  } else {
    rows = [['Datum', 'Einheit', 'Übung', 'Satz', 'Aufwärmen', 'Gewicht kg', 'Wdh/Sek', 'RIR', 'Abgeschlossen', 'Notiz']];
    for (const w of [...S.workouts].sort((a, b) => new Date(a.started) - new Date(b.started)))
      for (const it of w.exercises) it.sets.forEach((s, i) => rows.push([C.dayKey(w.started), w.name, it.exercise.name, i + 1, s.warmup ? 'ja' : 'nein', s.weight != null ? numFlex(s.weight) : '', s.reps, s.rir ?? '', s.completed ? 'ja' : 'nein', it.note]));
    name = 'training';
  }
  return shareOrDownload(new Blob([C.csv(rows)], { type: 'text/csv;charset=utf-8' }), `MASSE-${name}-${C.dayKey(new Date())}.csv`);
}

// ---------------------------------------------------------------- Aktionen (Klicks)
const findPlan = id => S.plans.find(p => p.id === id);
const A = {
  tab: el => { closeAllSheets(); switchTab(el.dataset.tab); },
  closeSheet: () => closeSheet(),
  goTraining: () => (S.activeWorkout ? openWorkout() : switchTab('training')),
  hideInstall: () => { lsSet('masse.hideInstall', '1'); render(); },

  // Gewicht
  addWeight: () => weightSheet(),
  editWeight: el => weightSheet(S.weights.find(w => w.id === el.dataset.id)),
  weightList: () => openSheet({ kind: 'weightList', title: 'Messungen', live: true, body: weightListBody }),
  deleteWeight: async el => { if (await confirmBox('Messung löschen?', 'Löschen', true)) { await commit(s => { s.weights = s.weights.filter(w => w.id !== el.dataset.id); }); closeSheet(); } },

  // Supplemente
  logSupp: async el => {
    const sup = S.supplements.find(s => s.id === el.dataset.id);
    const log = { id: C.uid(), supplementID: sup.id, name: sup.name, dose: sup.dose, date: new Date().toISOString() };
    await commit(s => { s.supplementLogs.push(log); });
    toast(`${sup.name} abgehakt`, { label: 'Rückgängig', fn: () => commit(s => { s.supplementLogs = s.supplementLogs.filter(l => l.id !== log.id); }) });
  },
  newSupp: () => suppSheet(),
  editSupp: el => suppSheet(S.supplements.find(s => s.id === el.dataset.id)),
  deleteSupp: async el => { if (await confirmBox('Supplement löschen? Bisherige Einträge bleiben erhalten.', 'Löschen', true)) { await commit(s => { s.supplements = s.supplements.filter(x => x.id !== el.dataset.id); }); closeSheet(); } },

  // Training
  startWorkout: async el => {
    const p = findPlan(el.dataset.id);
    await commit(s => { s.activeWorkout = C.beginWorkout(p, s.workouts); });
    openWorkout();
  },
  openWorkout: () => openWorkout(),
  toggleSet: async el => {
    const i = +el.dataset.ex, j = +el.dataset.set;
    const wasDone = S.activeWorkout.exercises[i].sets[j].completed;
    await commit(s => { const st = s.activeWorkout.exercises[i].sets[j]; st.completed = !st.completed; });
    if (!wasDone) { startRest(); tickClocks(); }
  },
  toggleWarm: el => commit(s => { const st = s.activeWorkout.exercises[+el.dataset.ex].sets[+el.dataset.set]; st.warmup = !st.warmup; }),
  addSet: el => commit(s => { const it = s.activeWorkout.exercises[+el.dataset.ex]; const last = it.sets[it.sets.length - 1]; it.sets.push(C.trainingSet(last?.weight ?? it.exercise.seedWeight, last?.reps ?? it.exercise.low)); }),
  removeSet: el => commit(s => { s.activeWorkout.exercises[+el.dataset.ex].sets.pop(); }),
  applySugg: el => commit(s => { for (const st of s.activeWorkout.exercises[+el.dataset.ex].sets) if (!st.warmup && !st.completed) st.weight = Number(el.dataset.w); }),
  restAdd: () => { if (ui.rest) { ui.rest.end += 30000; ui.rest.total += 30; ui.rest.done = false; } else ui.rest = { end: Date.now() + 30000, total: 30 }; tickClocks(); },
  restStop: () => { ui.rest = null; tickClocks(); },
  finishWorkout: async () => {
    const open = S.activeWorkout.exercises.reduce((n, it) => n + it.sets.filter(s => !s.completed).length, 0);
    if (!(await confirmBox(open ? `Training abschließen? ${open} nicht abgehakte Sätze werden als unvollständig gespeichert.` : 'Training abschließen?', 'Abschließen'))) return;
    await commit(s => { const w = s.activeWorkout; w.ended = new Date().toISOString(); s.workouts.push(w); s.activeWorkout = null; });
    ui.rest = null;
    closeSheet(ui.sheets.find(x => x.kind === 'workout')?.id);
    toast('Training gespeichert. Stark!');
  },
  discardWorkout: async () => {
    if (!(await confirmBox('Laufendes Training und alle Sätze verwerfen?', 'Verwerfen', true))) return;
    await commit(s => { s.activeWorkout = null; });
    ui.rest = null;
    closeSheet(ui.sheets.find(x => x.kind === 'workout')?.id);
  },
  showWorkout: el => openSheet({ kind: 'workoutDetail', title: S.workouts.find(w => w.id === el.dataset.id).name, live: true, body: () => workoutDetailBody(el.dataset.id) }),
  deleteWorkout: async el => { if (await confirmBox('Diese Einheit endgültig löschen?', 'Löschen', true)) { await commit(s => { s.workouts = s.workouts.filter(w => w.id !== el.dataset.id); }); closeSheet(); } },

  // Planeditor
  editPlan: el => openPlanEditor(findPlan(el.dataset.id)),
  newPlan: () => openPlanEditor(null),
  exAdd: () => { draftPlan.exercises.push(C.exercise('Neue Übung', 3, 8, 12)); rerenderSheet('plan'); },
  exDelete: el => { draftPlan.exercises.splice(+el.dataset.i, 1); rerenderSheet('plan'); },
  exMove: el => { const i = +el.dataset.i, j = i + +el.dataset.d; const a = draftPlan.exercises; [a[i], a[j]] = [a[j], a[i]]; rerenderSheet('plan'); },
  deletePlan: async () => {
    if (!(await confirmBox(`„${draftPlan.name}“ löschen? Die Trainingshistorie bleibt erhalten.`, 'Löschen', true))) return;
    await commit(s => { s.plans = s.plans.filter(p => p.id !== draftPlan.id); });
    closeSheet();
  },

  // Ernährung
  foodDay: el => { const d = C.addDays(ui.foodDay, +el.dataset.d); if (d <= new Date()) { ui.foodDay = d; render(); } },
  openLibrary: () => openLibrary(),
  pickFood: el => amountSheet(S.foods.find(f => f.id === el.dataset.id)),
  setAmount: el => { const f = el.closest('form'); f.amount.value = inVal(Number(el.dataset.v)); updateAmountPreview(f); },
  editEntry: el => { const e = S.foodEntries.find(x => x.id === el.dataset.id); amountSheet(e.food, e); },
  deleteEntry: async el => {
    const entry = S.foodEntries.find(e => e.id === el.dataset.id);
    await commit(s => { s.foodEntries = s.foodEntries.filter(e => e.id !== entry.id); });
    closeSheet();
    toast('Eintrag gelöscht', { label: 'Rückgängig', fn: () => commit(s => { s.foodEntries.push(entry); }) });
  },
  quickShake: async () => {
    const shake = S.foods.find(f => f.recipe && f.name === 'Masseshake');
    if (!shake) return openLibrary();
    const d = C.sameDay(ui.foodDay, new Date()) || ui.tab !== 'food' ? new Date() : new Date(new Date(ui.foodDay).setHours(12));
    const entry = C.newFoodEntry(shake, shake.basisAmount, d, 'Shake');
    await commit(s => { s.foodEntries.push(entry); });
    toast(`Masseshake eingetragen (+${num(shake.macros.calories)} kcal)`, { label: 'Rückgängig', fn: () => commit(s => { s.foodEntries = s.foodEntries.filter(e => e.id !== entry.id); }) });
  },
  copyYesterday: async () => {
    const src = S.foodEntries.filter(e => C.sameDay(e.date, C.addDays(ui.foodDay, -1)));
    if (!(await confirmBox(`${src.length} Einträge vom Vortag auf ${C.sameDay(ui.foodDay, new Date()) ? 'heute' : dateLong(ui.foodDay)} kopieren?`, 'Kopieren'))) return;
    const ids = [];
    await commit(s => { for (const e of src) { const c = { ...structuredClone(e), id: C.uid(), date: C.addDays(e.date, 1).toISOString() }; ids.push(c.id); s.foodEntries.push(c); } });
    toast(`${ids.length} Einträge kopiert`, { label: 'Rückgängig', fn: () => commit(s => { s.foodEntries = s.foodEntries.filter(e => !ids.includes(e.id)); }) });
  },
  newFood: () => foodEditor(null, { name: $('#lib-q')?.value ?? '' }),
  editFood: el => foodEditor(S.foods.find(f => f.id === el.dataset.id)),
  deleteFood: async el => {
    if (!(await confirmBox('Lebensmittel aus dem Katalog löschen? Eingetragene Mahlzeiten bleiben erhalten.', 'Löschen', true))) return;
    await commit(s => { s.foods = s.foods.filter(f => f.id !== el.dataset.id); });
    closeSheet(); refreshLibrary();
  },
  scan: () => openScanner(),
  onlineSearch: async () => {
    const q = $('#lib-q')?.value ?? '';
    const box = $('#online-results');
    box.innerHTML = '<p class="muted center">Suche bei Open Food Facts …</p>';
    try {
      onlineCache = await onlineSearch(q);
      box.innerHTML = `<h3 class="sec">Open Food Facts</h3>` + (onlineCache.length
        ? `<div class="list">${onlineCache.map((f, i) => `<button type="button" class="li" data-act="pickOnline" data-i="${i}">${foodLabel(f)}${icon('plus')}</button>`).join('')}</div><p class="mini">Werte je 100 g/ml laut Open Food Facts (ODbL). Bitte mit dem Etikett vergleichen.</p>`
        : '<p class="muted center">Keine Produkte mit vollständigen Nährwerten gefunden.</p>');
    } catch (e) { box.innerHTML = ''; throw e; }
  },
  pickOnline: async el => {
    const f = onlineCache[+el.dataset.i];
    const existing = f.barcode && S.foods.find(x => x.barcode === f.barcode);
    if (existing) return amountSheet(existing);
    await commit(s => { s.foods.push(f); }, { render: false });
    refreshLibrary();
    amountSheet(S.foods.find(x => x.id === f.id));
  },

  // Fortschritt
  range: el => { ui.range = Number(el.dataset.v); lsSet('masse.range', String(ui.range)); render(); },
  plateauApply: async () => {
    if (!(await confirmBox('Tagesziel um 150 kcal und 37,5 g Kohlenhydrate erhöhen?', 'Erhöhen'))) return;
    await commit(s => { s.profile.goals.calories += 150; s.profile.goals.carbs += 37.5; });
    lsSet('masse.plateau', C.dayKey(new Date())); toast('Ziele angepasst.');
  },
  plateauDismiss: () => { lsSet('masse.plateau', C.dayKey(new Date())); render(); },
  addMeasure: () => measureSheet(),
  editMeasure: el => measureSheet(S.measurements.find(m => m.id === el.dataset.id)),
  deleteMeasure: async el => { if (await confirmBox('Messung löschen?', 'Löschen', true)) { await commit(s => { s.measurements = s.measurements.filter(m => m.id !== el.dataset.id); }); closeSheet(); } },
  compareMode: () => {
    if (ui.compare?.length === 2) { const ids = ui.compare; ui.compare = null; render(); return compareSheet(ids); }
    ui.compare = ui.compare ? null : []; render();
  },
  photo: el => {
    if (ui.compare) {
      const id = el.dataset.id;
      ui.compare = ui.compare.includes(id) ? ui.compare.filter(x => x !== id) : [...ui.compare, id].slice(-2);
      if (ui.compare.length === 2) { const ids = ui.compare; ui.compare = null; render(); return compareSheet(ids); }
      return render();
    }
    photoSheet(el.dataset.id);
  },
  deletePhoto: async el => {
    if (!(await confirmBox('Foto endgültig löschen?', 'Löschen', true))) return;
    const id = el.dataset.id;
    await commit(s => { s.photos = s.photos.filter(p => p.id !== id); });
    await DB.deletePhoto(id).catch(() => {});
    if (photoURLs.has(id)) { URL.revokeObjectURL(photoURLs.get(id)); photoURLs.delete(id); }
    closeSheet();
  },

  // Mehr
  exportBackup: () => exportBackup(),
  importBackup: () => importBackup(),
  csv: el => exportCSV(el.dataset.k),
  recoverPrevious: async () => {
    const prev = await DB.loadPrevious();
    if (!prev) throw new C.FitnessError('Keine frühere Version vorhanden.');
    const st = migrate(prev); C.validateState(st);
    if (!(await confirmBox('Letzte gültige Version laden? Die beschädigten Daten werden ersetzt.', 'Laden', true))) return;
    await DB.saveState(st); S = st; loadError = null; render(); toast('Daten wiederhergestellt.');
  },
  checkUpdate: async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) throw new C.FitnessError('Updates sind nur in der installierten bzw. online geladenen App verfügbar.');
    await reg.update();
    toast(reg.waiting || reg.installing ? 'Update wird geladen …' : 'Du hast die aktuelle Version.');
  },
  resetAll: async () => {
    if (!(await confirmBox('Wirklich ALLE Daten auf diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.', 'Weiter', true))) return;
    if (!(await confirmBox('Letzte Bestätigung: Training, Ernährung, Gewicht, Fotos und Einstellungen werden gelöscht.', 'Alles löschen', true))) return;
    await DB.clearAll();
    S = seedState(); await DB.saveState(S);
    photoURLs.clear(); ui.rest = null; closeAllSheets(); switchTab('home'); toast('Alle Daten gelöscht.');
  },
};

// ---------------------------------------------------------------- Formulare
const req = (v, label) => { const n = parseNum(v); if (!Number.isFinite(n)) throw new C.FitnessError(`Bitte ${label} als Zahl eingeben.`); return n; };
const opt = v => { const n = parseNum(v); return Number.isFinite(n) ? n : null; };
const F = {
  saveWeight: async (fd, form) => {
    const k = req(fd.get('kg'), 'das Gewicht');
    if (!(k > 20 && k < 400)) throw new C.FitnessError('Bitte ein realistisches Gewicht in kg eingeben.');
    const date = parseDt(fd.get('date')).toISOString(), note = String(fd.get('note') ?? '').trim();
    const id = form.dataset.id;
    await commit(s => {
      if (id) Object.assign(s.weights.find(w => w.id === id), { kg: k, date, note });
      else s.weights.push({ id: C.uid(), date, kg: k, note });
    });
    closeSheet(); toast(`${kg(k)} gespeichert`);
  },
  saveEntry: async (fd, form) => {
    const s0 = ui.sheets.find(x => x.kind === 'amount');
    const amount = req(fd.get('amount'), 'die Menge');
    const date = parseDt(fd.get('date')), meal = String(fd.get('meal'));
    const entryId = form.dataset.entry;
    if (entryId) {
      C.portion(s0.food, amount);
      await commit(s => { Object.assign(s.foodEntries.find(e => e.id === entryId), { amount, meal, date: date.toISOString() }); });
      closeSheet(); toast('Gespeichert');
    } else {
      const entry = C.newFoodEntry(s0.food, amount, date, meal);
      await commit(s => { s.foodEntries.push(entry); });
      while (ui.sheets.length && ['amount', 'library', 'foodEditor'].includes(ui.sheets[ui.sheets.length - 1].kind)) closeSheet();
      if (ui.tab === 'food' && !C.sameDay(ui.foodDay, date)) { ui.foodDay = date; render(); }
      toast(`${entry.food.name} hinzugefügt (+${num(C.entryTotals(entry).calories)} kcal)`, { label: 'Rückgängig', fn: () => commit(s => { s.foodEntries = s.foodEntries.filter(e => e.id !== entry.id); }) });
    }
  },
  saveFood: async (fd, form) => {
    const m = C.macros(req(fd.get('calories'), 'die Kalorien'), req(fd.get('protein'), 'das Protein'), req(fd.get('carbs'), 'die Kohlenhydrate'), req(fd.get('fat'), 'das Fett'));
    if (!C.macrosValid(m)) throw new C.FitnessError('Nährwerte dürfen nicht negativ sein.');
    const basisAmount = req(fd.get('basisAmount'), 'die Bezugsmenge');
    if (!(basisAmount > 0)) throw new C.FitnessError('Die Bezugsmenge muss größer als null sein.');
    const bc = String(fd.get('barcode') ?? '').trim();
    const barcode = bc ? C.normalizeBarcode(bc) : null;
    const ingredients = String(fd.get('ingredients') ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const mm = l.match(/^([\d.,]+)\s*(\S+)\s+(.+)$/);
      return mm ? { id: C.uid(), name: mm[3], amount: parseNum(mm[1]), unit: mm[2] } : { id: C.uid(), name: l, amount: 0, unit: '' };
    });
    const values = { name: String(fd.get('name')).trim(), brand: String(fd.get('brand') ?? '').trim(), basisAmount, unit: String(fd.get('unit')),
      macros: m, barcode, favorite: fd.get('favorite') === 'on', recipe: fd.get('recipe') === 'on', ingredients };
    if (!values.name) throw new C.FitnessError('Bitte einen Namen eingeben.');
    const id = form.dataset.id;
    if (barcode && S.foods.some(f => f.barcode === barcode && f.id !== id)) throw new C.FitnessError('Dieser Barcode gehört bereits zu einem anderen Lebensmittel.');
    let saved;
    await commit(s => {
      if (id) { saved = Object.assign(s.foods.find(f => f.id === id), values); }
      else { saved = C.newFood(values.name, m, values); s.foods.push(saved); }
    });
    closeSheet(); refreshLibrary();
    if (!id || form.dataset.then === '1') amountSheet(S.foods.find(f => f.id === saved.id));
    else toast('Gespeichert');
  },
  savePlan: async () => {
    const p = draftPlan;
    if (!p.name.trim()) throw new C.FitnessError('Bitte einen Namen eingeben.');
    for (const e of p.exercises) {
      if (!e.name.trim()) throw new C.FitnessError('Jede Übung braucht einen Namen.');
      if (!(e.sets >= 1 && e.sets <= 20)) throw new C.FitnessError(`${e.name}: 1–20 Sätze.`);
      if (!(e.low >= 1 && e.high >= e.low && e.high <= 999)) throw new C.FitnessError(`${e.name}: Wiederholungsbereich prüfen.`);
      if (!(e.increment >= 0 && e.increment <= 50)) throw new C.FitnessError(`${e.name}: Steigerung prüfen.`);
      if (e.seedWeight != null && !(e.seedWeight >= 0 && e.seedWeight < 1000)) throw new C.FitnessError(`${e.name}: Startgewicht prüfen.`);
      const orig = draftOriginal?.exercises.find(o => o.id === e.id);
      if (orig && (orig.name.trim() !== e.name.trim() || orig.basis !== e.basis || orig.timed !== e.timed)) e.id = C.uid();
      e.name = e.name.trim();
    }
    if (!(p.durationMinutes > 0 && p.durationMinutes < 600)) throw new C.FitnessError('Bitte eine gültige Dauer eingeben.');
    p.name = p.name.trim();
    await commit(s => { const i = s.plans.findIndex(x => x.id === p.id); if (i >= 0) s.plans[i] = p; else s.plans.push(p); });
    closeSheet(); toast('Plan gespeichert');
  },
  saveMeasure: async (fd, form) => {
    const m = { date: parseDt(fd.get('date')).toISOString(), note: String(fd.get('note') ?? '').trim() };
    for (const [k] of MEASURES) { const v = opt(fd.get(k)); if (v != null && !(v > 0 && v < 300)) throw new C.FitnessError('Bitte realistische Werte in cm eingeben.'); m[k] = v; }
    if (MEASURES.every(([k]) => m[k] == null)) throw new C.FitnessError('Bitte mindestens einen Wert eingeben.');
    const id = form.dataset.id;
    await commit(s => { s.measurements ??= []; if (id) Object.assign(s.measurements.find(x => x.id === id), m); else s.measurements.push({ id: C.uid(), ...m }); });
    closeSheet();
  },
  savePhoto: async (fd, form) => {
    const k = opt(fd.get('kg'));
    await commit(s => { Object.assign(s.photos.find(p => p.id === form.dataset.id), { date: parseDt(fd.get('date')).toISOString(), angle: String(fd.get('angle')), kg: k }); });
    closeSheet();
  },
  saveProfile: async fd => {
    const g = C.macros(req(fd.get('calories'), 'die Kalorien'), req(fd.get('protein'), 'das Protein'), req(fd.get('carbs'), 'die Kohlenhydrate'), req(fd.get('fat'), 'das Fett'));
    if (!C.macrosValid(g) || g.calories <= 0) throw new C.FitnessError('Bitte gültige Ziele eingeben.');
    const rest = Math.round(req(fd.get('restSeconds'), 'die Satzpause'));
    if (!(rest >= 0 && rest <= 900)) throw new C.FitnessError('Satzpause: 0–900 Sekunden.');
    await commit(s => {
      Object.assign(s.profile, { goals: g, heightCM: req(fd.get('heightCM'), 'die Größe'), startKG: req(fd.get('startKG'), 'das Startgewicht'),
        goalKG: req(fd.get('goalKG'), 'das Zielgewicht'), restSeconds: rest, trainingGoal: String(fd.get('trainingGoal') ?? '').trim() });
    });
    toast('Ziele gespeichert');
  },
  saveSupp: async (fd, form) => {
    const v = { name: String(fd.get('name')).trim(), dose: String(fd.get('dose') ?? '').trim(), note: String(fd.get('note') ?? '').trim(), paused: fd.get('paused') === 'on' };
    if (!v.name) throw new C.FitnessError('Bitte einen Namen eingeben.');
    const id = form.dataset.id;
    await commit(s => { if (id) Object.assign(s.supplements.find(x => x.id === id), v); else s.supplements.push({ id: C.uid(), ...v }); });
    closeSheet();
  },
  manualBarcode: async fd => {
    const code = String(fd.get('code') ?? '');
    C.normalizeBarcode(code);
    closeSheet(ui.sheets.find(s => s.kind === 'scanner')?.id);
    await handleBarcode(code);
  },
};

// ---------------------------------------------------------------- Änderungen in Feldern
const CH = {
  setField: (el) => {
    const i = +el.dataset.ex, j = +el.dataset.set, f = el.dataset.field;
    let v;
    if (f === 'weight') { v = opt(el.value); if (v != null && !(v >= 0 && v < 1000)) throw new C.FitnessError('Bitte ein gültiges Gewicht eingeben.'); }
    else if (f === 'reps') { v = Math.round(parseNum(el.value)); if (!(v >= 0 && v < 10000)) throw new C.FitnessError('Bitte gültige Wiederholungen eingeben.'); }
    else v = el.value === '' ? null : Number(el.value);
    return commit(s => { s.activeWorkout.exercises[i].sets[j][f] = v; }, { render: false });
  },
  exNote: el => commit(s => { s.activeWorkout.exercises[+el.dataset.ex].note = el.value.trim(); }, { render: false }),
  workoutNote: el => commit(s => { s.activeWorkout.note = el.value.trim(); }, { render: false }),
  e1rmEx: el => { ui.e1rmEx = el.value; render(); },
  toggleOnline: async el => {
    if (el.checked && !(await confirmBox('Online-Suche einschalten? Suchbegriffe und Barcodes werden dann auf deinen Wunsch an Open Food Facts gesendet. Deine Ernährungsdaten verlassen das Gerät nicht.', 'Einschalten'))) { el.checked = false; return; }
    await commit(s => { s.profile.onlineFoodEnabled = el.checked; });
  },
  addPhoto: async el => {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    toast('Foto wird gespeichert …');
    const blob = await compressImage(file);
    const id = C.uid();
    await DB.putPhoto(id, blob);
    try {
      await commit(s => { s.photos.push({ id, date: new Date().toISOString(), kg: C.latestWeight(s.weights)?.kg ?? null, angle: 'Front' }); });
    } catch (e) { await DB.deletePhoto(id).catch(() => {}); throw e; }
    toast('Foto gespeichert');
    DB.requestPersistence();
  },
};
const IN = {
  plan: el => {
    const path = el.dataset.path.split('.');
    let v = el.type === 'checkbox' ? el.checked : el.value;
    const t = el.dataset.type;
    if (el.dataset.path === 'time') { const [h, m] = String(v).split(':').map(Number); if (Number.isFinite(h)) { draftPlan.hour = h; draftPlan.minute = m || 0; } return; }
    if (t === 'int') v = Math.round(parseNum(v));
    else if (t === 'num') v = parseNum(v);
    else if (t === 'numOrNull') v = opt(v);
    let o = draftPlan;
    for (const k of path.slice(0, -1)) o = o[k];
    o[path[path.length - 1]] = v;
    if (el.dataset.path === 'volleyball') rerenderSheet('plan');
  },
  libSearch: el => { $('#lib-list').innerHTML = libraryList(el.value); },
  amountPreview: el => updateAmountPreview(el.closest('form')),
};
function refreshLibrary() {
  const list = $('#lib-list');
  if (list) list.innerHTML = libraryList($('#lib-q')?.value ?? '');
}

// ---------------------------------------------------------------- Ereignisse
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  run(() => fn(el, e));
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  document.activeElement?.blur?.();
  run(() => F[form.dataset.form](new FormData(form), form));
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) run(() => CH[el.dataset.change](el));
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el) run(() => IN[el.dataset.input](el));
});
// Enter in Satzfeldern springt zum nächsten Feld
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('.set input')) return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll('.set input')];
  const next = inputs[inputs.indexOf(e.target) + 1];
  if (next) next.focus(); else e.target.blur();
});

// ---------------------------------------------------------------- Start
const APP_VERSION = '1.0.0';
function migrate(st) {
  st = structuredClone(st);
  st.measurements ??= [];
  st.photos ??= [];
  st.supplementLogs ??= [];
  st.activeWorkout ??= null;
  st.lastBackup ??= null;
  st.profile = { ...seedState().profile, ...st.profile };
  return st;
}
async function boot() {
  try {
    const stored = await DB.loadState();
    if (stored) {
      try { S = migrate(stored); C.validateState(S); } catch (e) { loadError = e.message; S = migrate(stored); }
    } else {
      S = seedState();
      await DB.saveState(S);
    }
  } catch (e) {
    loadError = 'Der Speicher dieses Browsers ist nicht verfügbar (privates Surfen?). ' + (e?.message ?? '');
    S = seedState();
  }
  render();
  if (S.activeWorkout && ui.tab === 'training') openWorkout();
  setInterval(tickClocks, 1000);
  let lastDay = C.dayKey(new Date());
  setInterval(() => { const d = C.dayKey(new Date()); if (d !== lastDay) { lastDay = d; if (C.sameDay(ui.foodDay, C.addDays(new Date(), -1))) ui.foodDay = new Date(); render(); } }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickClocks(); if (!ui.sheets.length) render(); } });
  const persisted = await DB.requestPersistence();
  const est = await DB.storageEstimate();
  const info = () => { const el = $('#storage-info'); if (el && est) el.textContent = `Belegter Speicher: ${num((est.usage ?? 0) / 1048576, 1)} MB${persisted ? ' · dauerhaft gespeichert' : ''}`; };
  info(); new MutationObserver(info).observe($('#main'), { childList: true });
  registerSW();
}
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const prompt = w => toast('Neue Version verfügbar', { label: 'Aktualisieren', fn: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

// Für Tests
window.__masse = { get state() { return S; }, ui, commit, C };
boot();
