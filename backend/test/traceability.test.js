import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EMT-33: docs/Sprint_2_Test_Plan.md maps every acceptance criterion to the automated test that verifies it.
// This test keeps that plan honest: a missing criterion, a renamed test or an untested row fails the build.

const planUrl = new URL('../../docs/Sprint_2_Test_Plan.md', import.meta.url);
const plan = readFileSync(planUrl, 'utf8');

// Acceptance criteria in scope for Sprint 2: story -> number of ACs in its Jira ticket.
const EXPECTED_ACS = { 'EMT-15': 9, 'EMT-16': 9, 'EMT-27': 4, 'EMT-28': 7, 'EMT-29': 6, 'EMT-36': 7, 'EMT-52': 5 };

const titleCache = new Map();
function testSource(file) {
  if (!titleCache.has(file)) {
    titleCache.set(file, readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
  }
  return titleCache.get(file);
}

function titlesOf(file) {
  const titles = [];
  const pattern = /\btest\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (const match of testSource(file).matchAll(pattern)) {
    titles.push({ title: (match[1] ?? match[2]).replaceAll("\\'", "'").replaceAll('\\"', '"'), index: match.index });
  }
  return titles;
}

function findTest(reference) {
  const [file, fragment] = reference.split(' :: ');
  return titlesOf(file).find(({ title }) => title.includes(fragment));
}

const rows = plan
  .split('\n')
  .filter((line) => line.startsWith('|'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

const referencesIn = (cell) => [...cell.matchAll(/`([^`]+ :: [^`]+)`/g)].map((match) => match[1]);
const acRows = rows.filter((cells) => /^EMT-\d+ AC\d+$/.test(cells[0]));

test('every automated test named anywhere in the plan exists', () => {
  const references = rows.flatMap((cells) => cells.flatMap(referencesIn));
  assert.ok(references.length > 40, `expected many test references, found ${references.length}`);
  for (const reference of references) {
    assert.ok(findTest(reference), `Test plan references a test that does not exist: ${reference}`);
  }
});

test('every in-scope acceptance criterion has exactly one row in the plan', () => {
  for (const [story, count] of Object.entries(EXPECTED_ACS)) {
    const numbers = acRows
      .map((cells) => cells[0].match(/^(EMT-\d+) AC(\d+)$/))
      .filter((match) => match[1] === story)
      .map((match) => Number(match[2]))
      .sort((a, b) => a - b);
    assert.deepEqual(numbers, Array.from({ length: count }, (_value, index) => index + 1), `${story} acceptance criteria`);
  }
  const unexpected = acRows.map((cells) => cells[0].split(' ')[0]).filter((story) => !(story in EXPECTED_ACS));
  assert.deepEqual(unexpected, [], 'rows for stories missing from EXPECTED_ACS');
});

test('each criterion is verified by a test, or is explicitly marked DEFERRED or DEFECT', () => {
  for (const cells of acRows) {
    // Columns: story AC | test ID | RTM ID | scenario | expected result | automated test | status
    const [criterion, , , , , testCell, status] = cells;
    const references = referencesIn(testCell);
    if (status.startsWith('DEFERRED')) {
      assert.equal(references.length, 0, `${criterion} is deferred but names a test`);
    } else if (status.startsWith('DEFECT')) {
      assert.ok(references.length > 0, `${criterion} is a defect but has no todo test`);
      for (const reference of references) {
        const found = findTest(reference);
        const [file] = reference.split(' :: ');
        assert.match(testSource(file).slice(found.index, found.index + 220), /todo/, `${criterion}: ${reference} must be a todo test`);
      }
    } else {
      assert.match(status, /^(PASS|PARTIAL)/, `${criterion} has status "${status}"`);
      assert.ok(references.length > 0, `${criterion} has no automated test`);
    }
  }
});

test('plan test IDs are unique', () => {
  const ids = acRows.map((cells) => cells[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate test IDs: ${ids.join(', ')}`);
});

test('each defect in the plan has a todo test that describes the expected behaviour', () => {
  const defectRows = rows.filter((cells) => /^BUG-S2-\d+$/.test(cells[0]));
  assert.ok(defectRows.length >= 3);
  for (const cells of defectRows) {
    const references = referencesIn(cells.at(-1));
    assert.ok(references.length > 0, `${cells[0]} has no automated test`);
    for (const reference of references) {
      const found = findTest(reference);
      assert.match(testSource(reference.split(' :: ')[0]).slice(found.index, found.index + 260), /todo/, `${cells[0]} must be a todo test`);
    }
  }
});
