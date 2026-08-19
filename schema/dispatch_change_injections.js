// Console injection snippets for eyeballing the MEL banner and dispatch
// change banners (fuel/gate/time) locally at http://localhost:3000/fuel_dispatch
// without waiting for a real one to happen. Paste directly into DevTools.
//
// Not loaded by the app - copy/paste sections into the browser console.


// ---------------------------------------------------------------------
// 1. Pause auto-refresh first, so injected data doesn't get overwritten
//    by the next 30s poll. Resume later with startMonitoring(), or just
//    reload the page.
// ---------------------------------------------------------------------

clearInterval(monitoringInterval);


// ---------------------------------------------------------------------
// 2. MEL banner only - real MELMessage format as captured from a live
//    dispatch (two real newlines after REMARKS / MEL ITEMS, then one
//    space-padded line that gets collapsed by white-space: pre-line).
// ---------------------------------------------------------------------

currentDispatches = [{
  TransactionID: "fake-mel-demo", FlightNumber: "AA2144", Destination: "DFW",
  FlightStatus: "Planned", TailNumber: "N922NN", AirlineName: "AA/American Airlines",
  AircraftType: "738K", DepartureDate: "2026-07-05 14:37",
  QuantityInWeight: 34127, Quantity: 5093.6,
  MEL: true, MELMessage: "REMARKS\nMEL ITEMS\nMEL 0626D  3076C10   28-03A        L WING PMP LOWPSI LT28 03A"
}, ...currentDispatches];
displayDispatchData(currentDispatches);


// ---------------------------------------------------------------------
// 3. Single fuel/gate/time change - simulates a "before" poll then an
//    "after" poll so detectDispatchChanges() has something to diff.
// ---------------------------------------------------------------------

const baseline = {
  TransactionID: "fake-change-demo-1", FlightID: "fake-flight-demo",
  FlightNumber: "AA2144", Destination: "DFW", FlightStatus: "Planned",
  TailNumber: "N922NN", AirlineName: "AA/American Airlines", AircraftType: "738K",
  DepartureDate: "2026-07-05 14:37", ArrivalDate: "2026-07-05 16:10",
  QuantityInWeight: 20000, Quantity: 2985, Gate: "B2", MEL: false, MELMessage: null
};
detectDispatchChanges([baseline]);

const updated = {
  ...baseline,
  QuantityInWeight: 23000,
  Quantity: 3432,
  Gate: "C4",
  DepartureDate: "2026-07-05 15:10"
};
detectDispatchChanges([updated]);

currentDispatches = [updated, ...currentDispatches];
displayDispatchData(currentDispatches);


// ---------------------------------------------------------------------
// 4. Every combination in one shot - five cards: MEL only, fuel-only,
//    gate-only, multiple stacked time changes, and everything at once.
//
//    detectDispatchChanges() prunes any flight missing from the array
//    it's given - that's correct for real polls (fetchDispatchData
//    always passes QT's full current dispatch list), but it means this
//    demo must call it the same way: once per simulated poll, with the
//    full set of demo flights each time, not one call per flight.
//
//    Safe to paste more than once in the same session: it clears out
//    any leftover tracking state from a previous run of this section
//    first, so a re-paste doesn't get read as a "real" change against
//    whatever the last run left behind.
// ---------------------------------------------------------------------

['demo-mel', 'demo-fuel', 'demo-gate', 'demo-time', 'demo-all'].forEach(k => {
  previousDispatchSnapshots.delete(k);
  dispatchChanges.delete(k);
});

function makeBaseline(overrides) {
  return {
    TransactionID: `demo-${overrides.FlightID}`, FlightNumber: overrides.FlightID,
    Destination: 'DFW', FlightStatus: 'Planned', TailNumber: 'N922NN',
    AirlineName: 'AA/American Airlines', AircraftType: '738K',
    DepartureDate: '2026-07-05 14:37', ArrivalDate: '2026-07-05 16:10',
    QuantityInWeight: 20000, Quantity: 2985, Gate: 'B2',
    MEL: false, MELMessage: null,
    ...overrides
  };
}

// Poll 1 (baseline) - all five flights, nothing has changed yet.
let melOnly = makeBaseline({ FlightID: 'demo-mel', FlightNumber: 'AA1001',
  MEL: true, MELMessage: 'REMARKS\nMEL ITEMS\nMEL 0626D  3076C10   28-03A        L WING PMP LOWPSI LT28 03A' });
let fuel = makeBaseline({ FlightID: 'demo-fuel', FlightNumber: 'AA1002' });
let gate = makeBaseline({ FlightID: 'demo-gate', FlightNumber: 'AA1003' });
let time = makeBaseline({ FlightID: 'demo-time', FlightNumber: 'AA1004' });
let all = makeBaseline({ FlightID: 'demo-all', FlightNumber: 'AA1005' });
detectDispatchChanges([melOnly, fuel, gate, time, all]);

// Poll 2 - fuel/gate/time each change once; "all" starts changing too.
fuel = { ...fuel, QuantityInWeight: 23000, Quantity: 3432 };
gate = { ...gate, Gate: 'C4' };
time = { ...time, DepartureDate: '2026-07-05 14:50' };
all = { ...all, QuantityInWeight: 24500, Quantity: 3656, Gate: 'D1', DepartureDate: '2026-07-05 15:00' };
detectDispatchChanges([melOnly, fuel, gate, time, all]);

// Poll 3 - "time" slips again; "all" picks up its MEL and slips too.
time = { ...time, DepartureDate: '2026-07-05 15:10' };
all = { ...all, DepartureDate: '2026-07-05 15:20', MEL: true,
  MELMessage: 'REMARKS\nMEL ITEMS\nMEL 0626D  3076C10   28-03A        L WING PMP LOWPSI LT28 03A' };
detectDispatchChanges([melOnly, fuel, gate, time, all]);

// Poll 4 - "time" slips a third time, so its card shows 3 stacked lines.
time = { ...time, DepartureDate: '2026-07-05 15:35' };
detectDispatchChanges([melOnly, fuel, gate, time, all]);

currentDispatches = [melOnly, fuel, gate, time, all];
displayDispatchData(currentDispatches);
