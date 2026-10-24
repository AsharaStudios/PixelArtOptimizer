import { zipSync } from 'fflate';

export const canSaveToFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadZip(items, name) {
  const tree = {};
  for (const { path, bytes } of items) tree[path] = [bytes, { level: 0 }];
  download(new Blob([zipSync(tree)], { type: 'application/zip' }), name);
}

export function downloadFile(bytes, name) {
  download(new Blob([bytes], { type: 'image/png' }), name);
}

export async function saveToFolder(items) {
  let root;
  try {
    root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'optimized' });
  } catch (error) {
    if (error.name === 'AbortError') return false;
    throw error;
  }

  const existing = await root.keys().next();
  if (!existing.done) {
    const ok = window.confirm(
      'The chosen folder isn’t empty. Files with the same name will be replaced.\n\nContinue?',
    );
    if (!ok) return false;
  }

  for (const { path, bytes } of items) {
    const parts = path.split('/');
    const fileName = parts.pop();
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }
  return true;
}

export const REPORT_COLUMNS = ['folder', 'file', 'originalKB', 'optimizedKB', 'savings', 'colors', 'status', 'note'];

function field(value, separator) {
  const text = String(value ?? '');
  return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportTable(rows, separator) {
  return [REPORT_COLUMNS, ...rows.map((r) => REPORT_COLUMNS.map((c) => r[c]))]
    .map((row) => row.map((value) => field(value, separator)).join(separator))
    .join('\r\n');
}

export function downloadCsv(rows, name) {
  download(new Blob(['﻿' + reportTable(rows, ',') + '\r\n'], { type: 'text/csv;charset=utf-8' }), name);
}
