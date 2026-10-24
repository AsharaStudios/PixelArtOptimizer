import { decode } from 'fast-png';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function readChunkTypes(bytes) {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a valid PNG file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return types;
}

function unpackSamples(png) {
  const { data, depth, width, height, channels } = png;
  if (depth >= 8) return data;

  const perRow = width * channels;
  const bytesPerRow = Math.ceil((perRow * depth) / 8);
  const mask = (1 << depth) - 1;
  const samples = new Uint8Array(perRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < perRow; x++) {
      const bit = x * depth;
      const byte = data[y * bytesPerRow + (bit >> 3)];
      samples[y * perRow + x] = (byte >> (8 - depth - (bit & 7))) & mask;
    }
  }
  return samples;
}

export function decodeToRGBA16(bytes) {
  const png = decode(bytes);
  const { width, height, channels, depth, palette, transparency } = png;
  const samples = unpackSamples(png);
  const out = new Uint16Array(width * height * 4);

  if (palette) {
    for (let i = 0; i < width * height; i++) {
      const color = palette[samples[i]];
      if (!color) throw new Error('Palette index out of range');
      out[i * 4] = color[0] * 257;
      out[i * 4 + 1] = color[1] * 257;
      out[i * 4 + 2] = color[2] * 257;
      out[i * 4 + 3] = (color[3] ?? 255) * 257;
    }
    return { width, height, data: out };
  }

  const scale = 65535 / ((1 << depth) - 1);
  const hasAlpha = channels === 2 || channels === 4;
  const isGray = channels <= 2;

  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const r = samples[s];
    const g = isGray ? r : samples[s + 1];
    const b = isGray ? r : samples[s + 2];
    let a = hasAlpha ? samples[s + channels - 1] * scale : 65535;

    if (!hasAlpha && transparency) {
      const transparent = isGray
        ? r === transparency[0]
        : r === transparency[0] && g === transparency[1] && b === transparency[2];
      if (transparent) a = 0;
    }

    out[i * 4] = r * scale;
    out[i * 4 + 1] = g * scale;
    out[i * 4 + 2] = b * scale;
    out[i * 4 + 3] = a;
  }
  return { width, height, data: out };
}

export function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  const x = a.data;
  const y = b.data;
  for (let i = 0; i < x.length; i += 4) {
    if (x[i + 3] === 0 && y[i + 3] === 0) continue;
    if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) {
      return false;
    }
  }
  return true;
}

export function countColors({ data }) {
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      colors.add('transparente');
    } else {
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
    }
  }
  return colors.size;
}
