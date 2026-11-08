const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const hap = require('hap-nodejs');
const { PlatformAccessory } = require('homebridge/lib/platformAccessory');

const plugin = require('../dist/index');
const { HomePodAnnouncePlatform, createTestPlatform } = require('../dist/platform');
const { FakeAnnouncer, ShellAnnouncer } = require('../dist/announcer');
const { AnnounceHttpServer } = require('../dist/http-server');

test('the plugin registers the HomePod Announce platform', () => {
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

test('ShellAnnouncer uses edge-tts then atvremote stream_file', async () => {
  const commands = [];
  const announcer = new ShellAnnouncer({
    playback: 'pyatv',
    homepodId: 'AA:BB',
    volume: 40,
    voice: 'en-US-JennyNeural',
    which: async (binary) => binary === 'edge-tts' || binary === 'atvremote',
    exec: async (command, args) => {
      commands.push({ command, args: [...args] });
      if (command === 'edge-tts') {
        const out = args[args.indexOf('--write-media') + 1];
        fs.writeFileSync(out, 'fake-audio');
      }
      return { stdout: '', stderr: '' };
    },
  });

  await announcer.speak({ text: 'Hello' });

  assert.equal(commands[0].command, 'edge-tts');
  assert.ok(commands[0].args.includes('Hello'));
  assert.ok(commands[0].args.includes('en-US-JennyNeural'));
  const stream = commands.find(
    (entry) => entry.command === 'atvremote' && entry.args.some((arg) => String(arg).startsWith('stream_file=')),
  );
  assert.ok(stream, 'expected atvremote stream_file');
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
