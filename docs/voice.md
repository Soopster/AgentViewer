# Voice input

Voice input adds a transcript to your current prompt. Review it and send normally.
On macOS 26+, Apple SpeechAnalyzer is preferred for on-device transcription. Other
systems use local whisper.cpp. No cloud speech service or API key is used.

## macOS setup

Install ffmpeg (`brew install ffmpeg`) and Xcode Command Line Tools
(`xcode-select --install`). On macOS 26 or later, voice input uses Apple's
SpeechAnalyzer / SpeechTranscriber with finalized transcription results.
No Whisper installation or Whisper model is required.

Apple must have a speech model installed for your language. To allow Apple's
system model download when missing, start Agent Viewer with:

```sh
export AGENT_VIEWER_APPLE_DOWNLOAD_MODELS=1
# Optional; defaults to your Mac's current locale:
export AGENT_VIEWER_VOICE_LANGUAGE=en-AU
```

Only model installation needs a download; audio processing stays on-device.
Without that setting, missing models produce an actionable setup error.
Unsupported hardware, language, older macOS, or missing developer tools can use
local Whisper if `AGENT_VIEWER_WHISPER_MODEL` is configured. Auto mode tries Apple
first and then that configured fallback. To choose an engine explicitly:

```sh
export AGENT_VIEWER_VOICE_ENGINE=apple   # Require Apple; no Whisper fallback
# or
export AGENT_VIEWER_VOICE_ENGINE=whisper # Always use local Whisper
```

The default is `auto`. Apple mode requires macOS 26+ and an SDK with SpeechAnalyzer
(Xcode Command Line Tools 26+). The small Swift helper runs in a child process;
compilation and transcription do not block the UI thread. Compiler modules are
cached between recordings. Apple transcription stops after 60 seconds if it stalls.

## Whisper setup (other platforms or optional Mac fallback)

Install `ffmpeg` and `whisper-cli` (whisper.cpp) on the machine running Agent Viewer.
On macOS, `brew install ffmpeg whisper-cpp` supplies both. Download a whisper.cpp
GGML model using the upstream model downloader, for example `base.en` for English
or `base` for multilingual dictation:
https://github.com/ggml-org/whisper.cpp#quick-start

Set these before starting either app:

```sh
export AGENT_VIEWER_WHISPER_MODEL=/absolute/path/to/ggml-base.en.bin
# Optional:
export AGENT_VIEWER_WHISPER_BIN=whisper-cli
export AGENT_VIEWER_FFMPEG=ffmpeg
export AGENT_VIEWER_VOICE_LANGUAGE=en
```

Whisper defaults to auto language detection. Whisper models must already exist
locally. Neither engine falls back to a cloud transcription service.

## Web

Click the microphone next to the composer, allow microphone access, speak, then
click Stop. HTTPS or localhost and a browser supporting MediaRecorder are required.
Recording stops after two minutes. The transcript is appended to the current draft.
During transcription, click the stop button to cancel. Switching sessions cancels
delivery of the old recording.

Audio is sent to the Agent Viewer host for local processing. If you access Web
from a phone or remote browser, transcription runs on that host, not the phone.
Temporary recordings and transcript files are removed after processing.

## OpenTUI

Focus the composer, then press Ctrl+Shift+V to start and again to stop. Recording
also stops after two minutes. The composer status shows recording, processing,
and setup errors. Press Ctrl+Shift+V during transcription to cancel. Switching composer targets or closing the app cancels capture.
Terminals must distinguish Ctrl+Shift+V from their paste shortcut; configure the
terminal shortcut if necessary.

Microphone capture uses ffmpeg's avfoundation backend on macOS, PulseAudio on Linux,
and DirectShow on Windows. Override the input with `AGENT_VIEWER_VOICE_DEVICE`:
macOS defaults to `:0`, Linux to `default`. On Windows set the actual device name,
for example `audio=Microphone (USB Audio Device)`. Grant the terminal microphone
permission in OS settings. Use ffmpeg's device listing to select another microphone.

This feature is dictation; it does not automatically send prompts or read replies aloud.
The legacy Ink UI does not include voice controls.
