// Pour ajouter un provider : créer un module { type, label, fields, sources(cfg, q), read(cfg, source) }
// et l'ajouter ici. `read` renvoie { value, unit?, name? }.
import creatorStudio from './creator-studio.js';
import homeAssistant from './home-assistant.js';
import jsonHttp from './json-http.js';

const all = [creatorStudio, homeAssistant, jsonHttp];
export const registry = Object.fromEntries(all.map((p) => [p.type, p]));

export const describeTypes = () =>
  all.map(({ type, label, fields, actions }) => ({ type, label, fields, actions: actions ?? [] }));

/** Masque les champs secrets avant d'envoyer la config au navigateur. */
export function maskConfig(type, config) {
  const out = { ...config };
  for (const f of registry[type]?.fields ?? []) if (f.secret && out[f.key]) out[f.key] = '••••••••';
  return out;
}

/** Fusionne une config reçue du navigateur : un secret inchangé (masqué) garde sa valeur stockée. */
export function mergeConfig(type, incoming, previous = {}) {
  const out = {};
  for (const f of registry[type].fields) {
    const v = incoming?.[f.key] ?? '';
    out[f.key] = f.secret && v === '••••••••' ? previous[f.key] ?? '' : v;
  }
  return out;
}
