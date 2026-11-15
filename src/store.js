import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'config.json');

const empty = () => ({
  mqtt: {
    url: process.env.MQTT_URL || '',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
  },
  devices: [],
  providers: [],
  widgets: [],
  notifications: [],
});

let db = empty();

export function load() {
  try {
    db = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    save();
  }
  return db;
}

export function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export const get = () => db;
export const newId = () => crypto.randomUUID().slice(0, 8);
