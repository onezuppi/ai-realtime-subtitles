"""Makes Russian test sentences with Silero (no playback). Writes ru.json: [{ref, wav16k_b64}]."""
import base64, json, struct, sys
import numpy as np
from silero import silero_tts

SENTENCES = [
    "Сегодня мы поговорим о том, как работают субтитры в реальном времени.",
    "Модель слушает звук из вкладки и сразу показывает текст на экране.",
    "Если перевод не нужен, можно оставить исходный язык.",
    "Первый запуск занимает больше времени, потому что модель загружается в память.",
    "Расширение не отправляет звук в интернет и работает без сети после загрузки.",
    "Погода в Москве завтра будет облачной, ожидается небольшой дождь.",
    "Пожалуйста, закройте дверь и выключите свет, когда будете уходить.",
    "Нам нужно обсудить результаты проверки до конца недели.",
]
model, _ = silero_tts(language="ru", speaker="v5_5_ru")
out = []
for text in SENTENCES:
    audio = model.apply_tts(text=text, speaker="baya", sample_rate=48000)
    a = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
    from scipy.signal import resample_poly
    a16 = resample_poly(a, 1, 3).astype(np.float32)
    out.append({"ref": text, "b64": base64.b64encode(a16.tobytes()).decode()})
json.dump(out, open(sys.argv[1], "w"))
print(len(out), "sentences")
