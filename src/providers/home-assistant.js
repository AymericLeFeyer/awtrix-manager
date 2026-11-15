import { getJson, trimUrl } from './http.js';

const headers = (cfg) => ({ Authorization: `Bearer ${cfg.token}` });

export default {
  type: 'home-assistant',
  label: 'Home Assistant',
  fields: [
    { key: 'url', label: 'URL', placeholder: 'http://homeassistant.local:8123' },
    { key: 'token', label: 'Jeton d\'accès longue durée', secret: true },
  ],
  async sources(cfg, q) {
    const needle = (q || '').toLowerCase();
    const states = await getJson(`${trimUrl(cfg.url)}/api/states`, headers(cfg));
    return states
      .map((s) => ({
        source: { entity: s.entity_id },
        label: s.attributes?.friendly_name ? `${s.attributes.friendly_name} (${s.entity_id})` : s.entity_id,
        preview: `${s.state}${s.attributes?.unit_of_measurement ? ` ${s.attributes.unit_of_measurement}` : ''}`,
        unit: s.attributes?.unit_of_measurement || '',
      }))
      .filter((s) => s.label.toLowerCase().includes(needle))
      .slice(0, 200);
  },
  async read(cfg, source) {
    const s = await getJson(`${trimUrl(cfg.url)}/api/states/${encodeURIComponent(source.entity)}`, headers(cfg));
    const value = source.attribute ? s.attributes?.[source.attribute] : s.state;
    return {
      value: ['unavailable', 'unknown'].includes(value) ? null : value,
      unit: source.attribute ? '' : s.attributes?.unit_of_measurement || '',
      name: s.attributes?.friendly_name || '',
    };
  },
};
