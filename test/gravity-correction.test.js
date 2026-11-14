'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    correctApiGravityTo60, densityLbsGalAtTemp, apiGravityToSpecificGravity
} = require('../api/fuel_farm/gravity-correction.js');

test('a reading taken at 60F is returned unchanged', () => {
    for (const api of [10, 30, 37, 40, 45, 50, 55, 60]) {
        assert.equal(correctApiGravityTo60(api, 60), api);
    }
});

test('warm fuel reads high, so the 60F value is lower than observed', () => {
    assert.equal(correctApiGravityTo60(42, 80), 40.3);
    assert.equal(correctApiGravityTo60(40, 100), 36.77);
    assert.equal(correctApiGravityTo60(35, 90), 32.72);
});

test('cold fuel reads low, so the 60F value is higher than observed', () => {
    assert.equal(correctApiGravityTo60(42, 40), 43.76);
    assert.ok(correctApiGravityTo60(40, 0) > 40);
});

test('correction is monotonic in temperature and covers each API range', () => {
    // 35 = fuel oil band, 45 = light gas oil (Jet A), 50 = transition, 55 = very light
    for (const api of [35, 45, 50, 55]) {
        let previous = Infinity;
        for (const temp of [20, 40, 60, 80, 100]) {
            const corrected = correctApiGravityTo60(api, temp);
            assert.ok(corrected < previous, `api ${api} @ ${temp}F`);
            previous = corrected;
        }
    }
    assert.equal(correctApiGravityTo60(50, 70), 48.98);
    assert.equal(correctApiGravityTo60(55, 75), 53.18);
});

test('results are rounded to 2 decimal places', () => {
    const corrected = correctApiGravityTo60(41.37, 73.4);
    assert.equal(corrected, Math.round(corrected * 100) / 100);
});

test('densityLbsGalAtTemp: known 60F densities across API ranges', () => {
    assert.equal(densityLbsGalAtTemp(40, 60), 6.879);
    assert.equal(densityLbsGalAtTemp(30, 60), 7.305);
    assert.equal(densityLbsGalAtTemp(50, 60), 6.5);
    assert.equal(densityLbsGalAtTemp(60, 60), 6.16);
    assert.equal(densityLbsGalAtTemp(10, 60), 8.337);
});

test('densityLbsGalAtTemp: fuel is lighter when hot and heavier when cold', () => {
    assert.equal(densityLbsGalAtTemp(40, 100), 6.744);
    assert.equal(densityLbsGalAtTemp(40, 0), 7.078);
    assert.ok(densityLbsGalAtTemp(40, 100) < densityLbsGalAtTemp(40, 60));
    assert.ok(densityLbsGalAtTemp(40, 0) > densityLbsGalAtTemp(40, 60));
});

test('density and correction are consistent: 60F API -> density at T matches observed-API density', () => {
    // Fuel observed at 80F as 42 API corrects to ~40.3 API at 60F; taking that
    // 60F value back out to 80F must land near the density of the 42 API reading.
    const api60 = correctApiGravityTo60(42, 80);
    const backAt80 = densityLbsGalAtTemp(api60, 80);
    const observedDensity = densityLbsGalAtTemp(42, 60) ; // 42 API read directly as if at 60F
    assert.ok(Math.abs(backAt80 - observedDensity) < 0.02);
});

test('apiGravityToSpecificGravity', () => {
    assert.equal(apiGravityToSpecificGravity(10), 1);
    assert.equal(apiGravityToSpecificGravity(40), 0.8251);
    assert.equal(apiGravityToSpecificGravity(0), 1.076);
});
