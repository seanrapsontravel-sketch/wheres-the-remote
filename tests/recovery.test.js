const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'recovery.js'), 'utf8');

let tabs = [];
const insertedCss = [];
const injectedFiles = [];
const activeTabs = new Set();
const listeners = { installed: null, startup: null, historyStateUpdated: null };
let historyStateUpdatedFilter = null;

const sandbox = {
  self: {},
  chrome: {
    runtime: {
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onStartup: { addListener(listener) { listeners.startup = listener; } },
    },
    tabs: {
      async query() { return tabs; },
    },
    scripting: {
      async insertCSS(options) { insertedCss.push(options); },
      async executeScript(options) {
        if (options.func) {
          return [{ frameId: 0, result: activeTabs.has(options.target.tabId) }];
        }
        injectedFiles.push(options);
        activeTabs.add(options.target.tabId);
        return [{ frameId: 0 }];
      },
    },
    webNavigation: {
      onHistoryStateUpdated: {
        addListener(listener, filter) {
          listeners.historyStateUpdated = listener;
          historyStateUpdatedFilter = filter;
        },
      },
    },
  },
  Promise,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

assert.equal(typeof listeners.installed, 'function');
assert.equal(typeof listeners.startup, 'function');
assert.equal(typeof listeners.historyStateUpdated, 'function');
assert.ok(Array.isArray(historyStateUpdatedFilter && historyStateUpdatedFilter.url));

(async () => {
  tabs = [{ id: 42 }];
  const recovery = sandbox.self.RemoteContentRecovery;

  await recovery.recoverExistingJobTabs();
  assert.equal(insertedCss.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(insertedCss[0])), {
    target: { tabId: 42 },
    files: ['src/badge.css'],
  });
  assert.equal(injectedFiles.length, 1);
  assert.equal(injectedFiles[0].files.at(-1), 'src/content.js');

  await recovery.recoverExistingJobTabs();
  assert.equal(insertedCss.length, 1, 'an active tab must not receive duplicate CSS');
  assert.equal(injectedFiles.length, 1, 'an active tab must not receive duplicate scripts');

  // A tab that reaches a supported URL via SPA routing (no document load,
  // so the manifest content_scripts entry never fired) must still get the
  // checker injected once its onHistoryStateUpdated event arrives.
  await listeners.historyStateUpdated({ tabId: 99, frameId: 0 });
  assert.equal(injectedFiles.length, 2, 'a new SPA-routed tab must be injected');
  assert.ok(activeTabs.has(99));

  // A subframe's history update (frameId !== 0) is not a top-level SPA
  // route change and must be ignored.
  await listeners.historyStateUpdated({ tabId: 100, frameId: 5 });
  assert.equal(injectedFiles.length, 2, 'a subframe history update must not trigger injection');

  // A tab already active must not be re-injected on a further SPA route
  // change within the same document.
  await listeners.historyStateUpdated({ tabId: 99, frameId: 0 });
  assert.equal(injectedFiles.length, 2, 'an already-active tab must not receive duplicate scripts');

  console.log('Recovery tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
