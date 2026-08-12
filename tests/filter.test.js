const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A minimal fake clock, so the fade delay can be driven deterministically
// rather than waited out.
const timers = new Map();
let nextTimerId = 1;

const sandbox = {
  window: {
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  },
  WeakMap,
  Set,
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'filter.js'), 'utf8'),
  sandbox
);

function runPendingTimers() {
  const pending = Array.from(timers.entries());
  timers.clear();
  pending.forEach(([, timer]) => timer.fn());
}

// Just enough of an element for classList.add/remove/contains.
function fakeCard() {
  const classes = new Set();
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    get className() {
      return Array.from(classes).sort().join(' ');
    },
  };
}

const { shouldHide, applyVisibility, HIDDEN_CATEGORIES } = sandbox.window.RemoteFilter;

assert.deepEqual(Array.from(HIDDEN_CATEGORIES).sort(), ['HYBRID', 'NOT_REMOTE']);

// Disabled: never hides, regardless of category.
assert.equal(shouldHide({ status: 'done', category: 'HYBRID' }, false), false);
assert.equal(shouldHide({ status: 'done', category: 'NOT_REMOTE' }, false), false);

// Enabled: only HYBRID/NOT_REMOTE, and only once classification is done.
assert.equal(shouldHide({ status: 'done', category: 'HYBRID' }, true), true);
assert.equal(shouldHide({ status: 'done', category: 'NOT_REMOTE' }, true), true);
assert.equal(shouldHide({ status: 'done', category: 'TRUE_REMOTE' }, true), false);
assert.equal(shouldHide({ status: 'done', category: 'REMOTE_TRAVEL' }, true), false);
assert.equal(shouldHide({ status: 'done', category: 'UNCLEAR' }, true), false);
assert.equal(shouldHide({ status: 'loading' }, true), false);
assert.equal(shouldHide({ status: 'error' }, true), false);
assert.equal(shouldHide(null, true), false);
assert.equal(shouldHide(undefined, true), false);

// --- applyVisibility: the fade must be cancellable -------------------------

// Hiding fades first, then collapses once the CSS transition has run.
const hiding = fakeCard();
applyVisibility(hiding, true);
assert.equal(hiding.className, 'ljc-hiding');
runPendingTimers();
assert.equal(hiding.className, 'ljc-hidden ljc-hiding');

// Regression: unticking the preference mid-fade must cancel the pending
// collapse. Previously the timer was never tracked, so the card reappeared
// and was then hidden again 200ms later, with the preference already off.
const cancelled = fakeCard();
applyVisibility(cancelled, true);
assert.equal(cancelled.className, 'ljc-hiding');
applyVisibility(cancelled, false);
assert.equal(cancelled.className, '');
assert.equal(timers.size, 0, 'showing a card must cancel its pending collapse');
runPendingTimers();
assert.equal(cancelled.className, '', 'a cancelled fade must not collapse the card later');

// Re-hiding a card mid-fade must not restart or stack the timer.
const restacked = fakeCard();
applyVisibility(restacked, true);
applyVisibility(restacked, true);
assert.equal(timers.size, 1, 'a fade already in flight must not be duplicated');
runPendingTimers();

// An already-collapsed card is left alone rather than re-faded.
applyVisibility(restacked, true);
assert.equal(timers.size, 0);

// A card can go hidden -> shown -> hidden again and end up correct.
applyVisibility(restacked, false);
assert.equal(restacked.className, '');
applyVisibility(restacked, true);
runPendingTimers();
assert.equal(restacked.className, 'ljc-hidden ljc-hiding');

applyVisibility(null, true); // must not throw

console.log('Filter tests passed.');
