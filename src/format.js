// Fonctions pures : mise en forme d'une valeur et construction du message AWTRIX.

/** Parcourt un JSON et liste ses feuilles : [{ path: 'youtube.total.subscribers', value: 123 }]. */
export function flatten(obj, prefix = '', out = [], depth = 0) {
  if (obj === null || obj === undefined) {
    if (prefix) out.push({ path: prefix, value: null });
    return out;
  }
  if (typeof obj !== 'object') {
    out.push({ path: prefix, value: obj });
    return out;
  }
  if (depth >= 6) return out;
  const entries = Array.isArray(obj) ? obj.slice(0, 20).map((v, i) => [String(i), v]) : Object.entries(obj);
  for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  return out;
}

/** Lit un chemin pointé (`a.b.0.c`) dans un objet. */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

export function formatNumber(n, { decimals, compact } = {}) {
  if (compact) {
    const abs = Math.abs(n);
    const [div, suffix] = abs >= 1e9 ? [1e9, 'G'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'k'] : [1, ''];
    const d = decimals ?? (div === 1 ? 0 : 1);
    return `${trim((n / div).toFixed(d))}${suffix}`;
  }
  if (decimals !== undefined && decimals !== null && decimals !== '') return Number(n).toFixed(Number(decimals));
  return Number.isInteger(n) ? String(n) : trim(n.toFixed(2));
}

const trim = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

/** Texte affiché pour une valeur brute. `null`/absent → « ??? », comme l'ancien outil. */
export function renderText(widget, { value, unit = '', name = '' }) {
  const f = widget.format ?? {};
  let shown = '???';
  if (value !== null && value !== undefined && value !== '') {
    const asNumber = typeof value === 'number' ? value : /^-?\d+([.,]\d+)?$/.test(String(value).trim()) ? Number(String(value).replace(',', '.')) : NaN;
    shown = Number.isNaN(asNumber) ? String(value) : formatNumber(asNumber, f);
  }
  const template = f.template || '{value}';
  return template.replaceAll('{value}', shown).replaceAll('{unit}', unit).replaceAll('{name}', name);
}

/** Message publié sur `<prefix>/custom/<nom>`. */
export function buildPayload(widget, reading) {
  const p = { text: renderText(widget, reading) };
  if (widget.icon) p.icon = String(widget.icon);
  if (widget.color) p.color = widget.color;
  if (widget.rainbow) p.rainbow = true;
  if (widget.center) p.center = true;
  if (widget.noScroll) p.noScroll = true;
  if (Number(widget.duration) > 0) p.duration = Number(widget.duration);
  return p;
}

/** Nom d'app AWTRIX sûr pour un topic MQTT. */
export const slug = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

/** Couples (appareil, nom d'app) occupés par un widget : sert à nettoyer ce qui disparaît. */
export function slots(widget) {
  if (!widget || widget.enabled === false) return new Set();
  return new Set((widget.devices ?? []).map((d) => `${d}\u0000${widget.name}`));
}
