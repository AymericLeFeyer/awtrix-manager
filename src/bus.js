import mqtt from 'mqtt';
import { EventEmitter } from 'node:events';

/** Connexion MQTT unique vers le broker auquel sont reliés les AWTRIX. */
export class Bus extends EventEmitter {
  client = null;
  settingsKey = '';
  connected = false;
  error = '';
  prefixes = new Map(); // prefix -> deviceId

  configure(settings) {
    const key = JSON.stringify(settings);
    if (key === this.settingsKey) return;
    this.settingsKey = key;
    this.client?.end(true);
    this.client = null;
    this.connected = false;
    this.error = '';
    if (!settings.url) return;
    const client = mqtt.connect(settings.url, {
      username: settings.username || undefined,
      password: settings.password || undefined,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    });
    this.client = client;
    client.on('connect', () => {
      this.connected = true;
      this.error = '';
      this.#subscribe();
      this.emit('connect');
    });
    client.on('close', () => { this.connected = false; });
    client.on('error', (e) => { this.error = e.message || String(e); });
    client.on('message', (topic, buf) => {
      const prefix = topic.slice(0, topic.lastIndexOf('/'));
      const id = this.prefixes.get(prefix);
      if (!id || !topic.endsWith('/stats')) return;
      try { this.emit('stats', id, JSON.parse(buf.toString())); } catch { /* message non JSON : ignoré */ }
    });
  }

  setDevices(devices) {
    const old = new Set(this.prefixes.keys());
    this.prefixes = new Map(devices.map((d) => [d.prefix, d.id]));
    if (this.connected) {
      const gone = [...old].filter((p) => !this.prefixes.has(p)).map((p) => `${p}/stats`);
      if (gone.length) this.client.unsubscribe(gone);
      this.#subscribe();
    }
  }

  #subscribe() {
    const topics = [...this.prefixes.keys()].map((p) => `${p}/stats`);
    if (topics.length) this.client.subscribe(topics);
  }

  publish(topic, payload) {
    if (!this.client || !this.connected) throw new Error(this.error || 'MQTT non connecté');
    this.client.publish(topic, payload === '' || payload === null ? '' : JSON.stringify(payload));
  }
}
