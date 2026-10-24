import { filesFromDrop, filesFromInput, isPng } from './files.js';
import { canSaveToFolder, downloadCsv, downloadFile, downloadZip, reportTable, saveToFolder } from './output.js';

const POOL_SIZE = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 6));
const LEVEL_NORMAL = 2;
const LEVEL_MAX = 4;
const PREF_KEY = 'pixel-art-optimizer:max';

const $ = (id) => document.getElementById(id);
const els = {
  start: $('start'),
  work: $('work'),
  dropzone: $('dropzone'),
  pickFolder: $('pick-folder'),
  pickFiles: $('pick-files'),
  startMessage: $('start-message'),
  maxCompression: $('max-compression'),
  statBefore: $('stat-before'),
  statAfter: $('stat-after'),
  statSaved: $('stat-saved'),
  statSavedBytes: $('stat-saved-bytes'),
  progressBar: $('progress-bar'),
  status: $('status'),
  actions: $('actions'),
  saveFolder: $('save-folder'),
  download: $('download'),
  showReport: $('show-report'),
  restart: $('restart'),
  report: $('report'),
  reportSummary: $('report-summary'),
  reportRows: $('report-rows'),
  reportTable: $('report-table'),
  reportClose: $('report-close'),
  reportCopy: $('report-copy'),
  reportCsv: $('report-csv'),
  alertUnsafe: $('alert-unsafe'),
  alertUnsafeText: $('alert-unsafe-text'),
  alertError: $('alert-error'),
  alertErrorText: $('alert-error-text'),
};

const STATUS_LABEL = {
  optimized: 'Optimized',
  kept: 'Unchanged',
  unsafe: 'Kept for safety',
  skipped: 'Skipped',
  error: 'Error',
};

let items = [];
let ignored = 0;
let runId = 0;
let workers = [];
let running = false;
let exported = false;

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
  return `${number.format(bytes / 1024 / 1024)} MB`;
}

const savedPercent = (before, after) => (before ? (1 - after / before) * 100 : 0);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function splitPath(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? { folder: '', name: path } : { folder: path.slice(0, index), name: path.slice(index + 1) };
}

function updateSummary() {
  const finished = items.filter((i) => i.result);
  const before = finished.reduce((sum, i) => sum + i.result.originalSize, 0);
  const after = finished.reduce((sum, i) => sum + i.result.size, 0);
  els.statBefore.textContent = finished.length ? formatSize(before) : '—';
  els.statAfter.textContent = finished.length ? formatSize(after) : '—';
  els.statSaved.textContent = finished.length ? `${number.format(savedPercent(before, after))}%` : '—';
  els.statSavedBytes.textContent = finished.length ? `${formatSize(before - after)} smaller` : '';
}

function updateProgress(done) {
  els.progressBar.style.width = `${(done / items.length) * 100}%`;
  updateSummary();

  if (done < items.length) {
    els.status.textContent = `Optimizing ${done + 1} of ${items.length}…`;
    return;
  }

  const count = (status) => items.filter((i) => (i.result?.status ?? 'error') === status).length;
  const optimized = count('optimized');
  const parts = [optimized ? `${optimized} optimized and verified pixel-identical` : '0 optimized'];
  if (count('kept')) parts.push(plural(count('kept'), 'was already optimal', 'were already optimal'));
  if (count('unsafe')) parts.push(`${count('unsafe')} kept as original for safety`);
  if (count('skipped')) parts.push(`${count('skipped')} skipped`);
  if (count('error')) parts.push(plural(count('error'), 'error', 'errors'));
  if (ignored) parts.push(plural(ignored, 'non-PNG file skipped', 'non-PNG files skipped'));
  els.status.textContent = `Done: ${parts.join(', ')}.`;
  showAlerts(count('unsafe'), count('error'));
}

function showAlerts(unsafe, errors) {
  const files = (n) => (n === 1 ? '1 file' : `${n} files`);
  els.alertUnsafe.hidden = !unsafe;
  els.alertUnsafeText.textContent = unsafe
    ? `⚠ ${files(unsafe)} couldn’t be optimized safely, so ${unsafe === 1 ? 'its original was' : 'their originals were'} kept unchanged.`
    : '';
  els.alertError.hidden = !errors;
  els.alertErrorText.textContent = errors
    ? `✕ ${files(errors)} couldn’t be processed and ${errors === 1 ? 'isn’t' : 'aren’t'} included in the download.`
    : '';
}

function newWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

const pending = new Set();

function runInWorker(worker, buffer, options) {
  return new Promise((resolve, reject) => {
    const settle = (fn, value) => {
      pending.delete(cancel);
      worker.onmessage = null;
      worker.onerror = null;
      fn(value);
    };
    const cancel = () => settle(reject, new Error('Cancelled'));
    pending.add(cancel);

    worker.onmessage = ({ data }) =>
      data.error ? settle(reject, new Error(data.error)) : settle(resolve, data.result);
    worker.onerror = (event) => {
      event.preventDefault();
      settle(reject, new Error(event.message || 'The worker stopped unexpectedly'));
    };
    worker.postMessage({ id: 0, buffer, options }, [buffer]);
  });
}

async function processAll() {
  const id = ++runId;
  const options = { level: els.maxCompression.checked ? LEVEL_MAX : LEVEL_NORMAL };
  const queue = [...items];
  let done = 0;

  running = true;
  updateProgress(0);
  workers = Array.from({ length: Math.min(POOL_SIZE, queue.length) }, newWorker);

  await Promise.all(
    workers.map(async (_, slot) => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const result = await runInWorker(workers[slot], await item.file.arrayBuffer(), options);
          if (id !== runId) return;
          item.bytes = new Uint8Array(result.buffer);
          item.result = result;
        } catch (error) {
          if (id !== runId) return;
          item.error = error.message;
          workers[slot].terminate();
          workers[slot] = newWorker();
        }
        updateProgress(++done);
      }
    }),
  );

  if (id !== runId) return;
  stopWorkers();
  running = false;
  showActions();
}

function stopWorkers() {
  workers.forEach((w) => w.terminate());
  workers = [];
  pending.forEach((cancel) => cancel());
}

let usedPaths = new Set();

function uniquePath(path) {
  let candidate = path;
  for (let n = 2; usedPaths.has(candidate.toLowerCase()); n++) {
    candidate = path.replace(/(\.png)$/i, ` (${n})$1`);
  }
  usedPaths.add(candidate.toLowerCase());
  return candidate;
}

function start(files) {
  const pngs = files.filter(({ path }) => isPng(path));
  if (!pngs.length) {
    els.startMessage.textContent = files.length
      ? 'No PNG files found in what you selected.'
      : 'Couldn’t read what you dropped. Try the “Choose folder” button instead.';
    els.startMessage.hidden = false;
    return;
  }

  pngs.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
  usedPaths = new Set();
  items = pngs.map(({ path, file }) => ({ path: uniquePath(path), file }));
  ignored = files.length - pngs.length;
  exported = false;

  els.startMessage.hidden = true;
  els.start.hidden = true;
  els.work.hidden = false;
  els.actions.hidden = true;
  processAll();
}

function reset() {
  runId++;
  stopWorkers();
  running = false;
  exported = false;
  items = [];
  ignored = 0;
  usedPaths = new Set();
  if (els.report.open) els.report.close();
  clearReport();
  els.progressBar.style.width = '0';
  els.statBefore.textContent = els.statAfter.textContent = els.statSaved.textContent = '—';
  els.statSavedBytes.textContent = '';
  els.status.textContent = '';
  showAlerts(0, 0);
  els.work.hidden = true;
  els.start.hidden = false;
}

function outputItems() {
  return items.filter((i) => i.bytes).map(({ path, bytes }) => ({ path, bytes }));
}

function zipName() {
  const tops = new Set(items.map((i) => i.path.split('/')[0]));
  const [top] = tops;
  return tops.size === 1 && items[0].path.includes('/') ? `${top} (optimized).zip` : 'optimized-pngs.zip';
}

function showActions() {
  const single = items.length === 1;
  els.download.textContent = single ? 'Download PNG' : 'Download ZIP';
  els.saveFolder.hidden = !canSaveToFolder || single;
  els.download.classList.toggle('primary', els.saveFolder.hidden);
  els.actions.hidden = false;
}

async function withBusy(button, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await task();
  } catch (error) {
    window.alert(`Couldn’t save: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

els.download.addEventListener('click', () =>
  withBusy(els.download, async () => {
    const out = outputItems();
    if (items.length === 1) downloadFile(out[0].bytes, splitPath(out[0].path).name);
    else downloadZip(out, zipName());
    exported = true;
  }),
);

els.saveFolder.addEventListener('click', () =>
  withBusy(els.saveFolder, async () => {
    if (await saveToFolder(outputItems())) {
      exported = true;
      els.status.textContent = 'Files saved to the chosen folder.';
    }
  }),
);

function cell(className, text = '') {
  const td = document.createElement('td');
  td.className = className;
  td.textContent = text;
  return td;
}

function reportData() {
  return items.map((item) => {
    const { folder, name } = splitPath(item.path);
    const r = item.result;
    return {
      folder,
      file: name,
      originalKB: (item.file.size / 1024).toFixed(2),
      optimizedKB: r ? (r.size / 1024).toFixed(2) : '',
      savings: r ? `${savedPercent(r.originalSize, r.size).toFixed(2)}%` : '',
      colors: r?.colors ?? '',
      status: STATUS_LABEL[r?.status ?? 'error'],
      note: item.error ?? r?.note ?? '',
    };
  });
}

function summaryItem(label, value, detail, tone = '') {
  const div = document.createElement('div');
  div.className = tone;
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  div.append(dt, dd);
  if (detail) {
    const small = document.createElement('dd');
    small.className = 'detail';
    small.textContent = detail;
    div.append(small);
  }
  return div;
}

let thumbObserver = null;
const thumbFiles = new WeakMap();
const thumbUrls = [];

function loadVisibleThumbs(entries) {
  for (const { isIntersecting, target } of entries) {
    if (!isIntersecting) continue;
    thumbObserver.unobserve(target);
    const url = URL.createObjectURL(thumbFiles.get(target));
    thumbUrls.push(url);
    target.src = url;
  }
}

function thumbCell(item) {
  const td = cell('col-thumb');
  const img = document.createElement('img');
  img.className = 'thumb';
  img.alt = '';
  img.decoding = 'async';
  img.onerror = () => img.remove();
  thumbFiles.set(img, item.file);
  thumbObserver.observe(img);
  td.append(img);
  return td;
}

function reportRow(item) {
  const { folder, name } = splitPath(item.path);
  const r = item.result;
  const statusKey = r?.status ?? 'error';
  const tr = document.createElement('tr');
  tr.dataset.status = statusKey;

  const badge = document.createElement('span');
  badge.className = `badge ${statusKey}`;
  badge.textContent = STATUS_LABEL[statusKey];
  const statusCell = cell('');
  statusCell.append(badge);

  const savedCell = cell('num', r?.status === 'optimized' ? `−${number.format(savedPercent(r.originalSize, r.size))}%` : '—');
  if (r?.status === 'optimized') savedCell.classList.add('saved');

  const fileCell = cell('report-file', name);
  const folderCell = cell('muted col-folder', folder || '—');
  const noteCell = cell('muted col-note', item.error ?? r?.note ?? '');
  fileCell.title = item.path;
  folderCell.title = folder;
  noteCell.title = noteCell.textContent;

  tr.append(
    thumbCell(item),
    fileCell,
    folderCell,
    cell('num col-before', formatSize(item.file.size)),
    cell('num col-after', r ? formatSize(r.size) : '—'),
    savedCell,
    cell('num col-colors', r?.colors ?? '—'),
    statusCell,
    noteCell,
  );
  return tr;
}

function openReport(focus) {
  const finished = items.filter((i) => i.result);
  const before = finished.reduce((sum, i) => sum + i.result.originalSize, 0);
  const after = finished.reduce((sum, i) => sum + i.result.size, 0);
  const count = (status) => items.filter((i) => (i.result?.status ?? 'error') === status).length;

  const summary = [
    summaryItem('Files', items.length),
    summaryItem('Optimized', count('optimized')),
    summaryItem('Already optimal', count('kept')),
  ];
  if (count('unsafe')) summary.push(summaryItem('Kept for safety', count('unsafe'), '', 'warn'));
  if (count('skipped')) summary.push(summaryItem('Skipped', count('skipped')));
  if (count('error')) summary.push(summaryItem('Errors', count('error'), '', 'bad'));
  summary.push(
    summaryItem('Before', formatSize(before)),
    summaryItem('After', formatSize(after)),
    summaryItem('Saved', `${number.format(savedPercent(before, after))}%`, `${formatSize(before - after)} smaller`),
  );

  els.reportSummary.replaceChildren(...summary);
  thumbObserver = new IntersectionObserver(loadVisibleThumbs, { root: els.reportTable, rootMargin: '200px 0px' });
  els.reportRows.replaceChildren(...items.map(reportRow));
  els.report.showModal();

  const target = focus && els.reportRows.querySelector(`tr[data-status="${focus}"]`);
  target?.scrollIntoView({ block: 'center' });
}

function clearReport() {
  thumbObserver?.disconnect();
  thumbObserver = null;
  thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbUrls.length = 0;
  els.reportSummary.replaceChildren();
  els.reportRows.replaceChildren();
}

els.showReport.addEventListener('click', () => openReport());

for (const button of document.querySelectorAll('.alert-link')) {
  button.addEventListener('click', () => openReport(button.dataset.status));
}
els.reportClose.addEventListener('click', () => els.report.close());
els.report.addEventListener('close', clearReport);
els.report.addEventListener('click', (event) => {
  if (event.target === els.report) els.report.close();
});

els.reportCopy.addEventListener('click', async () => {
  const label = els.reportCopy.textContent;
  try {
    await navigator.clipboard.writeText(reportTable(reportData(), '\t'));
    els.reportCopy.textContent = 'Copied!';
  } catch {
    els.reportCopy.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (els.reportCopy.textContent = label), 2000);
});

els.reportCsv.addEventListener('click', () => downloadCsv(reportData(), 'optimization-report.csv'));

els.restart.addEventListener('click', () => {
  if (running && !window.confirm('Images are still being optimized. Stop and start over?')) return;
  if (!running && !exported && !window.confirm('You haven’t saved the results yet. Start over anyway?')) return;
  reset();
});

function startFromInput(input) {
  const files = filesFromInput(input);
  input.value = '';
  start(files);
}

els.pickFolder.addEventListener('change', () => startFromInput(els.pickFolder));
els.pickFiles.addEventListener('change', () => startFromInput(els.pickFiles));

for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());

let dragDepth = 0;
els.dropzone.addEventListener('dragenter', () => {
  dragDepth++;
  els.dropzone.classList.add('dragging');
});
els.dropzone.addEventListener('dragleave', () => {
  if (--dragDepth === 0) els.dropzone.classList.remove('dragging');
});
els.dropzone.addEventListener('drop', async (event) => {
  dragDepth = 0;
  els.dropzone.classList.remove('dragging');
  start(await filesFromDrop(event.dataTransfer));
});

window.addEventListener('beforeunload', (event) => {
  if (running || (items.length && !exported)) event.preventDefault();
});

try {
  els.maxCompression.checked = localStorage.getItem(PREF_KEY) === '1';
} catch {}
els.maxCompression.addEventListener('change', () => {
  try {
    localStorage.setItem(PREF_KEY, els.maxCompression.checked ? '1' : '0');
  } catch {}
});
