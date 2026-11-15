import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten, getPath, formatNumber, renderText, buildPayload, slug, slots } from '../src/format.js';
import { pngToGif } from '../src/png2gif.js';
import zlib from 'node:zlib';

test('flatten / getPath', () => {
  const data = { youtube: { total: { subscribers: 12 } }, channels: [{ name: 'a' }], x: null };
  const leaves = flatten(data);
  assert.deepEqual(leaves.map((l) => l.path), ['youtube.total.subscribers', 'channels.0.name', 'x']);
  assert.equal(getPath(data, 'youtube.total.subscribers'), 12);
  assert.equal(getPath(data, 'youtube.nope.deep'), undefined);
});

test('formatNumber', () => {
  assert.equal(formatNumber(12400, { compact: true }), '12.4k');
  assert.equal(formatNumber(1000, { compact: true }), '1k');
  assert.equal(formatNumber(3.14159), '3.14');
  assert.equal(formatNumber(3, { decimals: 1 }), '3.0');
  assert.equal(formatNumber(950, { compact: true }), '950');
});

test('renderText : gabarit, unité et valeur absente', () => {
  assert.equal(renderText({ format: { template: '{value}{unit}' } }, { value: '21.5', unit: '°C' }), '21.5°C');
  assert.equal(renderText({}, { value: null }), '???');
  assert.equal(renderText({ format: {} }, { value: 'on' }), 'on');
  assert.equal(renderText({ format: { compact: true } }, { value: 15000 }), '15k');
});

test('buildPayload', () => {
  const p = buildPayload({ icon: 6491, color: '#ff0000', duration: 60, format: {} }, { value: 5 });
  assert.deepEqual(p, { text: '5', icon: '6491', color: '#ff0000', duration: 60 });
});

test('slug / slots', () => {
  assert.equal(slug('Abonnés YouTube!'), 'abonnes-youtube');
  assert.equal(slots({ name: 'a', devices: ['d1', 'd2'] }).size, 2);
  assert.equal(slots({ name: 'a', devices: ['d1'], enabled: false }).size, 0);
});

test('PNG → GIF produit un GIF valide', () => {
  // PNG RGBA 2x2 minimal fabriqué à la main.
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).subarray(0, 18);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  const gif = pngToGif(png);
  assert.equal(gif.toString('ascii', 0, 6), 'GIF89a');
  assert.equal(gif[gif.length - 1], 0x3b);
});
