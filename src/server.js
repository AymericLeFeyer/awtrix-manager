import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as engine from './engine.js';
import { registry, describeTypes, maskConfig, mergeConfig } from './providers/index.js';
import * as icons from './icons.js';
import { slug, buildPayload } from './format.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const find = (list, id, what) => list.find((x) => x.id === id) ?? (() => { throw new HttpError(404, `${what} introuvable`); })();

const db = () => store.get();
const providerOf = (id) => find(db().providers, id, 'provider');
const deviceOf = (id) => find(db().devices, id, 'appareil');
const widgetOf = (id) => find(db().widgets, id, 'widget');

function snapshot() {
  const { mqtt, devices, providers, widgets } = db();
  return {
    mqtt: { url: mqtt.url, username: mqtt.username, password: mqtt.password ? '••••••••' : '', connected: engine.bus.connected, error: engine.bus.error },
    types: describeTypes(),
    devices: devices.map((d) => {
      const s = engine.deviceState.get(d.id);
      return { ...d, online: engine.isOnline(d.id), stats: s?.stats ?? null };
    }),
    providers: providers.map((p) => ({ ...p, config: maskConfig(p.type, p.config) })),
    widgets: widgets.map((w) => {
      const r = engine.runtime.get(w.id);
      return { ...w, runtime: r ? { text: r.payload.text, error: r.error, at: r.at } : null };
    }),
  };
}

function cleanWidget(input, id) {
  const name = slug(input.name || '');
  if (!name) throw bad('nom requis');
  if (db().widgets.some((w) => w.id !== id && w.name === name)) throw bad(`un widget « ${name} » existe déjà`);
  const isStatic = input.providerId === 'static';
  const p = isStatic ? { id: 'static' } : providerOf(input.providerId);
  if (!input.source || typeof input.source !== 'object') throw bad('source requise');
  if (isStatic && !String(input.source.text ?? '').trim()) throw bad('texte requis');
  const f = input.format ?? {};
  const devices = (input.devices ?? []).filter((d) => db().devices.some((x) => x.id === d));
  return {
    id: id ?? store.newId(),
    name,
    label: String(input.label || '').trim(),
    enabled: input.enabled !== false,
    providerId: p.id,
    source: isStatic ? { text: String(input.source.text) } : input.source,
    format: {
      template: String(f.template ?? '{value}'),
      decimals: f.decimals === '' || f.decimals == null ? undefined : Math.max(0, Math.min(6, Number(f.decimals))),
      compact: !!f.compact,
    },
    icon: String(input.icon ?? '').trim(),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '',
    rainbow: !!input.rainbow,
    center: !!input.center,
    noScroll: !!input.noScroll,
    duration: Math.max(0, Number(input.duration) || 0),
    refresh: Math.max(10, Number(input.refresh) || 300),
    devices,
  };
}

function cleanDevice(input, id) {
  const prefix = String(input.prefix || '').trim().replace(/^\/+|\/+$/g, '');
  if (!input.name?.trim() || !prefix) throw bad('nom et préfixe MQTT requis');
  if (/[+#\s]/.test(prefix)) throw bad('préfixe MQTT invalide');
  if (db().devices.some((d) => d.id !== id && d.prefix === prefix)) throw bad('ce préfixe est déjà utilisé');
  return { id: id ?? store.newId(), name: input.name.trim(), prefix, host: icons.cleanHost(input.host) };
}

const stats = (id) => engine.deviceState.get(id)?.stats;

// --- Routes -----------------------------------------------------------------
const routes = [];
const route = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/state', () => snapshot());

route('PUT', '/api/mqtt', ({ body }) => {
  const prev = db().mqtt;
  db().mqtt = {
    url: String(body.url || '').trim(),
    username: String(body.username || ''),
    password: body.password === '••••••••' ? prev.password : String(body.password || ''),
  };
  store.save();
  engine.applyConfig();
  return snapshot().mqtt;
});

// Appareils
route('POST', '/api/devices', ({ body }) => {
  const d = cleanDevice(body);
  db().devices.push(d);
  store.save();
  engine.applyConfig();
  return d;
});
route('PUT', '/api/devices/:id', ({ params, body }) => {
  const d = deviceOf(params.id);
  const next = cleanDevice(body, d.id);
  if (next.prefix !== d.prefix) {
    // Le préfixe change : les apps déposées sous l'ancien préfixe sont retirées, puis renvoyées sous le nouveau.
    for (const w of db().widgets) {
      try { if (w.devices.includes(d.id)) engine.bus.publish(`${d.prefix}/custom/${w.name}`, ''); } catch { /* broker indisponible */ }
    }
  }
  Object.assign(d, next);
  store.save();
  engine.applyConfig();
  engine.syncDevice(d.id);
  return d;
});
route('DELETE', '/api/devices/:id', ({ params }) => {
  const d = deviceOf(params.id);
  db().widgets.forEach((w) => {
    if (w.devices.includes(d.id)) {
      engine.removeSlots(w, { ...w, devices: w.devices.filter((x) => x !== d.id) });
      w.devices = w.devices.filter((x) => x !== d.id);
    }
  });
  db().devices = db().devices.filter((x) => x !== d);
  store.save();
  engine.applyConfig();
  return { ok: true };
});
route('POST', '/api/devices/:id/:action', async ({ params, body }) => {
  const d = deviceOf(params.id);
  const t = (sub) => `${d.prefix}/${sub}`;
  switch (params.action) {
    case 'power': engine.bus.publish(t('power'), { power: !!body.on }); break;
    case 'next': engine.bus.publish(t('nextapp'), ''); break;
    case 'previous': engine.bus.publish(t('previousapp'), ''); break;
    case 'brightness': engine.bus.publish(t('settings'), { ABRI: false, BRI: Math.max(0, Math.min(255, Number(body.value) || 0)) }); break;
    case 'notify': engine.bus.publish(t('notify'), { text: String(body.text || ''), icon: body.icon || undefined, duration: 5 }); break;
    case 'native': {
      // Apps natives de l'AWTRIX (heure, date, météo…) : réglage conservé par l'appareil lui-même.
      const keys = ['TIM', 'DAT', 'TEMP', 'HUM', 'BAT'];
      const flags = Object.fromEntries(keys.map((k) => [k, !!body[k]]));
      engine.bus.publish(t('settings'), flags);
      d.native = flags;
      store.save();
      break;
    }
    case 'reboot': engine.bus.publish(t('reboot'), ''); break;
    case 'sync': engine.syncDevice(d.id); break;
    case 'icons': return icons.listDeviceIcons(d, stats(d.id));
    case 'install-icon': await icons.installIcon(d, stats(d.id), String(body.id)); break;
    default: throw new HttpError(404, 'action inconnue');
  }
  return { ok: true };
});

// Providers
route('POST', '/api/providers', ({ body }) => {
  if (!registry[body.type]) throw bad('type inconnu');
  if (!body.name?.trim()) throw bad('nom requis');
  const p = { id: store.newId(), type: body.type, name: body.name.trim(), config: mergeConfig(body.type, body.config) };
  db().providers.push(p);
  store.save();
  return { ...p, config: maskConfig(p.type, p.config) };
});
route('PUT', '/api/providers/:id', ({ params, body }) => {
  const p = providerOf(params.id);
  if (!body.name?.trim()) throw bad('nom requis');
  p.name = body.name.trim();
  p.config = mergeConfig(p.type, body.config, p.config);
  store.save();
  return { ...p, config: maskConfig(p.type, p.config) };
});
route('DELETE', '/api/providers/:id', ({ params }) => {
  const p = providerOf(params.id);
  if (db().widgets.some((w) => w.providerId === p.id)) throw bad('des widgets utilisent ce provider');
  db().providers = db().providers.filter((x) => x !== p);
  store.save();
  return { ok: true };
});
route('GET', '/api/providers/:id/sources', async ({ params, query }) => {
  const p = providerOf(params.id);
  return registry[p.type].sources(p.config, query.get('q') || '');
});
route('POST', '/api/providers/:id/read', async ({ params, body }) => {
  const p = providerOf(params.id);
  return registry[p.type].read(p.config, body.source);
});
route('POST', '/api/providers/:id/action/:name', async ({ params }) => {
  const p = providerOf(params.id);
  if (!registry[p.type].action) throw bad('aucune action');
  return registry[p.type].action(p.config, params.name);
});

// Widgets
route('POST', '/api/widgets', ({ body }) => {
  const w = cleanWidget(body);
  db().widgets.push(w);
  store.save();
  engine.runWidget(w);
  return w;
});
route('PUT', '/api/widgets/:id', ({ params, body }) => {
  const w = widgetOf(params.id);
  const next = cleanWidget(body, w.id);
  const before = { ...w };
  Object.assign(w, next);
  engine.removeSlots(before, w);
  store.save();
  engine.runWidget(w);
  return w;
});
route('DELETE', '/api/widgets/:id', ({ params }) => {
  const w = widgetOf(params.id);
  engine.removeSlots(w, null);
  db().widgets = db().widgets.filter((x) => x !== w);
  engine.runtime.delete(w.id);
  store.save();
  return { ok: true };
});
route('POST', '/api/widgets/:id/refresh', async ({ params }) => {
  await engine.runWidget(widgetOf(params.id));
  return { ok: true };
});
// Aperçu d'un widget en cours d'édition, sans l'enregistrer ni rien publier.
route('POST', '/api/preview', async ({ body }) => {
  let reading;
  try { reading = await engine.readSource(body.providerId, body.source); } catch (e) { return { text: '???', error: e.message }; }
  return { text: buildPayload({ format: body.format, providerId: body.providerId }, reading).text, reading };
});

// Icônes
route('GET', '/api/icons/lametric/:id', ({ params }) => icons.lametric(params.id));
route('GET', '/api/icons/device/:id/:name', ({ params }) => icons.deviceIcon(deviceOf(params.id), stats(params.id), params.name));

// --- Serveur ----------------------------------------------------------------
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw bad('JSON invalide'); }
}

function serveStatic(res, pathname) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'route inconnue');
    const params = url.pathname.match(r.re).groups ?? {};
    const body = req.method === 'GET' ? {} : await readBody(req);
    const out = await r.handler({ params, body, query: url.searchParams });
    if (out?.data instanceof Buffer) {
      res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'max-age=86400' }).end(out.data);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out ?? { ok: true }));
    }
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(req.method, url.pathname, e);
    // `fetch failed` ne dit rien : la vraie raison (ECONNREFUSED, ETIMEDOUT, DNS…) est dans `cause`.
    const why = e.cause?.code || e.cause?.message;
    const message = why ? `${e.message} (${why})` : e.message;
    res.writeHead(e.status ?? 502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }));
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  store.load();
  engine.start();
  const port = Number(process.env.PORT) || 4444;
  server.listen(port, () => console.log(`awtrix-manager → http://localhost:${port}`));
}
