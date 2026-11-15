import { pngToGif } from './png2gif.js';

const THUMB = (id) => `https://developer.lametric.com/content/apps/icon_thumbs/${encodeURIComponent(id)}`;
const cache = new Map();

/** Image d'une icône de la galerie LaMetric (PNG ou GIF), mise en cache. */
export async function lametric(id) {
  if (!/^\d+$/.test(id)) throw new Error('identifiant LaMetric invalide');
  if (cache.has(id)) return cache.get(id);
  const res = await fetch(THUMB(id), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error(`icône ${id} introuvable`);
  const out = { type: res.headers.get('content-type'), data: Buffer.from(await res.arrayBuffer()) };
  cache.set(id, out);
  return out;
}

/** Accepte « 192.168.1.5 », « http://192.168.1.5/ »… et ne garde que hôte[:port]. */
export const cleanHost = (h) => String(h || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
const hostOf = (d, stats) => cleanHost(d.host) || stats?.ip_address;

/** Icônes présentes sur l'appareil (/ICONS), via l'explorateur de fichiers du firmware. */
export async function listDeviceIcons(d, stats) {
  const host = hostOf(d, stats);
  if (!host) throw new Error('adresse IP de l\'appareil inconnue');
  const res = await fetch(`http://${host}/list?dir=/ICONS`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`l'appareil répond ${res.status}`);
  const files = await res.json();
  return files
    .filter((f) => f.type !== 'dir' && /\.(gif|jpe?g)$/i.test(f.name))
    .map((f) => f.name.split('/').pop().replace(/\.[^.]+$/, ''));
}

export async function deviceIcon(d, stats, name) {
  const host = hostOf(d, stats);
  for (const ext of ['gif', 'jpg']) {
    const res = await fetch(`http://${host}/ICONS/${encodeURIComponent(name)}.${ext}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return { type: res.headers.get('content-type') || `image/${ext}`, data: Buffer.from(await res.arrayBuffer()) };
  }
  throw new Error('icône absente de l\'appareil');
}

/** Télécharge l'icône LaMetric et la dépose dans /ICONS de l'appareil (comme la page Icônes d'AWTRIX). */
export async function installIcon(d, stats, id) {
  const host = hostOf(d, stats);
  if (!host) throw new Error('adresse IP de l\'appareil inconnue');
  const img = await lametric(id).catch((e) => { throw new Error(`galerie LaMetric injoignable : ${e.cause?.code || e.message}`); });
  const gif = img.type.includes('gif') ? img.data : pngToGif(img.data);
  const form = new FormData();
  form.append('file', new Blob([gif], { type: 'image/gif' }), `/ICONS/${id}.gif`);
  const res = await fetch(`http://${host}/edit`, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) })
    .catch((e) => { throw new Error(`appareil ${host} injoignable depuis le serveur : ${e.cause?.code || e.message}`); });
  if (!res.ok) throw new Error(`l'appareil a refusé l'envoi (${res.status})`);
}
