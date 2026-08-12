const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'site.js'), 'utf8');

function loadSite(hostname, document, href) {
  const sandbox = {
    window: {},
    location: {
      hostname,
      origin: `https://${hostname}`,
      href: href || `https://${hostname}/`,
    },
    document: document || { querySelectorAll: () => [] },
    CSS: { escape: (value) => String(value) },
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.RemoteSite;
}

const linkedin = loadSite('www.linkedin.com');
assert.equal(linkedin.id, 'linkedin');
assert.equal(linkedin.platformName, 'LinkedIn');
assert.equal(linkedin.cacheJobId('12345'), '12345');
assert.equal(linkedin.jobUrl('12345'), 'https://www.linkedin.com/jobs/view/12345/');

const classicLinkedinCard = {
  tagName: 'LI',
  parentElement: null,
  hasAttribute: (name) => name === 'data-occludable-job-id',
  getAttribute: (name) => (name === 'data-occludable-job-id' ? '11111' : null),
  querySelector: () => null,
  closest: () => null,
};
const nestedClassicViewCard = {
  closest: (selector) =>
    selector === 'li[data-occludable-job-id]' ? classicLinkedinCard : null,
};
const recommendationTitleLink = {
  href: 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=22222',
};
const recommendationCard = {
  tagName: 'DIV',
  parentElement: null,
  hasAttribute: () => false,
  getAttribute: () => null,
  querySelector: (selector) =>
    selector === 'a.job-card-list__title--link[href*="currentJobId="]'
      ? recommendationTitleLink
      : null,
  closest: () => null,
};
const linkedinCardsDocument = {
  querySelectorAll(selector) {
    if (selector === 'li[data-occludable-job-id]') return [classicLinkedinCard];
    if (selector === '[data-view-name="job-card"]') {
      return [nestedClassicViewCard, recommendationCard];
    }
    return [];
  },
};
const linkedinWithScrollingCards = loadSite(
  'www.linkedin.com',
  linkedinCardsDocument,
  'https://www.linkedin.com/jobs/search/?start=25'
);
const scrollingCards = linkedinWithScrollingCards.findJobCardElements();
assert.equal(scrollingCards.length, 2);
assert.equal(scrollingCards[0], classicLinkedinCard);
assert.equal(scrollingCards[1], recommendationCard);
assert.equal(linkedinWithScrollingCards.extractJobId(recommendationCard), '22222');
assert.equal(linkedinWithScrollingCards.cardsFor('22222')[0], recommendationCard);

const cardOne = { id: 'card-one' };
const cardTwo = { id: 'card-two' };
function title(jobId, card) {
  return {
    closest: () => card,
    getAttribute: (name) => (name === 'data-jk' ? jobId : null),
  };
}
const titleOne = title('abc123', cardOne);
const duplicateTitleOne = title('abc123', cardOne);
const titleTwo = title('def456', cardTwo);
cardOne.matches = () => false;
cardOne.querySelector = (selector) =>
  selector === '[data-testid="text-location"]'
    ? { textContent: 'Remote' }
    : titleOne;
cardTwo.matches = () => false;
cardTwo.querySelector = () => titleTwo;

const indeedDocument = {
  location: { href: 'https://uk.indeed.com/?vjk=abc123' },
  getElementById(id) {
    return id === 'jobDescriptionText'
      ? { innerText: 'A complete inline job description for testing.' }
      : null;
  },
  querySelector() {
    return null;
  },
  querySelectorAll(selector) {
    return selector.includes('abc123')
      ? [titleOne, duplicateTitleOne]
      : [titleOne, duplicateTitleOne, titleTwo];
  },
};
const indeed = loadSite('uk.indeed.com', indeedDocument);
assert.equal(indeed.id, 'indeed');
assert.equal(indeed.platformName, 'Indeed');
assert.equal(indeed.cacheJobId('abc123'), 'indeed_abc123');
assert.equal(indeed.jobUrl('abc123'), 'https://uk.indeed.com/?vjk=abc123');
const foundCards = indeed.findJobCardElements();
assert.equal(foundCards.length, 2);
assert.equal(foundCards[0], cardOne);
assert.equal(foundCards[1], cardTwo);
const matchingCards = indeed.cardsFor('abc123');
assert.equal(matchingCards.length, 1);
assert.equal(matchingCards[0], cardOne);
assert.equal(indeed.extractJobId(cardOne), 'abc123');
assert.equal(indeed.platformLabelForCard(cardOne), 'REMOTE');
assert.equal(
  indeed.descriptionFromCurrentDocument(indeedDocument, 'abc123'),
  'A complete inline job description for testing.'
);
assert.equal(indeed.descriptionFromCurrentDocument(indeedDocument, 'def456'), null);

const indeedSearch = loadSite(
  'uk.indeed.com',
  indeedDocument,
  'https://uk.indeed.com/q-product-manager-jobs.html?start=10&vjk=old#results'
);
assert.equal(
  indeedSearch.jobUrl('new123'),
  'https://uk.indeed.com/q-product-manager-jobs.html?start=10&vjk=new123'
);

console.log('Site adapter tests passed.');
