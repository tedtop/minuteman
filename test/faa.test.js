'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isUsTail, mapFaaToIcao } = require('../api/_faa.js');

// Manufacturer/model pairs as the FAA registry writes them. The first five
// are today's real dispatch tails (N47412, N36444, N326CJ/N210NN, N610UX).
const CASES = [
    ['BOEING', '737-9', 'B39M'],
    ['BOEING', '737-924ER', 'B739'],
    ['BOEING', '737-824', 'B738'],
    ['BOEING', '757-222', 'B752'],
    ['BOEING', '767-332', 'B763'],
    ['EMBRAER S A', 'ERJ 170-200 LR', 'E75L'],
    ['EMBRAER S A', 'ERJ 170-200 LL', 'E75L'],
    ['EMBRAER S A', 'ERJ 170-200 ST', 'E75S'],
    ['EMBRAER S A', 'ERJ 170-100 LR', 'E170'],
    ['AIRBUS', 'A321-271NX', 'A21N'],
    ['AIRBUS', 'A320-232', 'A320'],
    ['AIRBUS INDUSTRIE', 'A319-132', 'A319'],
    ['BOMBARDIER INC', 'CL-600-2C10', 'CRJ7'],
    ['BOMBARDIER INC', 'CL-600-2D24', 'CRJ9']
];

for (const [maker, model, expected] of CASES) {
    test(`${maker} ${model} -> ${expected}`, () => assert.equal(mapFaaToIcao(maker, model), expected));
}

test('unmappable or empty input returns null instead of guessing', () => {
    assert.equal(mapFaaToIcao('BOEING', 'ZZZ-123'), null);
    assert.equal(mapFaaToIcao('NO SUCH MAKER', '737-9'), null);
    assert.equal(mapFaaToIcao('', ''), null);
});

test('isUsTail', () => {
    assert.ok(isUsTail('N47412'));
    assert.ok(isUsTail('N610UX'));
    assert.ok(!isUsTail('B-2071'));
    assert.ok(!isUsTail('C-FABC'));
});
