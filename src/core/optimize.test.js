import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import optimise, { init } from '@jsquash/oxipng/optimise.js';
import { encode } from 'fast-png';
import { beforeAll, describe, expect, it } from 'vitest';
import { optimizePng } from './optimize.js';
import { decodeToRGBA16, readChunkTypes, samePixels } from './pixels.js';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm');
  await init(readFileSync(wasm));
});

function uncompressedPng() {
  const width = 64;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const on = (i % width) >> 3 === i >> 9;
    data.set(on ? [200, 40, 40, 255] : [0, 0, 0, 0], i * 4);
  }
  return encode({ width, height, data, channels: 4 }, { zlib: { level: 0 } });
}

describe('optimizePng', () => {
  it('shrinks the file and the result is identical', async () => {
    const original = uncompressedPng();
    const result = await optimizePng(original, optimise);

    expect(result.status).toBe('optimized');
    expect(result.note).toBe('Verified pixel-identical');
    expect(result.size).toBeLessThan(original.length);
    expect(samePixels(decodeToRGBA16(original), decodeToRGBA16(result.bytes))).toBe(true);
  });

  it("returns the original when oxipng can't make it smaller", async () => {
    const once = (await optimizePng(uncompressedPng(), optimise)).bytes;
    const twice = await optimizePng(once, optimise);

    expect(twice.status).toBe('kept');
    expect(twice.bytes).toBe(once);
  });

  it("returns the original when the result isn't identical", async () => {
    const original = uncompressedPng();
    const lossy = async () => {
      const decoded = decodeToRGBA16(original);
      const rgba = Uint8Array.from(decoded.data, (v) => v >> 8);
      rgba[0] = 201;
      rgba[3] = 255;
      return encode({ width: decoded.width, height: decoded.height, data: rgba, channels: 4 }).buffer;
    };
    const result = await optimizePng(original, lossy);

    expect(result.status).toBe('unsafe');
    expect(result.bytes).toBe(original);
    expect(result.size).toBe(original.length);
  });

  it('leaves animated PNGs untouched', async () => {
    const png = uncompressedPng();
    const acTL = new Uint8Array([0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const animated = new Uint8Array([...png.subarray(0, 33), ...acTL, ...png.subarray(33)]);
    expect(readChunkTypes(animated)).toContain('acTL');

    const result = await optimizePng(animated, optimise);
    expect(result.status).toBe('skipped');
  });
});
