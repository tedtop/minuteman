// Wing loading on the dispatch cards. The green fuel box shows the planned gate fuel split L wing /
// center / R wing, with arrows that move the per-wing figure in 50 lb steps (the adjusted figure is kept
// per flight in this browser's localStorage, nothing else). The "Fuel sheet" dialog is the airline's
// routine fuel service form, worked out for the fueler: type what each tank holds on arrival and every
// line to write on the sheet is filled in. Mirrors fbo-manager's wing-loading-panel.tsx.
//
// The dispatch cards are rebuilt on every poll, so the dialog is one shared element outside them: its
// inputs survive a refresh, and an open dialog picks up a changed planned gate fuel from QT.
(function () {
    const WL = window.WingLoading;
    if (!WL) return;

    const TANKS = [
        { key: 'left', label: 'L Wing' },
        { key: 'center', label: 'Center' },
        { key: 'right', label: 'R Wing' }
    ];

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (value) => {
        const n = Number.parseFloat(value);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const fmt = (n) => Math.round(n).toLocaleString();
    // Nov-Mar uses the placard's winter wing figure.
    const isWinter = () => [10, 11, 0, 1, 2].includes(new Date().getMonth());

    let dlg = null;
    let ctx = null; // { id, typeKey, plannedLbs, title }

    // The fuel-type row for a dispatch: ADS-B's specific variant (B39M) when it is one we know, else QT's type.
    function fuelTypeFor(aircraftType, equipmentCode) {
        return WL.findFuelType(equipmentCode) || WL.findFuelType(aircraftType);
    }

    // Adjusted per-wing figures, per flight, in this browser only. { [id]: { wing, t } }; entries older
    // than three days are dropped on write. Every access is guarded: storage can be missing or throw.
    const STORE_KEY = 'wingLoad.adjustedWing.v1';
    const STORE_MAX_AGE_MS = 3 * 24 * 3600 * 1000;

    function readStore() {
        try {
            const v = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
            return v && typeof v === 'object' ? v : {};
        } catch (e) {
            return {};
        }
    }

    function storedWing(id) {
        if (!id) return undefined;
        const entry = readStore()[id];
        const n = entry && Number(entry.wing);
        return Number.isFinite(n) ? n : undefined;
    }

    function saveWing(id, wing) {
        if (!id) return;
        try {
            const store = readStore();
            const now = Date.now();
            for (const k of Object.keys(store)) {
                if (!store[k] || !(now - store[k].t < STORE_MAX_AGE_MS)) delete store[k];
            }
            store[id] = { wing, t: now };
            window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
        } catch (e) {
            // Storage unavailable (private mode, blocked): the adjustment just lasts until the next poll.
        }
    }

    const typeByKey = (key) => WL.AIRCRAFT_FUEL_TYPES.find((t) => t.key === key);

    // Inner HTML of the green fuel box for a known type: "18400 lbs ◀ (8650/1100/8650) ▶".
    function fuelBoxInner(fuelType, plannedLbs, id) {
        const s = WL.cardSplit(fuelType, plannedLbs, storedWing(id), isWinter());
        const split = s.hasCenter ? `${s.left}/${s.center}/${s.right}` : `${s.left}/${s.right}`;
        const label = s.hasCenter ? 'L wing / center / R wing, lbs' : 'L wing / R wing, lbs';
        const arrow = (dir, ch, enabled, what) => s.adjustable
            ? `<button type="button" class="wl-step" data-wl-step="${dir}" ${enabled ? '' : 'disabled'}
                       aria-label="${what} per wing (${WL.WING_STEP_LBS} lbs)">${ch}</button>`
            : '';
        return `<span class="wl-planned">${plannedLbs} lbs</span>
                <span class="wl-split-group">
                    ${arrow(-1, '&#9664;', s.canDecrease, 'Less')}
                    <span class="wl-split" title="${label}">(${split})</span>
                    ${arrow(1, '&#9654;', s.canIncrease, 'More')}
                </span>`;
    }

    const ctxAttrs = (dispatch, fuelType, plannedLbs) => {
        const id = dispatch.FlightID || dispatch.TransactionID || '';
        const title = [dispatch.FlightNumber, dispatch.TailNumber].filter(Boolean).join(' ');
        return { id, title, attrs: `data-wl-id="${esc(id)}" data-wl-type="${fuelType.key}" data-wl-planned="${plannedLbs}" data-wl-title="${esc(title)}"` };
    };

    function known(dispatch, equipmentCode) {
        const fuelType = fuelTypeFor(dispatch.AircraftType, equipmentCode);
        const plannedLbs = Number(dispatch.QuantityInWeight);
        return fuelType && plannedLbs > 0 ? { fuelType, plannedLbs } : null;
    }

    // The green fuel box with the wing split, or null for types we have no tank table for (the card then
    // keeps its plain "lbs (gal)" box).
    function fuelBoxHtml(dispatch, equipmentCode) {
        const k = known(dispatch, equipmentCode);
        if (!k) return null;
        const { id, attrs } = ctxAttrs(dispatch, k.fuelType, k.plannedLbs);
        return `<div class="fuel-quantity wl-fuel" ${attrs}>${fuelBoxInner(k.fuelType, k.plannedLbs, id)}</div>`;
    }

    // The "Fuel sheet" button row under the fuel box; '' for types we have no tank table for.
    function cardHtml(dispatch, equipmentCode) {
        const k = known(dispatch, equipmentCode);
        if (!k) return '';
        const { attrs } = ctxAttrs(dispatch, k.fuelType, k.plannedLbs);
        return `<div class="wing-loading" ${attrs}>
                    <button type="button" class="wing-loading-btn">&#129518; Fuel sheet</button>
                </div>`;
    }

    // The card's current wing figure (stored adjustment or default, clamped) for a .wl-fuel / .wing-loading element.
    function currentWing(el) {
        const fuelType = typeByKey(el.dataset.wlType);
        return WL.cardSplit(fuelType, Number(el.dataset.wlPlanned), storedWing(el.dataset.wlId), isWinter()).wing;
    }

    function step(btn) {
        const box = btn.closest('.wl-fuel');
        const fuelType = typeByKey(box.dataset.wlType);
        const planned = Number(box.dataset.wlPlanned);
        const winter = isWinter();
        const id = box.dataset.wlId;
        const next = WL.stepWing(fuelType, planned, storedWing(id), Number(btn.dataset.wlStep), winter);
        saveWing(id, next);
        box.innerHTML = fuelBoxInner(fuelType, planned, id);
        const again = box.querySelector(`.wl-step[data-wl-step="${btn.dataset.wlStep}"]`);
        if (again && !again.disabled) again.focus();
    }

    function buildDialog() {
        dlg = document.createElement('div');
        dlg.className = 'wl-overlay';
        dlg.style.display = 'none';
        dlg.innerHTML = `
            <div class="wl-dialog" role="dialog" aria-modal="true" aria-labelledby="wlTitle">
                <button type="button" class="wl-close" aria-label="Close">&times;</button>
                <h3 id="wlTitle"></h3>
                <p class="wl-desc">Type what each tank holds on arrival; write the bold numbers on the airline sheet.</p>
                <div class="wl-controls">
                    <select id="wlType" aria-label="Aircraft fuel type">
                        ${WL.AIRCRAFT_FUEL_TYPES.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}
                    </select>
                    <label>Wing max <input id="wlWingMax" inputmode="numeric" style="width:70px"></label>
                    <label>lbs/gal <input id="wlDensity" inputmode="decimal" style="width:58px" value="${WL.DEFAULT_DENSITY}"></label>
                </div>
                <table class="wl-table">
                    <thead><tr><th class="wl-left">Tank</th><th>Before</th><th>Desired</th><th>Add (lbs)</th></tr></thead>
                    <tbody id="wlRows"></tbody>
                </table>
                <div class="wl-lines" id="wlLines"></div>
                <div class="wl-warnings" id="wlWarnings"></div>
                <p class="wl-note" id="wlUnverified"></p>
            </div>`;
        document.body.appendChild(dlg);

        const rows = dlg.querySelector('#wlRows');
        rows.innerHTML = TANKS.map((t) => `
            <tr data-tank="${t.key}">
                <td class="wl-left">${t.label}</td>
                <td><input class="wl-before" data-tank="${t.key}" inputmode="numeric" placeholder="0" aria-label="${t.label} before, lbs"></td>
                <td class="wl-desired wl-bold"></td>
                <td class="wl-add"></td>
            </tr>`).join('') + `
            <tr class="wl-total"><td class="wl-left">Total</td><td id="wlBeforeTotal"></td><td class="wl-bold" id="wlAfterTotal"></td><td id="wlAddTotal"></td></tr>`;

        dlg.querySelector('#wlLines').innerHTML = `
            <div class="wl-line"><span>Planned gate fuel</span><b id="wlPlanned"></b></div>
            <div class="wl-line"><span>Subtract before fuel total</span><b id="wlBeforeLine"></b></div>
            <div class="wl-line"><span>Equals pounds to add</span><b id="wlAddLine"></b></div>
            <div class="wl-line"><span>Divided by density</span><b id="wlDensityLine"></b></div>
            <div class="wl-line"><span>Calculated gallons to add</span><b id="wlGallons"></b></div>
            <div class="wl-line"><span>Subtract total gallons added (truck meter)</span>
                <input id="wlTruck" inputmode="numeric" placeholder="gal" aria-label="Gallons added by the truck" style="width:70px"></div>
            <div class="wl-line"><span id="wlTolLabel"></span><span id="wlCheck"></span></div>`;

        dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('.wl-close')) close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg.style.display !== 'none') close(); });
        dlg.addEventListener('input', render);
        dlg.querySelector('#wlType').addEventListener('change', (e) => { ctx.typeKey = e.target.value; render(); });
    }

    function render() {
        if (!ctx) return;
        const $ = (id) => dlg.querySelector('#' + id);
        const fuelType = WL.AIRCRAFT_FUEL_TYPES.find((t) => t.key === ctx.typeKey);
        const winter = isWinter();
        $('wlTitle').textContent = 'Fuel sheet' + (ctx.title ? ': ' + ctx.title : '');
        $('wlType').value = fuelType.key;
        $('wlWingMax').placeholder = String(WL.defaultWingLbs(fuelType, winter));

        const beforeIn = {};
        dlg.querySelectorAll('.wl-before').forEach((el) => { beforeIn[el.dataset.tank] = num(el.value); });
        const r = WL.planWingLoad({
            capacity: fuelType,
            plannedLbs: ctx.plannedLbs,
            winter,
            density: num($('wlDensity').value),
            wingMaxLbs: num($('wlWingMax').value) ?? WL.defaultWingLbs(fuelType, winter),
            before: beforeIn
        });

        dlg.querySelectorAll('#wlRows tr[data-tank]').forEach((tr) => {
            const k = tr.dataset.tank;
            tr.style.display = k === 'center' && !r.hasCenter ? 'none' : '';
            tr.querySelector('.wl-desired').textContent = fmt(r.after[k]);
            tr.querySelector('.wl-add').textContent = fmt(r.add[k]);
        });
        $('wlBeforeTotal').textContent = fmt(r.beforeTotalLbs);
        $('wlAfterTotal').textContent = fmt(r.totalAfterLbs);
        $('wlAddTotal').textContent = fmt(r.totalAddLbs);
        $('wlPlanned').textContent = fmt(r.plannedLbs);
        $('wlBeforeLine').textContent = fmt(r.beforeTotalLbs);
        $('wlAddLine').textContent = fmt(r.totalAddLbs);
        $('wlDensityLine').textContent = r.density;
        $('wlGallons').textContent = fmt(r.totalAddGallons);
        $('wlTolLabel').textContent = `Equals (tolerance +${WL.SHEET_TOLERANCE_GAL} / -${WL.SHEET_TOLERANCE_GAL})`;

        const truck = num($('wlTruck').value);
        const checkEl = $('wlCheck');
        if (truck === undefined) {
            checkEl.className = 'wl-muted';
            checkEl.textContent = 'enter truck gallons';
        } else {
            const c = WL.truckCheck(r.totalAddGallons, truck);
            checkEl.className = c.withinTolerance ? 'wl-ok' : 'wl-bad';
            checkEl.innerHTML = `<b>${c.difference} ${c.withinTolerance ? 'OK' : 'out of tolerance'}</b>`;
        }
        $('wlWarnings').innerHTML = r.warnings.map((w) => `<p>${esc(w)}</p>`).join('');
        $('wlUnverified').textContent = fuelType.verified
            ? ''
            : 'Capacities for this type are not yet confirmed from a fuel sheet; check the wing max.';
    }

    function open(el) {
        if (!dlg) buildDialog();
        // Keep what was typed when the same flight is reopened; start clean for another one.
        if (!ctx || ctx.id !== el.dataset.wlId) {
            dlg.querySelectorAll('input:not(#wlDensity)').forEach((i) => { i.value = ''; });
            dlg.querySelector('#wlDensity').value = WL.DEFAULT_DENSITY;
            ctx = { id: el.dataset.wlId, typeKey: el.dataset.wlType };
        }
        ctx.plannedLbs = Number(el.dataset.wlPlanned);
        ctx.title = el.dataset.wlTitle;
        // Open on the card's current (possibly adjusted) wing figure as the wing max.
        dlg.querySelector('#wlWingMax').value = String(currentWing(el));
        dlg.style.display = 'flex';
        render();
    }

    function close() { if (dlg) dlg.style.display = 'none'; }

    // Called after each poll rebuilds the cards: an open dialog follows QT's current planned fuel.
    function refresh(container) {
        if (!dlg || !ctx || dlg.style.display === 'none') return;
        const el = Array.from(container.querySelectorAll('.wing-loading')).find((e) => e.dataset.wlId === ctx.id);
        if (el) { ctx.plannedLbs = Number(el.dataset.wlPlanned); render(); }
    }

    // One delegated listener on the dispatch container: the cards inside are rebuilt on every poll.
    const container = document.getElementById('dispatchContainer');
    if (container) {
        container.addEventListener('click', (e) => {
            const stepBtn = e.target.closest('.wl-step');
            if (stepBtn) { if (!stepBtn.disabled) step(stepBtn); return; }
            const btn = e.target.closest('.wing-loading-btn');
            if (btn) open(btn.closest('.wing-loading'));
        });
    }

    window.WingLoadingUI = { fuelBoxHtml, cardHtml, refresh };
})();
