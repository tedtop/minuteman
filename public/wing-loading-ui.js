// "Fuel sheet" dialog for the dispatch cards: the airline's routine fuel service form, worked out for the
// fueler. Type what each tank holds on arrival and every line to write on the sheet is filled in. Nothing
// is stored. Mirrors fbo-manager's wing-loading-panel.tsx.
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

    function summaryHtml(fuelType, plannedLbs) {
        const r = WL.planWingLoad({ capacity: fuelType, plannedLbs, winter: isWinter() });
        const parts = TANKS.filter((t) => t.key !== 'center' || r.hasCenter)
            .map((t) => `${t.label[0]} ${fmt(r.after[t.key])}`);
        return `Wing loading <span class="wing-loading-split">${parts.join(' &middot; ')} lbs</span>`;
    }

    // The summary line + button appended to a dispatch card; '' for types we have no tank table for.
    function cardHtml(dispatch, equipmentCode) {
        const fuelType = fuelTypeFor(dispatch.AircraftType, equipmentCode);
        const plannedLbs = Number(dispatch.QuantityInWeight);
        if (!fuelType || !(plannedLbs > 0)) return '';
        const id = dispatch.FlightID || dispatch.TransactionID || '';
        const title = [dispatch.FlightNumber, dispatch.TailNumber].filter(Boolean).join(' ');
        return `<div class="wing-loading" data-wl-id="${esc(id)}" data-wl-type="${fuelType.key}"
                     data-wl-planned="${plannedLbs}" data-wl-title="${esc(title)}">
                    <span class="wing-loading-summary">${summaryHtml(fuelType, plannedLbs)}</span>
                    <button type="button" class="wing-loading-btn">&#129518; Fuel sheet</button>
                </div>`;
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
        $('wlWingMax').placeholder = String(winter && fuelType.wingWinterLbs ? fuelType.wingWinterLbs : fuelType.wingLbs);

        const beforeIn = {};
        dlg.querySelectorAll('.wl-before').forEach((el) => { beforeIn[el.dataset.tank] = num(el.value); });
        const r = WL.planWingLoad({
            capacity: fuelType,
            plannedLbs: ctx.plannedLbs,
            winter,
            density: num($('wlDensity').value),
            wingMaxLbs: num($('wlWingMax').value),
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

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.wing-loading-btn');
        if (btn) open(btn.closest('.wing-loading'));
    });

    window.WingLoadingUI = { cardHtml, refresh };
})();
