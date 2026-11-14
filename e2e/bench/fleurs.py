"""Downloads a few FLEURS test sentences per language (audio + reference text) into segments-fleurs.json."""
import base64, io, json, time, urllib.request, wave
import numpy as np

LANGS = [("fr_fr", "fr"), ("it_it", "it"), ("pt_br", "pt"), ("ko_kr", "ko"), ("pl_pl", "pl"), ("nl_nl", "nl"), ("ar_eg", "ar"), ("vi_vn", "vi"), ("tr_tr", "tr"), ("uk_ua", "uk")]
PER = 6

def get(url, tries=6):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "bench"}), timeout=60).read()
        except Exception as e:
            time.sleep(3 * (i + 1))
    return None

def read_wav(data):
    import struct
    pos, fmt, rate, ch = 12, 1, 16000, 1
    while pos < len(data) - 8:
        cid, size = data[pos:pos+4], struct.unpack('<I', data[pos+4:pos+8])[0]
        body = data[pos+8:pos+8+size]
        if cid == b'fmt ':
            fmt, ch, rate = struct.unpack('<HHI', body[:8])
        elif cid == b'data':
            arr = np.frombuffer(body, dtype=np.float32 if fmt == 3 else np.int16).astype(np.float32)
            if fmt != 3: arr /= 32768
            return (arr.reshape(-1, ch).mean(axis=1) if ch > 1 else arr), rate
        pos += 8 + size + (size & 1)
    raise ValueError('no data chunk')

clips = []
for config, lang in LANGS:
    raw = get(f"https://datasets-server.huggingface.co/rows?dataset=google/fleurs&config={config}&split=test&offset=0&length={PER}")
    if not raw:
        print(lang, "rows unavailable"); continue
    try:
        rows = json.loads(raw)["rows"]
    except Exception:
        print(lang, "bad json"); continue
    segs = []
    for r in rows:
        row = r["row"]
        audio = get(row["audio"][0]["src"])
        if not audio:
            continue
        pcm, rate = read_wav(audio)
        if rate != 16000:
            from scipy.signal import resample_poly
            pcm = resample_poly(pcm, 16000, rate).astype(np.float32)
        if len(pcm) > 16000 * 14:
            continue
        segs.append({"ref": row["transcription"], "seconds": round(len(pcm) / 16000, 2), "b64": base64.b64encode(pcm.tobytes()).decode()})
    print(lang, len(segs), "segments")
    if segs:
        clips.append({"clip": "fleurs-" + lang, "lang": lang, "segments": segs})
json.dump(clips, open("segments-fleurs.json", "w"))
