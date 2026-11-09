const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const hap = require('hap-nodejs');
const { PlatformAccessory } = require('homebridge/lib/platformAccessory');

const plugin = require('../dist/index');
const { HomePodAnnouncePlatform, createTestPlatform } = require('../dist/platform');
const { FakeAnnouncer, ShellAnnouncer } = require('../dist/announcer');
const { AnnounceHttpServer } = require('../dist/http-server');
const { resolveVoice } = require('../dist/voices');

test('the plugin registers the HomePod Announcements platform', () => {
  let registered = null;
  plugin({
    registerPlatform(pluginName, platformName, constructor) {
      registered = { pluginName, platformName, constructor };
    },
  });
  assert.deepEqual(registered, {
    pluginName: 'homebridge-homepod-announcements',
    platformName: 'HomePodAnnouncements',
    constructor: HomePodAnnouncePlatform,
  });
});

test('momentary switch speaks text then turns off', async () => {
  const { accessories, launch, fake } = createHarness();
  launch();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(accessories.length, 1);
  const switchService = accessories[0].getService(hap.Service.Switch);
  assert.ok(switchService);
  const on = switchService.getCharacteristic(hap.Characteristic.On);

  await on.setValue(true);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text, 'Dinner is ready');
  assert.equal(on.value, false);
});

test('ShellAnnouncer uses bundled TTS then vendor/path atvremote', async () => {
  const commands = [];
  const synth = [];
  const announcer = new ShellAnnouncer({
    playback: 'pyatv',
    homepodId: 'AA:BB',
    volume: 40,
    voice: 'hila',
    style: 'whisper',
    which: async () => '/usr/bin/atvremote',
    synthesizeToFile: async (text, outPath, voice, language, rate, pitch) => {
      synth.push({ text, voice, language, rate, pitch });
      fs.writeFileSync(outPath, 'fake-audio');
    },
    exec: async (command, args) => {
      commands.push({ command, args: [...args] });
      return { stdout: '', stderr: '' };
    },
  });

  await announcer.speak({ text: 'שלום' });

  assert.equal(synth[0].voice, 'he-IL-HilaNeural');
  assert.equal(synth[0].rate, '-15%');
  assert.equal(synth[0].pitch, '-10Hz');
  assert.equal(commands[0].command, '/usr/bin/atvremote');
  const stream = commands.find(
    (entry) => entry.args.some((arg) => String(arg).startsWith('stream_file=')),
  );
  assert.ok(stream, 'expected atvremote stream_file');
});

test('resolveVoice maps ids and styles like israel-hebrew', () => {
  const hila = resolveVoice('hila', 'announcer');
  assert.equal(hila.voice, 'he-IL-HilaNeural');
  assert.equal(hila.style, 'announcer');
  assert.equal(hila.rate, '-6%');

  const legacy = resolveVoice('he-IL-AvriNeural', 'funny');
  assert.equal(legacy.voice, 'he-IL-AvriNeural');
  assert.equal(legacy.style, 'funny');
});

test('HTTP /announce speaks arbitrary text', async () => {
  const fake = new FakeAnnouncer();
  const port = 18765 + Math.floor(Math.random() * 1000);
  const server = new AnnounceHttpServer({
    port,
    announcer: fake,
    log() {},
  });
  server.start();
  await new Promise((resolve) => setTimeout(resolve, 50));

  try {
    const response = await fetch(`http://127.0.0.1:${port}/announce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Laundry finished' }),
    });
    assert.equal(response.status, 200);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].text, 'Laundry finished');
  } finally {
    server.stop();
  }
});

function createHarness() {
  const accessories = [];
  let launch = () => {};
  const api = {
    hap,
    platformAccessory: PlatformAccessory,
    registerPlatformAccessories(_pluginName, _platformName, list) {
      accessories.push(...list);
    },
    unregisterPlatformAccessories() {},
    on(event, callback) {
      if (event === 'didFinishLaunching') {
        launch = callback;
      }
    },
  };

  const { platform, fake } = createTestPlatform(
    { info() {}, warn() {}, error() {}, debug() {} },
    {
      name: 'HomePod Announcements',
      homepodId: 'AA:BB:CC:DD:EE:FF',
      announcements: [{ name: 'Dinner ready', text: 'Dinner is ready' }],
    },
    api,
  );

  return { accessories, launch, fake, platform };
}
