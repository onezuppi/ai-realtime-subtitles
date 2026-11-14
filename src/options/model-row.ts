import { requiresDownload } from '../backends/browser/engines';
import { downloadModel } from '../backends/browser/models/model-download';
import { downloadedBytes, engineOf, isDownloaded, removeModel, type ModelRef } from '../backends/browser/models/model-store';
import { formatBytes, formatMB } from '../ui/format';
import type { OptionsContext } from './options-context';

export interface ModelRow {
  ref: ModelRef;
  refresh(): Promise<void>;
  isDownloading(): boolean;
}

type StatusKind = 'info' | 'ok' | 'error';

const ROW_HTML = (kind: string) => `
  <div class="model-head">
    <label><input type="radio" name="${kind}-engine" /><span class="name"></span></label>
    <div class="model-actions">
      <button class="btn btn-primary download" type="button">Download</button>
      <button class="btn cancel" type="button" hidden>Cancel</button>
      <button class="btn remove" type="button" hidden>Remove</button>
    </div>
  </div>
  <div class="model-meta"></div>
  <div class="bar" hidden><div></div></div>
  <div class="model-status" role="status"></div>`;

/** One model of the Browser mode: choose it, download it, cancel the download, remove the files. */
export function createModelRow(container: HTMLElement, ref: ModelRef, ctx: OptionsContext, onSelected: () => void): ModelRow {
  const engine = engineOf(ref);
  const root = document.createElement('div');
  root.className = 'model';
  root.innerHTML = ROW_HTML(ref.kind);
  const part = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T;
  const [status, bar, fill, radio] = [part('.model-status'), part('.bar'), part('.bar > div'), part<HTMLInputElement>('input')];
  const [download, cancel, remove] = [part<HTMLButtonElement>('.download'), part<HTMLButtonElement>('.cancel'), part<HTMLButtonElement>('.remove')];
  part('.name').textContent = engine.sizeMB ? `${engine.label}  ·  ${formatMB(engine.sizeMB)}` : engine.label;
  part('.model-meta').textContent = `${engine.languages}. ${engine.note}`;
  let controller: AbortController | undefined;

  const setStatus = (text: string, kind: StatusKind = 'info') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  async function refresh() {
    const downloading = Boolean(controller);
    const hasFiles = requiresDownload(engine);
    const ready = await isDownloaded(ref);
    download.hidden = !hasFiles || ready || downloading;
    cancel.hidden = !downloading;
    remove.hidden = !hasFiles || !ready || downloading;
    bar.hidden = !downloading;
    radio.disabled = hasFiles && !ready;
    const selected = ctx.settings()[ref.kind === 'asr' ? 'asrEngine' : 'mtEngine'] === ref.id;
    root.dataset.selected = String(selected);
    radio.checked = selected;
    if (downloading) return;
    if (!hasFiles) setStatus('');
    else if (ready) {
      const bytes = await downloadedBytes(ref);
      setStatus(`Ready${bytes ? `, ${formatBytes(bytes)} on disk` : ''}. Works offline.`, 'ok');
    } else if (engine.needsWebGpu && !('gpu' in navigator)) setStatus('Needs WebGPU, which this browser does not have', 'error');
    else setStatus('Not downloaded');
  }

  function showProgress(loadedBytes: number, totalBytes: number, started: number) {
    // Small files arrive first and would show 100% too early, so measure against the known model size.
    const expected = Math.max(totalBytes, engine.sizeMB * 1e6);
    const ratio = Math.min(loadedBytes / expected, 1);
    fill.style.width = `${Math.round(ratio * 100)}%`;
    const seconds = (performance.now() - started) / 1000;
    const speed = seconds > 1 ? ` at ${(loadedBytes / 1e6 / seconds).toFixed(1)} MB/s` : '';
    setStatus(`${Math.round(ratio * 100)}%, ${formatBytes(loadedBytes)} of ${formatBytes(expected)}${speed}`);
  }

  async function startDownload() {
    controller = new AbortController();
    setStatus('Starting the download...');
    fill.style.width = '0%';
    await refresh();
    const started = performance.now();
    try {
      await downloadModel(ref, ctx.settings().modelHost, p => showProgress(p.loadedBytes, p.totalBytes, started), controller.signal);
      controller = undefined;
    } catch (error) {
      controller = undefined;
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      await refresh();
      setStatus(cancelled ? 'Cancelled. Press Download to continue where it stopped.' : `Download failed: ${error instanceof Error ? error.message : String(error)}`, cancelled ? 'info' : 'error');
      return;
    }
    await refresh();
  }

  download.addEventListener('click', () => void startDownload());
  cancel.addEventListener('click', () => controller?.abort());
  remove.addEventListener('click', async () => {
    await removeModel(ref);
    await refresh();
  });
  radio.addEventListener('change', async () => {
    await ctx.update(ref.kind === 'asr' ? { asrEngine: ref.id } : { mtEngine: ref.id });
    onSelected();
  });
  container.append(root);
  void refresh();
  return { ref, refresh, isDownloading: () => Boolean(controller) };
}
