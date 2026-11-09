const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findFuelType, planWingLoad, truckCheck } = require('../public/wing-loading.js');

const b737 = findFuelType('737');

test('findFuelType recognises the common airline type strings', () => {
    assert.equal(findFuelType('737').key, 'b737ng');
    assert.equal(findFuelType('B738').key, 'b737ng');
    assert.equal(findFuelType('B739M').key, 'b737max9');
    assert.equal(findFuelType('E75').key, 'e175');
    assert.equal(findFuelType('E175').key, 'e175');
    assert.equal(findFuelType('A320').key, 'a320');
    assert.equal(findFuelType('C172'), undefined);
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
    const e175 = findFuelType('E175');
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
