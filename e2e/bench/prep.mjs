// Builds segments.json for the browser benchmark: reference-subtitle cuts of real clips plus Russian TTS sentences.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const REF = 'C:/Users/pax20/AppData/Local/Temp/claude/220375e4fb6667ce/3f516cc0-7276-4acf-babf-214ee18a1a68/scratchpad/tune/ref/';
const PER_CLIP = Number(process.env.PER_CLIP ?? 10);
const ts = t => { const [h, m, s] = t.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +s; };
const clips = [];
for (const [clip, lang] of [['de1', 'de'], ['es1', 'es'], ['ja1', 'ja'], ['zh1', 'zh']]) {
  const wav = readFileSync(REF + clip + '.wav');
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
  const srt = readdirSync(REF).find(f => f.startsWith(clip + '.') && f.endsWith('.srt'));
  const cues = readFileSync(REF + srt, 'utf8').replace(/\r/g, '').split(/\n\n+/).map(b => {
    const l = b.split('\n'); const i = l.findIndex(x => x.includes('-->')); if (i < 0) return null;
    const [a, c] = l[i].split('-->');
    return { t0: ts(a.trim()), t1: ts(c.trim().split(' ')[0]), text: l.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\[[^\]]*\]|\([^)]*\)|♪/g, '').trim() };
  }).filter(c => c && c.t1 <= 300 && c.t1 - c.t0 >= 1.5 && c.t1 - c.t0 <= 10 && c.text.length >= 6);
  const step = Math.max(1, Math.floor(cues.length / PER_CLIP));
  const picked = cues.filter((_, i) => i % step === 0).slice(0, PER_CLIP);
  clips.push({ clip, lang, segments: picked.map(c => {
    const f = Float32Array.from(pcm.subarray(Math.floor(c.t0 * 16000), Math.floor(c.t1 * 16000)), v => v / 32768);
    return { ref: c.text, seconds: +(c.t1 - c.t0).toFixed(2), b64: Buffer.from(f.buffer).toString('base64') };
  }) });
}
const ru = JSON.parse(readFileSync(new URL('./ru.json', import.meta.url)));
clips.push({ clip: 'ru-tts', lang: 'ru', segments: ru.map(s => ({ ref: s.ref, seconds: +(Buffer.from(s.b64, 'base64').length / 4 / 16000).toFixed(2), b64: s.b64 })) });
const SNR = Number(process.env.SNR_DB ?? 0);
if (SNR) {
  // Adds white noise at the given signal-to-noise ratio, so the test shows how the models cope with a dirty recording.
  for (const clip of clips) for (const s of clip.segments) {
    const f = new Float32Array(Buffer.from(s.b64, 'base64').buffer.slice(0));
    const power = f.reduce((a, v) => a + v * v, 0) / f.length;
    const sigma = Math.sqrt(power / 10 ** (SNR / 10));
    for (let i = 0; i < f.length; i++) f[i] += sigma * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    s.b64 = Buffer.from(f.buffer).toString('base64');
  }
}
writeFileSync(new URL(SNR ? './segments-noisy.json' : './segments.json', import.meta.url), JSON.stringify(clips));
console.log(clips.map(c => `${c.clip}: ${c.segments.length} segments, ${c.segments.reduce((a, s) => a + s.seconds, 0).toFixed(0)} s`).join('\n'));
