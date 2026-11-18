const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findFuelType, findFuelTypeForQt, planWingLoad, truckCheck } = require('../public/wing-loading.js');

const b737 = findFuelType('B738');

test('findFuelType matches ICAO designators (what the tail lookup returns) only', () => {
    assert.equal(findFuelType('B39M').key, 'b737max9');
    assert.equal(findFuelType('B738').key, 'b737ng');
    assert.equal(findFuelType('b739').key, 'b737ng');
    assert.equal(findFuelType('E75L').key, 'e175');
    assert.equal(findFuelType('A320').key, 'a320');
    assert.equal(findFuelType('CRJ9').key, 'crj700');
    assert.equal(findFuelType('737'), undefined, 'QT codes are not ICAO designators');
    assert.equal(findFuelType('E7W'), undefined);
    assert.equal(findFuelType('A321'), undefined, 'A321 tanks differ');
    assert.equal(findFuelType('C172'), undefined);
    assert.equal(findFuelType(''), undefined);
});

test('findFuelTypeForQt maps the QT type codes seen in dispatch history', () => {
    assert.equal(findFuelTypeForQt('737').key, 'b737ng');
    assert.equal(findFuelTypeForQt('738K').key, 'b737ng');
    assert.equal(findFuelTypeForQt('319').key, 'a320');
    assert.equal(findFuelTypeForQt('E7W').key, 'e175');
    assert.equal(findFuelTypeForQt('E75E').key, 'e175');
    assert.equal(findFuelTypeForQt('OOC7'), undefined, 'unknown codes are not guessed');
    assert.equal(findFuelTypeForQt('E70E'), undefined, 'E170 is not an E175');
    assert.equal(findFuelTypeForQt('B738'), undefined, 'ICAO designators go through findFuelType');
    assert.equal(findFuelTypeForQt(undefined), undefined);
});

// United UA1026 sheet, 10/29: 3740 / 0 / 3900 before, planned gate fuel 20,400 -> add 12,760.
test('fills both wings to the max and puts the rest in the center, like the United sheet', () => {
    const r = planWingLoad({
        capacity: b737,
        wingMaxLbs: 8650,
        before: { left: 3740, center: 0, right: 3900 },
        plannedLbs: 20400
    });
    assert.equal(r.after.left, 8650);
    assert.equal(r.after.right, 8650);
    assert.equal(r.after.center, 3100);
    assert.equal(r.add.center, 3100);
    assert.equal(r.totalAddLbs, 12760);
    assert.ok(Math.abs(r.totalAddGallons - 1879.2) < 0.05);
    assert.equal(r.beforeTotalLbs, 7640);
    assert.deepEqual(r.warnings, []);
});

test('splits a small uplift evenly across the wings and leaves the center empty', () => {
    const r = planWingLoad({ capacity: b737, plannedLbs: 10000 });
    assert.deepEqual(r.after, { left: 5000, center: 0, right: 5000 });
});

test('has no center tank on an E175 and warns when the request will not fit', () => {
    const e175 = findFuelType('E75L');
    assert.equal(planWingLoad({ capacity: e175, plannedLbs: 15000 }).hasCenter, false);
    const over = planWingLoad({ capacity: e175, plannedLbs: 25000 });
    assert.equal(over.after.center, 0);
    assert.match(over.warnings[0], /more than the wings can hold/);
});

test('uses the winter wing max when asked', () => {
    const r = planWingLoad({ capacity: b737, plannedLbs: 30000, winter: true });
    assert.equal(r.after.left, 8800);
});

test('flags a tank that already holds more than the target', () => {
    const r = planWingLoad({ capacity: b737, before: { left: 9000, right: 0 }, plannedLbs: 9500 });
    assert.match(r.warnings.join(), /balance or defuel/);
});

test('truckCheck compares calculated gallons with the truck meter against the 75 gallon tolerance', () => {
    assert.deepEqual(truckCheck(1879.2, 1886), { difference: -7, withinTolerance: true, tolerance: 75 });
    assert.equal(truckCheck(1879, 1700).withinTolerance, false);
});

// Card split: 737s load to 8650 per wing all year, the rest goes in the center.
const { cardSplit, stepWing, clampWing, wingBounds, defaultWingLbs, hardWingMaxLbs } = require('../public/wing-loading.js');
const max9 = findFuelType('B39M');
const e175 = findFuelType('E75L');

test('737 rows default to 8650 per wing, summer and winter', () => {
    for (const t of [b737, max9]) {
        assert.equal(defaultWingLbs(t, false), 8650);
        assert.equal(defaultWingLbs(t, true), 8650);
    }
    // Other types keep the placard figure.
    assert.equal(defaultWingLbs(findFuelType('CRJ7'), true), 7492);
});

test('UA1026 requesting 18400 lbs on a 737 splits 8650/1100/8650', () => {
    for (const winter of [false, true]) {
        const s = cardSplit(b737, 18400, undefined, winter);
        assert.deepEqual([s.left, s.center, s.right], [8650, 1100, 8650]);
        assert.equal(s.hasCenter, true);
        assert.equal(s.adjustable, true);
    }
    assert.deepEqual(cardSplit(max9, 18400, undefined, true).center, 1100);
});

test('the 8650 default above the 8600 summer placard is not clamped away; the hard max is placard or default', () => {
    assert.equal(hardWingMaxLbs(b737, false), 8650);
    assert.equal(hardWingMaxLbs(b737, true), 8800);
    assert.deepEqual(planWingLoad({ capacity: b737, plannedLbs: 18400, wingMaxLbs: 8650 }).warnings, []);
    assert.match(planWingLoad({ capacity: b737, plannedLbs: 30000, wingMaxLbs: 9000, winter: true }).warnings.join(), /over the 8,800 lb wing limit/);
});

test('arrows move the wing 50 lbs at a time and the center follows', () => {
    const down = stepWing(b737, 18400, undefined, -1, true);
    assert.equal(down, 8600);
    assert.equal(cardSplit(b737, 18400, down, true).center, 1200);
    assert.equal(stepWing(b737, 18400, 8600, 1, true), 8650);
    assert.equal(stepWing(b737, 18400, 8650, 1, true), 8700);
});

test('wing cannot pass the placard max (winter 8800, summer 8650 default)', () => {
    assert.equal(stepWing(b737, 18400, 8800, 1, true), 8800);
    assert.equal(stepWing(b737, 18400, 8650, 1, false), 8650);
    const s = cardSplit(b737, 18400, 8800, true);
    assert.equal(s.canIncrease, false);
    assert.equal(s.canDecrease, true);
});

test('center cannot go negative: wing is held at half the planned fuel', () => {
    assert.deepEqual(wingBounds(b737, 10000, true), { min: 0, max: 5000 });
    assert.equal(stepWing(b737, 10000, 5000, 1, true), 5000);
    const s = cardSplit(b737, 10000, undefined, true);
    assert.deepEqual([s.left, s.center, s.right], [5000, 0, 5000]);
    assert.equal(s.canIncrease, false);
});

test('wing cannot go below 0 or below what leaves the center over its capacity', () => {
    assert.equal(stepWing(b737, 1000, 0, -1, true), 0);
    // CRJ700, 14,000 planned: center max 4,610 -> wing at least (14000 - 4610) / 2 = 4695.
    const crj700 = findFuelType('CRJ7');
    assert.deepEqual(wingBounds(crj700, 14000, false), { min: 4695, max: 7000 });
    assert.equal(stepWing(crj700, 14000, 4700, -1, false), 4695);
    assert.equal(stepWing(crj700, 14000, 4695, -1, false), 4695);
    assert.equal(clampWing(crj700, 14000, 1000, false), 4695);
    assert.equal(cardSplit(crj700, 14000, 1000, false).center, 4610);
    assert.equal(cardSplit(crj700, 14000, 4695, false).canDecrease, false);
    // Unknown center size (A320): only the 0 floor applies.
    assert.equal(wingBounds(findFuelType('A320'), 40000, false).min, 0);
});

test('a stored wing figure is re-clamped when QT changes the planned fuel', () => {
    // Stored 8000 on 18400 -> 8000/2400/8000; planned drops to 12000 -> wing held at 6000, center 0.
    assert.equal(cardSplit(b737, 18400, 8000, true).center, 2400);
    const s = cardSplit(b737, 12000, 8000, true);
    assert.deepEqual([s.left, s.center, s.right], [6000, 0, 6000]);
    // And back up again: the stored figure applies unchanged.
    assert.equal(cardSplit(b737, 18400, 8000, true).left, 8000);
});

test('no-center types (E175) split evenly L/R and are not adjustable', () => {
    const s = cardSplit(e175, 15000, undefined, true);
    assert.equal(s.hasCenter, false);
    assert.deepEqual([s.left, s.center, s.right], [7500, 0, 7500]);
    assert.equal(s.adjustable, false);
    assert.equal(s.canIncrease, false);
    assert.equal(s.canDecrease, false);
    // A stored figure or a step changes nothing.
    assert.equal(cardSplit(e175, 15000, 6000, true).left, 7500);
    assert.equal(stepWing(e175, 15000, 7500, 1, true), 7500);
    // Over capacity the wings show full.
    assert.equal(cardSplit(e175, 25000, undefined, true).left, 10390);
});

test('odd planned totals still add up in whole pounds', () => {
    const s = cardSplit(b737, 10001, undefined, true);
    assert.equal(s.left + s.center + s.right, 10001);
});
