// Prints accuracy (character error rate against the reference subtitles) and speed per model and language.
import { readFileSync, readdirSync } from 'node:fs';
const norm = s => (s || '').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
const lev = (a, b) => { let p = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; };
const wavBase64 = b64 => { const f = new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0)); const buf = Buffer.alloc(44 + f.length * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + f.length * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(f.length * 2, 40); f.forEach((v, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2)); return buf.toString('base64'); };

function summarize(name, rows) {
  const by = {};
  for (const r of rows) { const k = r.lang; (by[k] ??= { err: 0, len: 0, ms: 0, sec: 0, n: 0 }); const ref = norm(r.ref); by[k].err += lev(ref, norm(r.hyp)); by[k].len += ref.length; by[k].ms += r.ms; by[k].sec += r.seconds; by[k].n++; }
  const line = Object.entries(by).map(([k, v]) => `${k} CER ${(100 * v.err / v.len).toFixed(1)}% ${Math.round(v.ms / v.n)} ms/seg`).join(' | ');
  const all = Object.values(by).reduce((a, v) => ({ ms: a.ms + v.ms, sec: a.sec + v.sec, n: a.n + v.n }), { ms: 0, sec: 0, n: 0 });
  console.log(`${name.padEnd(22)} ${line} | avg ${Math.round(all.ms / all.n)} ms for ${(all.sec / all.n).toFixed(1)} s of audio (x${(all.sec * 1000 / all.ms).toFixed(1)} real time)`);
}

for (const f of readdirSync(new URL('.', import.meta.url)).filter(f => f.startsWith(process.env.TAG ? 'result' + process.env.TAG : 'result-'))) {
  const r = JSON.parse(readFileSync(new URL(f, import.meta.url)));
  console.log(`-- ${r.engine}: load ${(r.loadMs / 1000).toFixed(1)} s${r.error ? ', ERROR ' + r.error : ''}`);
  summarize(r.engine, r.rows);
  const mt = r.rows.filter(x => x.mtMs);
  if (mt.length) console.log(`   translation PLaMo 0.8B in browser: avg ${Math.round(mt.reduce((a, x) => a + x.mtMs, 0) / mt.length)} ms per phrase over ${mt.length} phrases`);
}

if (process.env.LLAMA) {
  const clips = JSON.parse(readFileSync(new URL('./segments.json', import.meta.url)));
  const rows = [];
  for (const clip of clips) for (const s of clip.segments) {
    const t0 = performance.now();
    const reply = await (await fetch('http://127.0.0.1:8083/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: wavBase64(s.b64), format: 'wav' } }] }], max_tokens: 200, temperature: 0 }) })).json();
    const text = (reply.choices?.[0]?.message?.content ?? '').replace(/^language [^<]*<asr_text>/, '');
    rows.push({ lang: clip.lang, ref: s.ref, hyp: text, ms: Math.round(performance.now() - t0), seconds: s.seconds });
  }
  summarize('llama-server Qwen3 0.6B', rows);
}
