# ai-realtime-subtitles

**English** | [Русский](README.ru.md)

A Chromium browser extension (Manifest V3) that shows real-time subtitles and translation of tab audio using local models.

The code is written from scratch in TypeScript. The extension `subtitle-anything-local` served only as a reference.

![Subtitles over a video](docs/example.webp)

## Modes

1. **Browser only.** The models run in the browser (WebGPU and WASM). No programs to install.
2. **With a program on your computer.** A Python program starts `llama-server` with the models. Faster.
3. **Connection to the program.** Two transports: HTTP on `127.0.0.1`, or a Native Messaging bridge (works in Tor windows too).

All modes implement one `Backend` interface ([src/core/backend.ts](src/core/backend.ts)).

In the popup the modes are called "Browser", "Computer" (HTTP) and "Bridge".

## Quick start

1. Download `ai-realtime-subtitles-<version>.zip` from the Releases tab and unpack it into a permanent folder.
2. Open `chrome://extensions`, turn on developer mode, press "Load unpacked" and select the folder. The extension ID stays `fdpmchjhigcggmmcilchcakdnocflcbf` (pinned by the key in the manifest), so the bridge accepts it.
3. Open the extension settings page and press "Download" next to the models you want (mode "Browser"). Nothing else is needed.
4. Open a tab with audio, press the extension icon and press "Start subtitles".

For the faster modes install the program on your computer: see [Program on your computer](#program-on-your-computer-python-companion).

## Models: what works and how

| Model | Role | Runs in | Size | Languages |
|---|---|---|---|---|
| Whisper small | Speech recognition | "Browser": transformers.js, WebGPU or WASM | 589 MB | 99, detects the language itself |
| Qwen3-ASR 0.6B | Speech recognition | "Browser": WebGPU. "Computer" and "Bridge": `llama-server` | 1.72 GB | 30 according to the model card, detects the language itself |
| Cohere Transcribe 2B | Speech recognition | "Browser": WebGPU, `q4f16` | 1.54 GB | 14, **no Russian**; the language must be chosen |
| PLaMo 3 Translate 0.8B | Translation | "Browser": WebGPU, `q4f16` | 708 MB | English and Russian |
| PLaMo 3 Translate 2B | Translation | "Computer" and "Bridge": `llama-server` | not measured | English and Russian |

What was checked, model by model:

- **Whisper small.** 2.1 s per segment with a chosen language, 3.3 s with auto-detection (same accuracy). Transformers.js does not detect the language, so the detection is written in `worker.ts`. Character errors: de 9%, es 0.3%, ru 0%, zh 46% (outputs traditional characters instead of the simplified ones in the reference), ja 59%.
- **Qwen3-ASR 0.6B.** Transformers.js cannot run this model, so it has its own runner on onnxruntime-web (`src/backends/browser/qwen3-asr/`). Browser: 2.5 s per segment. Errors: de 13%, es 0.9%, ru 0%, zh 7%, ja 84%. `llama-server` gives the same errors at 0.45 s per segment. Bridge: the exchange was checked over stdio.
- **Cohere Transcribe 2B.** 1.2 s per segment, the fastest in the browser. Errors: de 7%, es 0.3%, zh 7%, ja 30%.
- **PLaMo 3 Translate 0.8B.** 1.9 s per phrase. Phrases are translated one by one, without context.
- **PLaMo 3 Translate 2B.** Works through `llama-server`, with the two previous phrases as context.

Measurement: Windows 11, Brave 157 with WebGPU, 48 segments of 1.5-10 s (4.7 s on average) from real videos with reference subtitles (de, es, ja, zh, 10 each) and 8 Russian phrases voiced by Silero. The sample is small. The numbers show the order of magnitude, not a precise estimate. Japanese errors are high for all models, possibly because the reference is written differently (kanji and kana). Time includes sending audio to the worker, but not loading the models into it. Character errors are in percent (lower is better). Cohere always ran with a chosen language. Whisper and Qwen3-ASR ran with auto-detection in the first three tables unless stated otherwise. An empty cell means "not checked" or "the model does not support the language".

**Clean speech**

| Language | Whisper small | Qwen3-ASR | Cohere |
|---|---|---|---|
| de | 9 | 13 | 7 |
| es | 0.3 | 0.9 | 0.3 |
| ru | 0 | 0 | |
| zh | 46 | 7 | 7 |
| ja | 61 | 84 | 30 |
| ko | 4 | 6 | 4.5 |
| nl | 5 | 6 | 2 |
| ar | 5 | 5 | 0.4 |

**White noise, 5 dB**

| Language | Whisper small | Qwen3-ASR | Cohere |
|---|---|---|---|
| de | 23 | 16 | 9 |
| es | 2 | 0.6 | 0.3 |
| ru | 6 | 7 | |
| zh | 47 | 16 | 18 |
| ja | 69 | 84 | 34 |

**Someone else's Russian speech in the background, 5 dB**

| Language | Whisper (auto) | Whisper (language chosen) | Qwen3-ASR (auto) | Qwen3-ASR (language chosen) | Cohere |
|---|---|---|---|---|---|
| de | 15 | 15 | 14 | 14 | 7 |
| es | 25 | 7 | 80 | 22 | 0.3 |
| zh | 91 | 51 | 60 | 30 | 59 |
| ja | 489 | 70 | 1223 | 601 | 73 |

Conclusions: with extra voices in the background, language auto-detection gets confused, so choose the language by hand. Cohere is the most stable on European languages, but loses accuracy on Chinese and Japanese with background speech. Qwen3-ASR produces nonsense on Japanese with background speech. French, Italian, Portuguese, Polish, Vietnamese, Turkish and Ukrainian were not checked: the FLEURS server returned no recordings. Background music was not checked.

Loading from the cache into GPU memory: Whisper 13 s, Cohere 21 s, Qwen3-ASR about 50 s.

What to choose:

| Task | Model | Why |
|---|---|---|
| Russian speech | Qwen3-ASR | Cohere has no Russian. Whisper and Qwen3-ASR gave 0% errors on clean Russian phrases, but the phrases were synthesized |
| Chinese | Cohere or Qwen3-ASR (7% for both) | Whisper outputs traditional characters, 46% errors |
| Japanese | Cohere (30%) | Qwen3-ASR has 84% and Whisper 59%, possibly because of how the reference is written |
| German, Spanish | Cohere (7% and 0.3%) | The fastest (1.2 s per segment). Whisper is almost as accurate, but slower |
| Small download, no WebGPU | Whisper small | 589 MB, runs on WASM, but slowly |
| Language not known in advance | Qwen3-ASR or Whisper | Cohere needs the language chosen |

Why Qwen3-ASR is slower in the browser (2.5 s) than in `llama-server` (0.45 s): for every token the decoder is launched again, which means hundreds of small GPU calls, and the result is returned to the CPU each time. Both effects are described in WebGPU research ([Characterizing WebGPU Dispatch Overhead for LLM Inference](https://arxiv.org/html/2604.02344)). The attention cache on the CPU cost even more: moving it to GPU memory made the model 2.7 times faster (6.8 s down to 2.5 s). It can be made faster still, but that needs a step-by-step profile.

How "Browser" mode works:

- Models are not downloaded automatically. On the settings page each model has a "Download" button. During the download you see the percentage, size and speed. There is a "Cancel" button: the downloaded parts stay, and pressing "Download" again continues from there.
- Files live in the extension's Cache API and work without a network after the download. The "Remove" button frees the space.
- The default source is Hugging Face. You can set a mirror in the settings.
- If the selected model is not downloaded, the start button in the popup says what to download in the settings.
- Cohere and PLaMo need WebGPU. The settings page warns if it is missing.
- The first start after choosing a model is slow: the model is loaded into GPU memory (13-50 s, see the measurement above).

## Interface

- Popup: the start button, the status, the choice of where recognition runs and a switch "Subtitles" / "Subtitles + translation". In the first mode the recognized text is shown in the language of the audio, and the translation model is neither started nor downloaded. In the second mode the text is translated into any of the 52 languages of PLaMo 3 Translate (the list is on the model card). Settings page: background opacity, text size, position reset. Light and dark themes follow the system setting.
- Semi-transparent subtitles. You can drag them and resize them by the lower right corner right on the page. While the cursor is over the subtitles, they do not disappear.
- Picture-in-Picture: the button in the upper right corner of the subtitles opens a separate window that stays above other windows. It uses the Document Picture-in-Picture API (Chromium 116 and newer). The window shows only the subtitles: it does not move the video itself.

## Audio slicing

The parameters in [src/core/subtitle-stream.ts](src/core/subtitle-stream.ts) (`TUNED`) were tuned on real videos (zh, ja, es, de) with reference subtitles:

- blocks of 250 ms, loudness threshold 0.003;
- the end of a phrase after 400 ms of silence, a soft cut at a 250 ms pause after 3 s, a hard cut at 6 s;
- segments with speech shorter than 300 ms are dropped;
- the translation queue holds at most 3 segments, older ones are dropped.

## Program on your computer (Python, `companion/`)

Python standard library only. Run it from the `companion` folder:

```powershell
python -m ai_subtitles_companion config --models-dir C:\path\to\models   # once
python -m ai_subtitles_companion serve        # start llama-server for ASR (:8083) and translation (:8082)
python -m ai_subtitles_companion status
python -m ai_subtitles_companion stop
```

**Downloading.** The `download` command (in the packaged program: `subtitles-companion download`) fetches everything needed, about 2.9 GB:

| What | From | Size |
|---|---|---|
| `llama-server` (llama.cpp `b12728`; Vulkan for Windows and Linux, Metal for macOS) | GitHub Releases of ggml-org/llama.cpp | 17-39 MB |
| `Qwen3-ASR-0.6B-Q8_0.gguf`, `mmproj-Qwen3-ASR-0.6B-Q8_0.gguf` | Hugging Face ggml-org/Qwen3-ASR-0.6B-GGUF | 805 and 214 MB |
| `plamo-3-translate-2b-Q4_K_M.gguf` | Hugging Face pfnet/plamo-3-translate-2b-GGUF (PLaMo Community License) | 1.8 GB |

`llama-server` goes into the data folder, the models into `models_dir` (by default `<data folder>\models`). The size and SHA-256 of every file are built into the program and checked. An interrupted download continues from where it stopped, and files already there are skipped. `--only server`, `--only asr` and `--only translate` download one part. Installing the bridge offers to download what is missing (`--download` agrees in advance, `--no-download` declines). The `check` command shows what is missing.

Model file names can be changed in `config.json`. `llama-server` is searched for in `llama_server` from the settings, in the `LLAMA_SERVER` variable, among the downloaded builds, in `PATH`, and then among the LM Studio builds (Vulkan).

**"Computer" (HTTP) mode.** The extension calls `127.0.0.1:8083` and `:8082`. The servers must be running (`serve`).

### The bridge: when it is needed and how to install it

**Why.** "Computer" mode needs the browser to be able to open `http://127.0.0.1:8083`. Sometimes that is impossible:

- VPN or proxy browser extensions send all browser traffic out, and requests to `127.0.0.1` never reach your computer;
- in Tor windows in Brave, access to localhost is blocked;
- corporate policies and strict network settings forbid requests to local addresses.

The bridge goes around the network. The browser starts the program itself and talks to it through an input-output channel (Native Messaging). There are no network requests, so VPN and proxies do not interfere. The program starts the model servers itself on the first request.

**Install from a release.** Download the file `subtitles-companion-<system>` (Windows, Linux or macOS) from the Releases tab and double-click it. Python is not needed. The program asks which browsers to install for, copies itself into the data folder and registers the bridge. Administrator rights are not needed. The `check` and `uninstall` commands work as shown below: `subtitles-companion check`.

**Install from source.** Python 3.10 or newer is needed. Works on Windows, macOS and Linux.

Windows: double-click `companion\install-bridge.cmd` or run it from PowerShell by its full path.
macOS and Linux: `sh companion/install-bridge.sh`.

```
install-bridge     # show the browsers found, let you choose, ask for confirmation and install
install-bridge check        # check the registration and the servers
install-bridge uninstall    # remove
```

The script finds the installed Chrome, Chromium, Brave and Edge and offers to choose which ones to install for: numbers separated by commas, Enter for all, `q` to cancel. The `--browser brave` option sets the browser at once, `--yes` removes the questions.

Where the registration is written:

| System | What is created |
|---|---|
| Windows | one registry key per browser under `HKEY_CURRENT_USER\Software\...\NativeMessagingHosts`, the manifest and `host.bat` in `%LOCALAPPDATA%\ai-realtime-subtitles`. Brave on Windows reads the Chrome key and ignores its own, so for Brave the program writes both keys |
| macOS | the manifest in `~/Library/Application Support/<browser>/NativeMessagingHosts`, `host.sh` in `~/Library/Application Support/ai-realtime-subtitles` |
| Linux | the manifest in `~/.config/<browser>/NativeMessagingHosts`, `host.sh` in `~/.config/ai-realtime-subtitles` |

Browsers from Snap and Flatpak on Linux use other profile folders, so the standard registration does not fit them. For them the path must be set by hand.

Only the extension with ID `fdpmchjhigcggmmcilchcakdnocflcbf` (pinned by the key in `public/manifest.json`) can use the bridge. The bridge accepts only fixed targets (`asr`, `translate`, `companion`) and paths. Arbitrary addresses are forbidden.

After the installation restart the browser and choose "Bridge" in the extension popup.

Finding `llama-server` on other systems: `llama_server` in the settings, the `LLAMA_SERVER` variable, `PATH` (on macOS `brew install llama.cpp` works), then the LM Studio builds for that system.

## Testing in a separate browser

`e2e/drive.mjs` and `e2e/models.mjs` (not part of git) start a separate Brave instance with a temporary profile, load `dist`, replace the tab audio with a test file played as a microphone, and check the statuses, the subtitle text, dragging and resizing. `models.mjs` starts a local mirror of the models, presses "Download" on the settings page, records the percentages and starts subtitles in "Browser" mode. Tab audio capture (`tabCapture`) requires a click on the extension icon, so there is a mode `MANUAL=1 node e2e/drive.mjs`: the test starts Brave without device substitution and you press "Start subtitles".

## Release

The version is set in three places: `package.json`, `public/manifest.json` and `companion/pyproject.toml`. The packaging script checks that they match.

1. Raise the version in all three files and commit.
2. Create the tag `vX.Y.Z` and push it: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. GitHub Actions (`.github/workflows/release.yml`) runs the checks, builds the extension ZIP and the program for Windows, Linux and macOS, and publishes everything to Releases.

Locally the extension ZIP is built with `pnpm package` (the result is in `release/`).

## Development

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm run test:companion
```

## Status

Done: `SubtitleStream` slicing with tests, the `Backend` interface, the "Browser" mode (Whisper, Qwen3-ASR, Cohere, PLaMo 0.8B), the "Computer" and "Bridge" modes, the Python program, the overlay, window design, Picture-in-Picture, the release workflow.

Not done:

- The measurement sample is small (8-10 segments per language). Languages other than de, es, ja, zh and ru were not tried: there are no recordings with a reference.
- Qwen3-ASR in the browser is 5 times slower than `llama-server`: the attention cache already stays in GPU memory. Moving the embeddings to the GPU was tried and made it slower (3.5 s against 2.5 s), so they stayed on WASM.
- `tabCapture` (tab audio) was not run in the automatic check: the check used a test microphone.
- The packaged program was built and started on Windows, Linux and macOS (arm64) only in CI. Installing the bridge from it was checked on Windows only.
