const isHidden = (path) => path.split('/').some((part) => part.startsWith('.'));

export const isPng = (path) => path.toLowerCase().endsWith('.png');

function readEntries(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walkEntry(entry, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ path: entry.fullPath.replace(/^\//, ''), file });
    return;
  }
  const reader = entry.createReader();
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await walkEntry(child, out);
  }
}

export async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);

  if (!entries.length) {
    return [...dataTransfer.files].map((file) => ({ path: file.name, file }));
  }

  const out = [];
  for (const entry of entries) await walkEntry(entry, out);
  return out.filter(({ path }) => !isHidden(path));
}

export function filesFromInput(input) {
  return [...input.files]
    .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
    .filter(({ path }) => !isHidden(path));
}
