import { ASR_ENGINES, MT_ENGINES, requiresDownload, sourceLanguageProblem } from '../backends/browser/engines';
import { isDownloaded } from '../backends/browser/models/model-store';
import { effectiveMtEngine, type Settings } from '../shared/settings';

/**
 * Models are never downloaded behind the user's back: the user starts every download on the settings page.
 * The check lives here because the offscreen document has no access to chrome.storage.
 */
export async function requireDownloaded(settings: Settings): Promise<void> {
  const asr = ASR_ENGINES[settings.asrEngine];
  const mt = MT_ENGINES[effectiveMtEngine(settings)];
  const missing: string[] = [];
  if (!(await isDownloaded({ kind: 'asr', id: asr.id }))) missing.push(asr.label);
  if (requiresDownload(mt) && !(await isDownloaded({ kind: 'mt', id: mt.id }))) missing.push(mt.label);
  if (missing.length) throw new Error(`Download first in Settings: ${missing.join(', ')}`);
  const problem = sourceLanguageProblem(asr, settings.sourceLang);
  if (problem) throw new Error(problem);
}
