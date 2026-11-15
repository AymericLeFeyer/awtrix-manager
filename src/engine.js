import * as store from './store.js';
import { Bus } from './bus.js';
import { registry } from './providers/index.js';
import { buildPayload, slots } from './format.js';

const TICK_MS = 10_000;
const ONLINE_MS = 90_000;

export const bus = new Bus();
/** Dernier résultat par widget : { payload, error, at, reading }. */
export const runtime = new Map();
/** État vu par MQTT pour chaque appareil : { stats, seen }. */
export const deviceState = new Map();

const lastRun = new Map();
const inFlight = new Set();

const provider = (id) => store.get().providers.find((p) => p.id === id);
const device = (id) => store.get().devices.find((d) => d.id === id);

export function applyConfig() {
  const { mqtt, devices } = store.get();
  bus.configure(mqtt);
  bus.setDevices(devices);
}

export function isOnline(id) {
  const s = deviceState.get(id);
  return !!s && Date.now() - s.seen < ONLINE_MS;
}

/** Lit une valeur : texte fixe (providerId « static ») ou provider configuré. */
export async function readSource(providerId, source) {
  if (providerId === 'static') return { value: source.text };
  const p = provider(providerId);
  if (!p) throw new Error('provider introuvable');
  return registry[p.type].read(p.config, source);
}

/** Lit la valeur chez le provider puis publie sur les appareils du widget. */
export async function runWidget(widget) {
  if (inFlight.has(widget.id)) return;
  inFlight.add(widget.id);
  lastRun.set(widget.id, Date.now());
  let reading = null, error = '';
  try {
    reading = await readSource(widget.providerId, widget.source);
  } catch (e) {
    // Valeur inaccessible : on affiche « ??? » plutôt que de laisser une valeur périmée.
    error = e.message;
  }
  try {
    runtime.set(widget.id, { reading, payload: buildPayload(widget, reading ?? { value: null }), at: Date.now(), error });
    publishWidget(widget);
  } catch (e) {
    runtime.get(widget.id).error = error || e.message; // broker indisponible : republié à la reconnexion
  } finally {
    inFlight.delete(widget.id);
  }
}

/** Publie le dernier message connu du widget (sans relire le provider). */
export function publishWidget(widget, onlyDevices) {
  const r = runtime.get(widget.id);
  if (!r || widget.enabled === false) return;
  for (const id of widget.devices ?? []) {
    if (onlyDevices && !onlyDevices.includes(id)) continue;
    const d = device(id);
    if (d) bus.publish(`${d.prefix}/custom/${widget.name}`, r.payload);
  }
}

/** Retire des appareils les apps qui ne sont plus portées par un widget. */
export function removeSlots(before, after) {
  const keep = slots(after);
  for (const s of slots(before)) {
    if (keep.has(s)) continue;
    const [id, name] = s.split('\u0000');
    const d = device(id);
    try { if (d) bus.publish(`${d.prefix}/custom/${name}`, ''); } catch { /* broker indisponible */ }
  }
}

/** Les apps custom vivent en RAM : après un redémarrage de l'AWTRIX, on les renvoie. */
export function syncDevice(id) {
  for (const w of store.get().widgets) {
    if ((w.devices ?? []).includes(id)) {
      try { publishWidget(w, [id]); } catch { /* broker indisponible */ }
    }
  }
}

export function start() {
  applyConfig();
  bus.on('stats', (id, stats) => {
    const prev = deviceState.get(id);
    const wasOffline = !prev || Date.now() - prev.seen >= ONLINE_MS;
    const rebooted = prev && stats.uptime !== undefined && prev.stats?.uptime > stats.uptime;
    deviceState.set(id, { stats, seen: Date.now() });
    if (wasOffline || rebooted) syncDevice(id);
  });
  bus.on('connect', () => store.get().devices.forEach((d) => syncDevice(d.id)));

  const tick = () => {
    for (const w of store.get().widgets) {
      if (w.enabled === false) continue;
      const every = Math.max(10, Number(w.refresh) || 300) * 1000;
      if (Date.now() - (lastRun.get(w.id) ?? 0) >= every) runWidget(w);
    }
  };
  tick();
  setInterval(tick, TICK_MS).unref();
}
