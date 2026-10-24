import { encode } from 'fast-png';
import { describe, expect, it } from 'vitest';
import { countColors, decodeToRGBA16, readChunkTypes, samePixels } from './pixels.js';

const W = 5;
const H = 3;

function referenceRGBA() {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data.set([(i * 40) % 256, (i * 90) % 256, (i * 10) % 256, i % 4 === 0 ? 0 : 255], i * 4);
  }
  return data;
}

describe('decodeToRGBA16', () => {
  it('scales each 8-bit RGBA channel to 16 bits', () => {
    const png = encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]), channels: 4 });
    expect([...decodeToRGBA16(png).data]).toEqual([257, 514, 771, 65535]);
  });

  it('a 4-bit palette with transparency matches the original RGBA', () => {
    const rgba = referenceRGBA();
    const colors = Array.from({ length: W * H }, (_, i) => [...rgba.subarray(i * 4, i * 4 + 4)]);
    const palette = [...new Set(colors.map((c) => c.join()))]
      .map((key) => key.split(',').map(Number))
      .sort((a, b) => a[3] - b[3]);
    const indexes = colors.map((color) => palette.findIndex((c) => c.join() === color.join()));
    const bytesPerRow = Math.ceil(W / 2);
    const packed = new Uint8Array(bytesPerRow * H);
    indexes.forEach((index, i) => {
      const x = i % W;
      const y = Math.floor(i / W);
      packed[y * bytesPerRow + (x >> 1)] |= x % 2 === 0 ? index << 4 : index;
    });

    const indexed = encode({ width: W, height: H, data: packed, depth: 4, channels: 1, palette });
    const truecolor = encode({ width: W, height: H, data: rgba, channels: 4 });
    expect(samePixels(decodeToRGBA16(indexed), decodeToRGBA16(truecolor))).toBe(true);
  });

  it('expands 1-bit grayscale to black and white', () => {
    const png = encode({ width: 3, height: 1, data: new Uint8Array([0b10100000]), depth: 1, channels: 1 });
    const { data } = decodeToRGBA16(png);
    expect([data[0], data[4], data[8]]).toEqual([65535, 0, 65535]);
  });

  it('keeps full 16-bit RGB precision', () => {
    const png = encode({ width: 1, height: 1, data: new Uint16Array([1, 2, 65535]), depth: 16, channels: 3 });
    expect([...decodeToRGBA16(png).data]).toEqual([1, 2, 65535, 65535]);
  });
});

describe('samePixels', () => {
  const decode = (rgba) => decodeToRGBA16(encode({ width: W, height: H, data: rgba, channels: 4 }));

  it('ignores the color of fully transparent pixels', () => {
    const a = referenceRGBA();
    const b = referenceRGBA();
    b.set([9, 9, 9, 0], 0);
    expect(samePixels(decode(a), decode(b))).toBe(true);
  });

  it('detects a single changed channel in a visible pixel', () => {
    const a = referenceRGBA();
    const b = referenceRGBA();
    b[5] += 1;
    expect(samePixels(decode(a), decode(b))).toBe(false);
  });

  it('detects alpha differences', () => {
    const a = referenceRGBA();
    const b = referenceRGBA();
    b[7] = 254;
    expect(samePixels(decode(a), decode(b))).toBe(false);
  });
});

describe('countColors', () => {
  it('counts all transparent pixels as one color', () => {
    const rgba = new Uint8Array([1, 1, 1, 0, 2, 2, 2, 0, 5, 5, 5, 255]);
    const png = encode({ width: 3, height: 1, data: rgba, channels: 4 });
    expect(countColors(decodeToRGBA16(png))).toBe(2);
  });
});

describe('readChunkTypes', () => {
  it("lists chunks and rejects files that aren't PNG", () => {
    const png = encode({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]), channels: 4 });
    expect(readChunkTypes(png)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(() => readChunkTypes(new Uint8Array(20))).toThrow('Not a valid PNG file');
  });
});
