import { flatten, getPath } from '../format.js';

export async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).pathname}`);
  return res.json();
}

// Petit cache pour qu'un cycle de rafraîchissement ne tape qu'une fois la même URL.
const cache = new Map();
export async function cachedJson(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export const trimUrl = (u) => String(u || '').replace(/\/+$/, '');

/** Sources « chemin JSON » : partagées par Creator Studio et le provider HTTP générique. */
export function pathSources(json, q) {
  const needle = (q || '').toLowerCase();
  return flatten(json)
    .filter((l) => l.value !== null && typeof l.value !== 'object' && l.path.toLowerCase().includes(needle))
    .slice(0, 200)
    .map((l) => ({ source: { path: l.path }, label: l.path, preview: String(l.value) }));
}

export const readPath = (json, source) => {
  const value = getPath(json, source.path);
  return { value: value === undefined ? null : value };
};
