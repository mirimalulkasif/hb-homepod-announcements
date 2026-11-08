# homebridge-homepod-announce

Momentary **HomeKit switches** that speak configured phrases on a **HomePod** (or any AirPlay speaker).

Tap a switch in the Home app (or flip it from an automation) → the plug-in synthesizes speech → streams audio to the HomePod → the switch turns itself off.

## Why a switch?

HomeKit has no free-text field in the Home app. Configured phrases as switches are the reliable pattern: they work in scenes, automations, and Siri (“Turn on Dinner ready”). For *dynamic* text (laundry finished, gate open), enable the optional HTTP endpoint.

## Requirements (on the Homebridge host)

1. **TTS** — one of:
   - [`edge-tts`](https://github.com/rany2/edge-tts) (recommended quality, Hebrew OK): `pip install edge-tts`
   - `espeak-ng`
   - macOS `say`
2. **Playback** — one of:
   - [`pyatv`](https://pyatv.dev) on PATH: `pip install pyatv` then `atvremote scan`
   - [homebridge-homepod-radio](https://github.com/homebridge-plugins/homebridge-homepod-radio) with its `/play` HTTP API
3. Home app → Home Settings → **Allow Speaker & TV Access** → Everyone (or anyone on the network), then **reboot the HomePod**. RAOP pairing should be `NotNeeded` (`atvremote --id <id> pairing_state`).

## Install

```bash
npm i -g github:mirimalulkasif/hb-homepod-announce
hb-service restart
```

## Config example

```json
{
  "platform": "HomePodAnnounce",
  "name": "HomePod Announce",
  "homepodId": "AA:BB:CC:DD:EE:FF",
  "volume": 45,
  "voice": "he-IL-HilaNeural",
  "playback": "pyatv",
  "httpPort": 18081,
  "announcements": [
    { "name": "Dinner ready", "text": "ארוחת הערב מוכנה" },
    { "name": "Dryer done", "text": "המייבש סיים" },
    { "name": "Gate", "text": "Someone is at the gate" }
  ]
}
```

Find `homepodId` with:

```bash
atvremote scan
```

## Dynamic text (HTTP)

With `httpPort` set:

```bash
curl -X POST http://HOMEBRIDGE:18081/announce \
  -H 'content-type: application/json' \
  -d '{"text":"הכביסה הסתיימה"}'
```

Useful from Switcher Laundry “Done” webhooks or Node-RED.

## Suggested Home automations

- **Dryer Done** contact opens → turn on **Dryer done** switch  
- **Gate** motion → turn on **Gate** switch  

## Notes

- Announcements interrupt whatever the HomePod is playing (AirPlay stream).
- Keep phrases short; long TTS + AirPlay startup can take a few seconds.
- Existing plugins like `homebridge-pipo-speak` solve a similar problem with bundled Piper; this plugin stays lean and uses tools you already install (`edge-tts` / `pyatv`).
