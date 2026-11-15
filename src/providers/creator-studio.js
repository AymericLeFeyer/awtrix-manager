import { cachedJson, getJson, pathSources, readPath, trimUrl } from './http.js';

// Icônes LaMetric que tu utilisais déjà dans awtrix-creator-counter.
const ICONS = { 'youtube.': '6491', 'instagram.': '8649', 'discord.': '25435' };

const load = (cfg) =>
  cachedJson(`cs:${cfg.url}`, 20_000, () => getJson(`${trimUrl(cfg.url)}/api/export`, { Authorization: `Bearer ${cfg.key}` }));

export default {
  type: 'creator-studio',
  label: 'Aylabs Creator Studio',
  fields: [
    { key: 'url', label: 'URL du studio', placeholder: 'http://192.168.68.87:3001' },
    { key: 'key', label: 'Clé API (Bearer)', secret: true },
  ],
  async sources(cfg, q) {
    return pathSources(await load(cfg), q).map((s) => ({
      ...s,
      icon: Object.entries(ICONS).find(([p]) => s.label.startsWith(p))?.[1],
    }));
  },
  async read(cfg, source) {
    return readPath(await load(cfg), source);
  },
  // Seul /api/export exige la clé : les routes de collecte sont ouvertes côté studio.
  async action(cfg, name) {
    if (name !== 'collect') throw new Error('action inconnue');
    const base = trimUrl(cfg.url);
    const results = await Promise.allSettled(
      ['/api/analytics/collect', '/api/instagram/collect', '/api/integrations/discord/collect'].map((p) =>
        fetch(base + p, { method: 'POST', signal: AbortSignal.timeout(60_000) }).then((r) => {
          if (!r.ok) throw new Error(`${p} → ${r.status}`);
        }),
      ),
    );
    return { errors: results.filter((r) => r.status === 'rejected').map((r) => r.reason.message) };
  },
  actions: [{ id: 'collect', label: 'Lancer une collecte' }],
};
