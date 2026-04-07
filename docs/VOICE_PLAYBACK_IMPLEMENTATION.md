# ARCOS Voice Playback Implementation

## Current Design

ARCOS owns playback directly. It does not capture microphone input and it does not rely on AppleScript or notification side effects for sound.

Current flow:

1. Terminal response completes.
2. ARCOS extracts the `RESULTS` and `NEXT` sections from the PAI response.
3. ARCOS sanitizes and caps the spoken text.
4. The renderer calls `window.electron.voiceSynthesize(...)`.
5. The Electron main process calls ElevenLabs text-to-speech.
6. The main process returns an audio data URL to the renderer.
7. The renderer plays the audio with an in-app `Audio` object.

## Configuration

ARCOS reads ElevenLabs configuration from the existing PAI voice environment:

- `~/.claude/.env`
- `~/pai/.claude/.env`
- `~/PAI/.claude/.env`
- `~/.env`

Supported keys:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `ELEVENLABS_MODEL`

If no model is configured, ARCOS uses `eleven_multilingual_v2`.

## IPC Surface

Renderer API:

- `voiceStatus()`
- `voiceSynthesize({ message, voiceId? })`
- `voiceNotify({ message, title?, voiceId? })`

`voiceNotify` is kept for compatibility with the legacy local voice server path. New Terminal playback uses `voiceSynthesize`.

## Main Process

File:

- `/Users/noahpowell/Documents/AI Project/arcos/src/main/main.ts`

Relevant functions:

- `getElevenLabsConfig()`
- `getVoiceServerStatus()`
- `synthesizeElevenLabsAudio(...)`
- `sendVoiceNotification(...)`

`synthesizeElevenLabsAudio(...)` calls the official ElevenLabs endpoint:

- `POST https://api.elevenlabs.io/v1/text-to-speech/:voice_id`

The response is returned to the renderer as a base64 audio data URL. The API key stays in the main process and is not exposed to the renderer.

## Settings Surface

Settings -> Connections shows:

- ARCOS playback readiness
- legacy voice server status, if available
- ElevenLabs API-key configured state
- default voice ID
- configured ElevenLabs model

The legacy voice server is not required for ARCOS playback.

## Boundaries

- ARCOS voice playback happens only after generation completes.
- ARCOS does not call ElevenLabs during model generation.
- ARCOS does not capture microphone input.
- ARCOS does not expose the ElevenLabs API key to the renderer.

## Troubleshooting

If requests are logged by ElevenLabs but no sound plays:

- confirm the Terminal speaker toggle is active
- confirm Settings -> Connections shows ARCOS playback as ready
- confirm the browser/runtime allows audio playback for the ARCOS window
- check the Terminal error banner for playback errors

If ElevenLabs returns an error:

- verify `ELEVENLABS_API_KEY`
- verify `ELEVENLABS_VOICE_ID`
- verify plan/model compatibility
- try a shorter `RESULTS` / `NEXT` response
