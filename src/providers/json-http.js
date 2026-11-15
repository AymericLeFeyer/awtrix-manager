import { cachedJson, getJson, pathSources, readPath } from './http.js';

const parseHeaders = (text) =>
  Object.fromEntries(
    String(text || '').split('\n').map((l) => l.split(/:(.*)/s).map((x) => x?.trim())).filter(([k, v]) => k && v),
  );

const load = (cfg) => cachedJson(`json:${cfg.url}:${cfg.headers}`, 20_000, () => getJson(cfg.url, parseHeaders(cfg.headers)));

export default {
  type: 'json-http',
  label: 'API JSON (HTTP)',
  fields: [
    { key: 'url', label: 'URL (GET → JSON)', placeholder: 'https://api.example.com/stats' },
    { key: 'headers', label: 'En-têtes (un par ligne, « Nom: valeur »)', secret: true, multiline: true },
  ],
  async sources(cfg, q) {
    return pathSources(await load(cfg), q);
  },
  async read(cfg, source) {
    return readPath(await load(cfg), source);
  },
};
