const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'aggregate.js'), 'utf8'),
  sandbox
);

const { platformLabelFromText, summarize, remoteInsight } = sandbox.window.RemoteAggregate;

assert.equal(platformLabelFromText('London (Remote)\nProduct Manager'), 'REMOTE');
assert.equal(platformLabelFromText('Manchester (Hybrid)'), 'HYBRID');
assert.equal(platformLabelFromText('Bristol (On-site)'), 'ON_SITE');
assert.equal(platformLabelFromText('REMOTE + OCCASIONAL TRAVEL'), null);

const summary = summarize([
  { platformLabel: 'REMOTE', state: { status: 'done', category: 'TRUE_REMOTE' } },
  { platformLabel: 'REMOTE', state: { status: 'done', category: 'HYBRID' } },
  { platformLabel: 'REMOTE', state: { status: 'done', category: 'NOT_REMOTE' } },
  { platformLabel: 'REMOTE', state: { status: 'loading' } },
  { platformLabel: 'HYBRID', state: { status: 'done', category: 'REMOTE_TRAVEL' } },
  { platformLabel: null, state: { status: 'done', category: 'UNCLEAR' } },
  { platformLabel: null, state: { status: 'error' } },
]);

assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
  totalCards: 7,
  checked: 5,
  pending: 1,
  errors: 1,
  trueRemote: 1,
  remoteTravel: 1,
  officeRequired: 2,
  notStated: 1,
  remoteLabelled: 4,
  remoteLabelledChecked: 3,
  remoteLabelledOfficeRequired: 2,
  remoteLabelledOfficeRate: 67,
});
assert.equal(
  remoteInsight(summary),
  '2 of 3 checked LinkedIn “Remote” jobs require regular office attendance (67%). 1 still checking.'
);
assert.equal(
  remoteInsight(summary, 'Indeed'),
  '2 of 3 checked Indeed “Remote” jobs require regular office attendance (67%). 1 still checking.'
);

console.log('Aggregation tests passed.');
