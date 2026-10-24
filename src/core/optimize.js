import { countColors, decodeToRGBA16, readChunkTypes, samePixels } from './pixels.js';

const COLOR_CHUNKS = ['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP'];

export async function optimizePng(bytes, optimise, { level = 3, optimiseAlpha = false } = {}) {
  const chunks = readChunkTypes(bytes);
  const base = { originalSize: bytes.length, size: bytes.length, bytes, colors: null };

  if (chunks.includes('acTL')) {
    return { ...base, status: 'skipped', note: 'Animated PNG, left as is' };
  }

  const original = decodeToRGBA16(bytes);
  base.colors = countColors(original);

  const copy = bytes.slice().buffer;
  const result = new Uint8Array(await optimise(copy, { level, optimiseAlpha }));

  if (result.length >= bytes.length) {
    return { ...base, status: 'kept', note: 'Already optimal' };
  }

  const resultChunks = readChunkTypes(result);
  const lostColorChunk = COLOR_CHUNKS.find((c) => chunks.includes(c) && !resultChunks.includes(c));
  if (lostColorChunk) {
    return { ...base, status: 'unsafe', note: `Original kept: optimizing would have lost its color profile (${lostColorChunk})` };
  }

  if (!samePixels(original, decodeToRGBA16(result))) {
    return { ...base, status: 'unsafe', note: 'Original kept: the optimized version wasn’t pixel-identical' };
  }

  return { ...base, status: 'optimized', note: 'Verified pixel-identical', size: result.length, bytes: result };
}
