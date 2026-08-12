const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
const local = {};
const sync = {};
const changeListeners = [];

function storageArea(values) {
  return {
    async get(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? { [key]: values[key] } : {};
    },
    async set(items) {
      Object.assign(values, items);
    },
  };
}

const sandbox = {
  window: {},
  Set,
  TypeError,
  chrome: {
    storage: {
      local: storageArea(local),
      sync: storageArea(sync),
      onChanged: {
        addListener(listener) {
          changeListeners.push(listener);
        },
      },
    },
  },
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const settings = sandbox.window.RemoteSettings;
assert.equal(settings.DATA_CONSENT_KEY, 'ljcDataConsentV1');

(async () => {
  assert.equal(await settings.getDataConsent(), null);
  await settings.setDataConsent('granted');
  assert.equal(local.ljcDataConsentV1, 'granted');
  assert.equal(await settings.getDataConsent(), 'granted');

  await settings.setDataConsent('declined');
  assert.equal(await settings.getDataConsent(), 'declined');
  await assert.rejects(settings.setDataConsent('maybe'), /granted.*declined/);

  let observed;
  settings.onDataConsentChange((value) => {
    observed = value;
  });
  changeListeners.at(-1)(
    { ljcDataConsentV1: { oldValue: 'declined', newValue: 'granted' } },
    'local'
  );
  assert.equal(observed, 'granted');

  changeListeners.at(-1)(
    { ljcDataConsentV1: { oldValue: 'granted', newValue: 'declined' } },
    'sync'
  );
  assert.equal(observed, 'granted', 'sync changes must not alter local consent');

  console.log('Settings tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
