import optimise from '@jsquash/oxipng/optimise.js';
import { optimizePng } from './core/optimize.js';

self.onmessage = async ({ data: { id, buffer, options } }) => {
  try {
    const { bytes, ...result } = await optimizePng(new Uint8Array(buffer), optimise, options);
    self.postMessage({ id, result: { ...result, buffer: bytes.buffer } }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
