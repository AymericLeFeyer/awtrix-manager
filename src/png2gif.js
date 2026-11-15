// Convertit un petit PNG (palette / RGB / RGBA 8 bits, non entrelacé) en GIF fixe.
// Le firmware AWTRIX n'accepte que GIF/JPG dans /ICONS, alors que la galerie LaMetric sert des PNG.
import zlib from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG invalide');
  let pos = 8, w, h, depth, ctype, interlace, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error('PNG non supporté (8 bits, non entrelacé uniquement)');
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!bpp) throw new Error('type de PNG non supporté');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ctype === 3) { const k = px[i]; r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2]; if (trns && k < trns.length) a = trns[k]; }
    else if (ctype === 0) r = g = b = px[i];
    else if (ctype === 4) { r = g = b = px[i * 2]; a = px[i * 2 + 1]; }
    else { r = px[i * bpp]; g = px[i * bpp + 1]; b = px[i * bpp + 2]; if (ctype === 6) a = px[i * 4 + 3]; }
    rgba.set([r, g, b, a], i * 4);
  }
  return { w, h, rgba };
}

export function encodeGif({ w, h, rgba }) {
  const colors = new Map(); // 0 = transparent
  const palette = [[0, 0, 0]];
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = rgba.subarray(i * 4, i * 4 + 4);
    if (a < 128) { idx[i] = 0; continue; }
    const key = (r << 16) | (g << 8) | b;
    if (!colors.has(key)) {
      if (palette.length >= 256) throw new Error('trop de couleurs');
      colors.set(key, palette.length); palette.push([r, g, b]);
    }
    idx[i] = colors.get(key);
  }
  let bits = 1; while ((1 << bits) < palette.length) bits++;
  const size = 1 << bits;
  const out = [Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0x80 | (bits - 1), 0, 0])];
  const pal = Buffer.alloc(size * 3);
  palette.forEach((c, i) => pal.set(c, i * 3));
  out.push(pal, Buffer.from([0x21, 0xf9, 4, 1, 0, 0, 0, 0, 0])); // transparence = index 0
  out.push(Buffer.from([0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0]));
  const minCode = Math.max(2, bits);
  out.push(Buffer.from([minCode]));
  const data = lzw(idx, minCode);
  for (let i = 0; i < data.length; i += 255) { const c = data.subarray(i, i + 255); out.push(Buffer.from([c.length]), c); }
  out.push(Buffer.from([0, 0x3b]));
  return Buffer.concat(out);
}

function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const bytes = []; let cur = 0, nbits = 0;
  const emit = (code, size) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { bytes.push(cur & 255); cur >>= 8; nbits -= 8; } };
  let size = minCode + 1, dict = new Map(), next = eoi + 1;
  emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); next = eoi + 1; size = minCode + 1; }
    prefix = k;
  }
  emit(prefix, size); emit(eoi, size);
  if (nbits > 0) bytes.push(cur & 255);
  return Buffer.from(bytes);
}

export const pngToGif = (png) => encodeGif(decodePng(png));
