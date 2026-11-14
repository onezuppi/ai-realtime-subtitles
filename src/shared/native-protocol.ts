/** Messages between the extension and the companion program (see companion/ai_subtitles_companion/bridge.py). */

export const NATIVE_HOST = 'com.ai_realtime_subtitles.companion';

export interface NativeRequest {
  target: 'asr' | 'translate' | 'companion';
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

export interface NativeReply {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}
