# ai-realtime-subtitles

Расширение для Chromium-браузеров (Manifest V3): субтитры и перевод аудио вкладки в реальном времени на локальных моделях.

Код написан с нуля на TypeScript. Расширение `subtitle-anything-local` служит только референсом.

## Режимы работы

1. **Только браузер.** Модели работают в браузере (WebGPU и WASM). Установка программ не нужна.
2. **С программой на компьютере.** Программа на Python запускает `llama-server` с моделями. Работает быстрее.
3. **Связь с программой.** Два транспорта: HTTP на `127.0.0.1` или мост Native Messaging (работает и в окнах Tor).

Все режимы реализуют один интерфейс `Backend` ([src/core/backend.ts](src/core/backend.ts)).

## Модели

- Распознавание: Qwen3-ASR 0.6B (по умолчанию), Cohere Transcribe (проверено в браузере на WebGPU).
- Перевод: PLaMo 3 Translate 2B и 0.8B.

## Интерфейс

- Полупрозрачные субтитры. Их можно перетаскивать и менять размер прямо на странице.
- Дополнительно: показ субтитров в окне Picture-in-Picture.

## Нарезка аудио

Параметры в [src/core/subtitle-stream.ts](src/core/subtitle-stream.ts) (`TUNED`) подобраны на реальных роликах (zh, ja, es, de) с эталонными субтитрами:

- блоки по 250 мс, порог громкости 0.003;
- конец фразы после 400 мс тишины, мягкий разрез по паузе 250 мс после 3 с, жёсткий разрез на 6 с;
- сегменты с речью короче 300 мс отбрасываются;
- в очереди перевода не больше 3 сегментов, старые отбрасываются.

## Программа на компьютере (Python, `companion/`)

Только стандартная библиотека Python. Запуск из папки `companion`:

```powershell
python -m ai_subtitles_companion config --models-dir C:\путь\к\моделям   # один раз
python -m ai_subtitles_companion serve        # запустить llama-server для ASR (:8083) и перевода (:8082)
python -m ai_subtitles_companion status
python -m ai_subtitles_companion stop
```

Файлы моделей: `Qwen3-ASR-0.6B-Q8_0.gguf`, `mmproj-Qwen3-ASR-0.6B-Q8_0.gguf`, `plamo-3-translate-2b-Q4_K_M.gguf` (имена меняются в `config.json`). `llama-server` ищется в `llama_server` из настроек, в переменной `LLAMA_SERVER`, в `PATH`, затем среди сборок LM Studio (Vulkan).

**Режим "HTTP".** Расширение ходит на `127.0.0.1:8083` и `:8082`. Серверы должны быть запущены (`serve`).

**Режим "через мост".** Расширение говорит с программой через Native Messaging, сетевые запросы не нужны, поэтому работает и в окнах Tor. Программа сама запускает серверы при первом обращении. Мост принимает только фиксированные цели (`asr`, `translate`, `companion`) и пути, произвольные адреса запрещены. Регистрация моста (запись в реестр текущего пользователя):

```powershell
python -m ai_subtitles_companion install      # Chrome, Brave и Edge; ключ --browser brave для одного
python -m ai_subtitles_companion uninstall
```

Идентификатор расширения закреплён ключом в `public/manifest.json`: `fdpmchjhigcggmmcilchcakdnocflcbf`.

## Проверка в отдельном браузере

`.e2e/drive.mjs` (в git не входит) запускает отдельный экземпляр Brave с временным профилем, загружает `dist`, подставляет вместо звука вкладки тестовый файл как микрофон и проверяет статусы, текст субтитров, перетаскивание и изменение размера. `tabCapture` в этом тесте не проверяется: он требует клика по значку расширения.

## Разработка

```powershell
pnpm install
pnpm run typecheck
pnpm test
```

## Состояние

Готово: ядро нарезки `SubtitleStream` с тестами и интерфейс `Backend`.
Дальше: режим "только браузер", программа на Python и транспорты, оверлей, дизайн окон, Picture-in-Picture.
