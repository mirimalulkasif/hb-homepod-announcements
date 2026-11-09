# homebridge-homepod-announcements

Momentary **HomeKit switches** that speak configured phrases on a **HomePod**.

Tap a switch → the plugin synthesizes speech → streams it to the HomePod → the switch turns off.

## Install / update

Use the **Homebridge UI → Plugins** page. Search for `homebridge-homepod-announcements` and Install / Update. Do not install from git on the Pi.

On install the plugin:

1. Pulls in **bundled Edge TTS** (`node-edge-tts`) — no `edge-tts` / `espeak` to install
2. Creates a private **pyatv** venv under the plugin’s `vendor/` folder (needs `python3` + `python3-venv` on the host once)

Host one-time OS packages (usually already present on Raspberry Pi OS):

```bash
sudo apt install -y python3 python3-venv
```

## HomePod setup

1. Home app → Home Settings → **Allow Speaker & TV Access** → Everyone (or anyone on the network)
2. Reboot the HomePod
3. Find the id:

```bash
# uses the plugin’s vendored binary after install, or system atvremote
atvremote scan
# or:
"$(npm root -g)/homebridge-homepod-announcements/vendor/pyatv/bin/atvremote" scan
```

Copy the **Identifier** into `homepodId`.

## Voices & styles

In the plugin settings:

- **Default voice** — dropdown (Hila / Avri Hebrew, multilingual, English)
- **Default speaking style** — Normal, Cheerful, Calm, Whisper, Announcer, Urgent, Warm, Excited, Playful
- Each announcement can override voice and style

Styles use Edge TTS rate/pitch (same style list idea as `homebridge-homepod-israel-hebrew`).

## Config example

```json
{
  "platform": "HomePodAnnouncements",
  "name": "HomePod Announcements",
  "homepodId": "AA:BB:CC:DD:EE:FF",
  "volume": 45,
  "voice": "hila",
  "style": "announcer",
  "playback": "pyatv",
  "httpPort": 18081,
  "announcements": [
    { "name": "WM-Done", "text": "מכונת הכביסה סיימה", "style": "cheerful" },
    { "name": "Quiet night", "text": "לילה טוב", "style": "whisper" }
  ]
}
```

Older configs that still use full Edge names (`he-IL-HilaNeural`) keep working.

## Dynamic text (HTTP)

With `httpPort` set:

```bash
curl -X POST http://HOMEBRIDGE:18081/announce \
  -H 'content-type: application/json' \
  -d '{"text":"הכביסה הסתיימה","style":"urgent"}'
```

## Playback options

- `pyatv` (default when vendor/system `atvremote` exists) — AirPlay stream
- `homepod-radio` — play via [homebridge-homepod-radio](https://github.com/homebridge-plugins/homebridge-homepod-radio) `/play` if you already use that plugin
- `auto` — prefer pyatv, else homepod-radio media folder

## Notes

- TTS needs outbound HTTPS to Microsoft Edge’s speech service (no API key).
- This plugin is Edge TTS only. Premium engines (Gemini / OpenAI / ElevenLabs) are not included.
