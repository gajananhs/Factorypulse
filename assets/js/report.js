/* FactoryPulse — the daily report form: rows, live KPIs, save, reset, draft. */
(function () {
  'use strict';
  const FP = window.FP;
  const { $, $$, esc } = FP;

  const form = () => $('#reportForm');
  const machineList = () => $('#machineLines');
  const downtimeList = () => $('#downtimeLines');
  const rejectionList = () => $('#rejectionLines');

  let uidSeq = 0;
  const uid = (p) => `${p}${Date.now().toString(36)}${++uidSeq}`;

  const S = { id: null, reportNo: null, savedAt: null, createdAt: null, dirty: false, restoring: false };

  /* Efficiency / Cycle Time — same formula and 28,800s available-working-time
   * basis as the Machine Shop Plan tab, applied to each machine-wise
   * production row:
   *   Cycle Time = (28,800 × Plan Quantity) ÷ Actual Machine Running Time
   *   Efficiency = ((28,800 × Actual Quantity) ÷ Actual Machine Running Time) × 100
   * "Actual Quantity" here is Good qty + Reject qty (total pieces the
   * machine actually ran); "Actual Machine Running Time" is the row's own
   * actual_run_sec input, entered directly — not derived from downtime. */
  const AVAILABLE_SEC = 28800;
  const fmtEff = (v) => (v === null ? '—' : `${v.toFixed(1)}%`);
  const fmtCyc = (v) => (v === null ? '—' : `${v.toFixed(1)} s`);
  function computeEffCyc(planQty, actualQty, runSec) {
    if (runSec <= 0) return { eff: null, cyc: null };
    return { cyc: (AVAILABLE_SEC * planQty) / runSec, eff: ((AVAILABLE_SEC * actualQty) / runSec) * 100 };
  }

  const HEADER = ['report_date', 'shift', 'plant_name', 'section', 'supervisor', 'planned_minutes',
    'manpower_required', 'manpower_present', 'overtime_hours', 'remarks', 'next_actions'];

  /* ---------- Row builders ---------- */
  const numCell = (name, label, attrs = '') =>
    `<label class="cell num"><span class="cell-label">${label}</span><input type="number" name="${name}" min="0" step="1" inputmode="numeric" placeholder="0" ${attrs}></label>`;

  function addMachineRow(data = {}, { focus = false } = {}) {
    const row = document.createElement('div');
    row.className = 'line line-row is-new';
    row.dataset.uid = data.uid || uid('m');
    row.innerHTML = `
      <span class="line-idx"></span>
      <label class="cell"><span class="cell-label">Machine</span><input name="machine" maxlength="80" placeholder="e.g. VMC-01"></label>
      <label class="cell"><span class="cell-label">Part / item</span><input name="item" maxlength="120" placeholder="e.g. Flange 2in 150#"></label>
      <label class="cell cell-wide"><span class="cell-label">Operator</span><input name="operator" maxlength="100" placeholder="Name"></label>
      ${numCell('planned_qty', 'Planned qty', 'max="10000000"')}
      ${numCell('good_qty', 'Good qty', 'max="10000000"')}
      ${numCell('reject_qty', 'Reject qty', 'max="10000000"')}
      <label class="cell num"><span class="cell-label">Ideal cycle (s)</span><input type="number" name="ideal_cycle_sec" min="0" max="86400" step="0.1" inputmode="decimal" placeholder="0"></label>
      <label class="cell num"><span class="cell-label">Downtime (min)</span><input type="number" name="downtime_min" readonly tabindex="-1" value="0" title="Adds up automatically from the downtime log"></label>
      <label class="cell num"><span class="cell-label">Actual Machine Running Time (sec)</span><input type="number" name="actual_run_sec" min="0" max="86400" step="1" inputmode="numeric" placeholder="0"></label>
      <div class="cell"><span class="cell-label">Attainment</span><span class="cell-out" data-out="att">—</span></div>
      <div class="cell" title="((28,800 × Actual qty) ÷ Actual Machine Running Time) × 100"><span class="cell-label">Efficiency</span><span class="cell-out" data-out="eff">—</span></div>
      <div class="cell" title="(28,800 × Plan qty) ÷ Actual Machine Running Time"><span class="cell-label">Cycle Time</span><span class="cell-out" data-out="cyc">—</span></div>
      <button class="icon-btn" type="button" data-remove><svg aria-hidden="true"><use href="#i-x"/></svg></button>`;
    ['machine', 'item', 'operator', 'planned_qty', 'good_qty', 'reject_qty', 'ideal_cycle_sec', 'actual_run_sec'].forEach((k) => {
      if (data[k] !== undefined && data[k] !== null && data[k] !== 0 && data[k] !== '0') row.querySelector(`[name="${k}"]`).value = data[k];
    });
    machineList().appendChild(row);
    setTimeout(() => row.classList.remove('is-new'), 400);
    if (focus) row.querySelector('[name="machine"]').focus();
    return row;
  }

  function reasonOptions(list, selected, placeholder) {
    return `<option value="">${placeholder}</option>` + list.map((r) => `<option${r === selected ? ' selected' : ''}>${esc(r)}</option>`).join('');
  }

  function addDowntimeRow(data = {}, { focus = false } = {}) {
    const row = document.createElement('div');
    row.className = 'line line-row is-new';
    row.innerHTML = `
      <label class="cell"><span class="cell-label">Machine</span><select name="machine_uid"></select></label>
      <label class="cell"><span class="cell-label">Reason</span><select name="reason">${reasonOptions(FP.DOWNTIME_REASONS, data.reason, 'Pick reason')}</select></label>
      <label class="cell num"><span class="cell-label">Minutes</span><input type="number" name="minutes" min="1" max="1440" step="1" inputmode="numeric" placeholder="0"></label>
      <label class="cell cell-wide"><span class="cell-label">Remarks</span><input name="dt_remarks" maxlength="255" placeholder="What happened"></label>
      <button class="icon-btn" type="button" data-remove aria-label="Remove stoppage"><svg aria-hidden="true"><use href="#i-x"/></svg></button>`;
    row.dataset.machineUid = data.machine_uid || '';
    if (data.minutes) row.querySelector('[name="minutes"]').value = data.minutes;
    if (data.remarks) row.querySelector('[name="dt_remarks"]').value = data.remarks;
    downtimeList().appendChild(row);
    refreshMachineSelects();
    setTimeout(() => row.classList.remove('is-new'), 400);
    if (focus) row.querySelector('select').focus();
    return row;
  }

  function addRejectionRow(data = {}, { focus = false } = {}) {
    const row = document.createElement('div');
    row.className = 'line line-row is-new';
    row.innerHTML = `
      <label class="cell"><span class="cell-label">Part / item</span><input name="item" maxlength="120" placeholder="Item"></label>
      <label class="cell"><span class="cell-label">Reason</span><select name="reason">${reasonOptions(FP.REJECT_REASONS, data.reason, 'Pick reason')}</select></label>
      <label class="cell num"><span class="cell-label">Qty</span><input type="number" name="qty" min="1" max="10000000" step="1" inputmode="numeric" placeholder="0"></label>
      <label class="cell"><span class="cell-label">Action</span><select name="action">${FP.REJECT_ACTIONS.map((a) => `<option${a === (data.action || 'Scrap') ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
      <button class="icon-btn" type="button" data-remove aria-label="Remove rejection"><svg aria-hidden="true"><use href="#i-x"/></svg></button>`;
    if (data.item) row.querySelector('[name="item"]').value = data.item;
    if (data.qty) row.querySelector('[name="qty"]').value = data.qty;
    rejectionList().appendChild(row);
    setTimeout(() => row.classList.remove('is-new'), 400);
    if (focus) row.querySelector('input').focus();
    return row;
  }

  const rows = (list) => $$('.line-row', list());

  function machineLabel(row, i) {
    const name = row.querySelector('[name="machine"]').value.trim();
    return name || `Line ${i + 1} (no name yet)`;
  }

  /* Rebuild machine dropdowns in the downtime log, keeping each row's choice. */
  function refreshMachineSelects() {
    const machines = rows(machineList);
    const opts = machines.map((r, i) => `<option value="${r.dataset.uid}">${esc(machineLabel(r, i))}</option>`).join('');
    rows(downtimeList).forEach((row) => {
      const sel = row.querySelector('[name="machine_uid"]');
      const want = row.dataset.machineUid || sel.value;
      sel.innerHTML = `<option value="">Pick machine</option>${opts}`;
      sel.value = machines.some((m) => m.dataset.uid === want) ? want : '';
      row.dataset.machineUid = sel.value;
    });
  }

  function renumber() {
    rows(machineList).forEach((r, i) => {
      r.querySelector('.line-idx').textContent = window.innerWidth <= 720 ? `Machine line ${i + 1}` : i + 1;
      r.querySelector('[data-remove]').setAttribute('aria-label', `Remove machine line ${i + 1}`);
    });
    $('#downtimeEmpty').hidden = rows(downtimeList).length > 0;
    $('#rejectionEmpty').hidden = rows(rejectionList).length > 0;
    $('#downtimeLines .line-head').hidden = rows(downtimeList).length === 0;
    $('#rejectionLines .line-head').hidden = rows(rejectionList).length === 0;
  }

  /* ---------- Reading the form ---------- */
  const val = (row, name) => { const el = row.querySelector(`[name="${name}"]`); return el ? el.value.trim() : ''; };

  function machineBlank(r) {
    return !['machine', 'item', 'operator'].some((k) => val(r, k)) &&
      !['planned_qty', 'good_qty', 'reject_qty', 'ideal_cycle_sec', 'actual_run_sec'].some((k) => FP.num(val(r, k)) > 0);
  }
  function downtimeBlank(r) { return !val(r, 'machine_uid') && !val(r, 'reason') && !FP.int(val(r, 'minutes')) && !val(r, 'dt_remarks'); }
  function rejectionBlank(r) { return !val(r, 'item') && !val(r, 'reason') && !FP.int(val(r, 'qty')); }

  function downtimeByMachine() {
    const map = {};
    rows(downtimeList).forEach((r) => {
      const u = val(r, 'machine_uid');
      if (u) map[u] = (map[u] || 0) + FP.int(val(r, 'minutes'));
    });
    return map;
  }

  /** Report object used for saving, PDF and sharing. Blank rows are dropped. */
  function collect() {
    const f = form();
    const r = {};
    HEADER.forEach((k) => (r[k] = f.elements[k].value.trim()));
    r.planned_minutes = FP.int(r.planned_minutes);
    r.manpower_required = FP.int(r.manpower_required);
    r.manpower_present = FP.int(r.manpower_present);
    r.overtime_hours = Math.max(0, FP.num(r.overtime_hours));

    const dtMap = downtimeByMachine();
    const indexByUid = {};
    r.machines = [];
    rows(machineList).forEach((row) => {
      if (machineBlank(row)) return;
      indexByUid[row.dataset.uid] = r.machines.length;
      r.machines.push({
        machine: val(row, 'machine'), item: val(row, 'item'), operator: val(row, 'operator'),
        planned_qty: FP.int(val(row, 'planned_qty')), good_qty: FP.int(val(row, 'good_qty')),
        reject_qty: FP.int(val(row, 'reject_qty')), ideal_cycle_sec: Math.max(0, FP.num(val(row, 'ideal_cycle_sec'))),
        actual_run_sec: Math.max(0, FP.num(val(row, 'actual_run_sec'))),
        downtime_min: dtMap[row.dataset.uid] || 0,
      });
    });
    r.downtime = rows(downtimeList).filter((row) => !downtimeBlank(row)).map((row) => {
      const mi = indexByUid[val(row, 'machine_uid')];
      return {
        machine_index: mi === undefined ? -1 : mi,
        machine: mi === undefined ? '' : r.machines[mi].machine,
        reason: val(row, 'reason'), minutes: FP.int(val(row, 'minutes')), remarks: val(row, 'dt_remarks'),
      };
    });
    r.rejections = rows(rejectionList).filter((row) => !rejectionBlank(row)).map((row) => ({
      item: val(row, 'item'), reason: val(row, 'reason'), qty: FP.int(val(row, 'qty')), action: val(row, 'action') || 'Scrap',
    }));

    r.id = S.id;
    r.report_no = S.reportNo;
    r.created_at = S.createdAt;
    r.prepared_by = FP.state.user ? FP.state.user.name : '';
    return r;
  }

  /** Raw snapshot of every field (keeps blank rows) for drafts and undo. */
  function snapshot() {
    const f = form();
    const s = { header: {}, machines: [], downtime: [], rejections: [], meta: { ...S } };
    HEADER.forEach((k) => (s.header[k] = f.elements[k].value));
    rows(machineList).forEach((row) => {
      const m = { uid: row.dataset.uid };
      ['machine', 'item', 'operator', 'planned_qty', 'good_qty', 'reject_qty', 'ideal_cycle_sec', 'actual_run_sec'].forEach((k) => (m[k] = val(row, k)));
      s.machines.push(m);
    });
    rows(downtimeList).forEach((row) => s.downtime.push({ machine_uid: val(row, 'machine_uid'), reason: val(row, 'reason'), minutes: val(row, 'minutes'), remarks: val(row, 'dt_remarks') }));
    rows(rejectionList).forEach((row) => s.rejections.push({ item: val(row, 'item'), reason: val(row, 'reason'), qty: val(row, 'qty'), action: val(row, 'action') }));
    return s;
  }

  function clearRows() { [machineList, downtimeList, rejectionList].forEach((l) => rows(l).forEach((r) => r.remove())); }

  function restore(s) {
    S.restoring = true;
    clearRows();
    const f = form();
    HEADER.forEach((k) => (f.elements[k].value = s.header[k] ?? ''));
    (s.machines.length ? s.machines : [{}]).forEach((m) => addMachineRow(m));
    s.downtime.forEach((d) => addDowntimeRow(d));
    s.rejections.forEach((r) => addRejectionRow(r));
    Object.assign(S, { id: null, reportNo: null, savedAt: null, createdAt: null, dirty: false }, s.meta || {});
    S.restoring = false;
    refreshAll();
  }

  function guessShift() {
    const h = new Date().getHours();
    return h >= 6 && h < 14 ? 'A' : h >= 14 && h < 22 ? 'B' : 'C';
  }

  function blankState() {
    const f = form();
    clearRows();
    f.reset();
    f.elements.report_date.value = FP.today();
    f.elements.shift.value = guessShift();
    f.elements.planned_minutes.value = 450;
    f.elements.supervisor.value = FP.state.user ? FP.state.user.name : '';
    addMachineRow();
    addMachineRow();
    Object.assign(S, { id: null, reportNo: null, savedAt: null, createdAt: null, dirty: false });
    $$('.is-invalid', f).forEach((el) => el.classList.remove('is-invalid'));
    refreshAll();
  }

  /* ---------- Live rendering ---------- */
  function kpiCard(label, value, sub, cls) {
    return `<div class="kpi ${cls}">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${value}</span>
      <span class="kpi-sub">${sub}</span>
      <span class="status ${cls}">${FP.statusText(cls)}</span>
    </div>`;
  }

  function renderKpis(k, r) {
    const st = (key, v) => FP.statusOf(key, v);
    const attCls = st('attainment', k.attainment);
    $('#kpiStrip').innerHTML = [
      kpiCard('Plan attainment', FP.fmtPct(k.attainment), `${FP.fmtNum(k.good)} good of ${FP.fmtNum(k.plannedQty)} planned`, attCls),
      kpiCard('OEE', FP.fmtPct(k.oee), k.oee === null ? 'Needs ideal cycle times' : 'Target 65% or more', st('oee', k.oee)),
      kpiCard('Good output', FP.fmtNum(k.good), `${FP.fmtNum(k.total)} pieces produced`, attCls),
      kpiCard('Rejection', FP.fmtPct(k.rejection), `${FP.fmtNum(k.reject)} pieces rejected`, st('rejection', k.rejection)),
      kpiCard('Downtime', `${FP.fmtNum(k.down)}<small style="font-size:.5em;font-weight:600"> min</small>`, k.downtimePct === null ? 'No planned time' : `${FP.fmtPct(k.downtimePct)} of planned time`, st('downtimePct', k.downtimePct)),
      kpiCard('Manpower', k.manpowerRequired ? `${k.manpowerPresent}/${k.manpowerRequired}` : '—',
        k.manpowerRequired ? `${FP.fmtPct(k.manpower, 0)} present${r.overtime_hours ? `, OT ${r.overtime_hours} h` : ''}` : 'Enter required and present', st('manpower', k.manpower)),
    ].join('');
  }

  function renderOee(k) {
    const cls = FP.statusOf('oee', k.oee);
    const meter = (name, v, key, target) => {
      const c = FP.statusOf(key, v);
      const w = v === null ? 0 : Math.max(0, Math.min(100, v));
      return `<div class="meter">
        <span class="meter-name">${name}</span>
        <span class="meter-track" role="img" aria-label="${name} ${FP.fmtPct(v)}, target ${target}%">
          <span class="meter-fill ${c}" style="width:${w}%"></span>
          <span class="meter-target" style="left:${target}%"></span>
        </span>
        <span class="meter-val">${FP.fmtPct(v, 0)}</span>
      </div>`;
    };

    let insight;
    if (!k.machineCount || (!k.plannedQty && !k.total)) {
      insight = 'Enter planned and actual quantities on the machine lines to see where output was lost.';
    } else if (k.performance === null) {
      insight = 'Add the <strong>ideal cycle time</strong> (seconds per piece) on each machine line to calculate performance and OEE.';
    } else {
      const losses = [
        { key: 'a', loss: 100 - k.availability },
        { key: 'p', loss: 100 - k.performance },
        { key: 'q', loss: 100 - k.quality },
      ].sort((x, y) => y.loss - x.loss);
      const top = losses[0];
      if (top.loss < 3) insight = '<strong>Good shift.</strong> All three factors are close to their targets.';
      else if (top.key === 'a') {
        const r0 = k.reasons[0];
        insight = `<strong>Biggest loss: availability.</strong> Machines were stopped ${FP.fmtNum(k.down)} min${r0 ? `, mostly for ${esc(r0.reason.toLowerCase())} (${r0.minutes} min)` : ''}.`;
      } else if (top.key === 'p') {
        insight = '<strong>Biggest loss: performance.</strong> Machines ran slower than their ideal cycle time. Check for minor stops, slow feeds and unlogged downtime.';
      } else {
        insight = `<strong>Biggest loss: quality.</strong> ${FP.fmtNum(k.reject)} pieces were rejected. Review the rejection reasons below.`;
      }
    }

    $('#oeeBreakdown').innerHTML = `
      <div class="oee-equation" aria-label="OEE equals availability times performance times quality">
        <span>${FP.fmtPct(k.availability, 0)}</span><span class="op">×</span>
        <span>${FP.fmtPct(k.performance, 0)}</span><span class="op">×</span>
        <span>${FP.fmtPct(k.quality, 0)}</span><span class="op">=</span>
        <span class="result ${cls}">${FP.fmtPct(k.oee)}</span>
      </div>
      <div class="meters">
        ${meter('Availability', k.availability, 'availability', 85)}
        ${meter('Performance', k.performance, 'performance', 90)}
        ${meter('Quality', k.quality, 'quality', 98)}
      </div>
      <p class="oee-insight">${insight}</p>`;
  }

  function renderBars(k, r) {
    const box = $('#downtimeBars');
    const count = r.downtime.filter((d) => d.minutes > 0).length;
    $('#downtimeTotalNote').textContent = count ? `${FP.fmtNum(k.down)} min across ${count} stoppage${count > 1 ? 's' : ''}` : 'No stoppages logged';
    if (!k.reasons.length) { box.innerHTML = '<p class="bars-empty">Log stoppages below to see which reasons cost the most time.</p>'; return; }
    const max = k.reasons[0].minutes || 1;
    box.innerHTML = k.reasons.map((x) => `
      <div class="bar">
        <span class="bar-name" title="${esc(x.reason)}">${esc(x.reason)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(x.minutes / max) * 100}%"></span></span>
        <span class="bar-val">${FP.fmtNum(x.minutes)} min</span>
      </div>`).join('');
  }

  function renderRows(k, r) {
    const dtMap = downtimeByMachine();
    const pm = FP.int(form().elements.planned_minutes.value);
    rows(machineList).forEach((row) => {
      const dt = dtMap[row.dataset.uid] || 0;
      const dtInput = row.querySelector('[name="downtime_min"]');
      dtInput.value = dt;
      dtInput.classList.toggle('is-invalid', pm > 0 && dt > pm);
      const planned = FP.int(val(row, 'planned_qty'));
      const good = FP.int(val(row, 'good_qty'));
      const reject = FP.int(val(row, 'reject_qty'));
      const att = planned ? (good / planned) * 100 : null;
      const out = row.querySelector('[data-out="att"]');
      out.textContent = FP.fmtPct(att, 0);
      out.className = `cell-out ${FP.statusOf('attainment', att)}`;

      const runSec = FP.num(val(row, 'actual_run_sec'));
      const { eff, cyc } = computeEffCyc(planned, good + reject, runSec);
      row.querySelector('[data-out="eff"]').textContent = fmtEff(eff);
      row.querySelector('[data-out="cyc"]').textContent = fmtCyc(cyc);
    });

    $('#machineTotals').innerHTML = `
      <span>Planned<b>${FP.fmtNum(k.plannedQty)}</b></span>
      <span>Good<b>${FP.fmtNum(k.good)}</b></span>
      <span>Rejected<b>${FP.fmtNum(k.reject)}</b></span>
      <span>Downtime<b>${FP.fmtNum(k.down)} min</b></span>`;

    const hint = $('#rejectMatch');
    if (!r.rejections.length && !k.reject) {
      hint.textContent = 'Break down the rejected quantity by reason.'; hint.classList.remove('is-warn');
    } else if (k.rejBreakdown === k.reject) {
      hint.textContent = `Breakdown matches the ${FP.fmtNum(k.reject)} rejected pieces.`; hint.classList.remove('is-warn');
    } else {
      hint.textContent = `Breakdown totals ${FP.fmtNum(k.rejBreakdown)} pieces, machine lines show ${FP.fmtNum(k.reject)} rejected.`;
      hint.classList.add('is-warn');
    }
  }

  function renderSaveState() {
    const el = $('#saveState');
    if (!S.id) {
      el.innerHTML = '<span class="dot dot-draft"></span>Draft, not saved yet';
    } else if (S.dirty) {
      el.innerHTML = `<span class="dot dot-dirty"></span>${esc(S.reportNo)} has unsaved changes`;
    } else {
      el.innerHTML = `<span class="dot dot-saved"></span>Saved as ${esc(S.reportNo)} at ${esc(FP.fmtDateTime(S.savedAt))}`;
    }
  }

  function refreshAll() {
    refreshMachineSelects();
    renumber();
    const r = collect();
    const k = FP.computeKpis(r);
    renderKpis(k, r);
    renderOee(k);
    renderBars(k, r);
    renderRows(k, r);
    renderSaveState();
  }

  /* ---------- Draft (per user, this browser) ---------- */
  const draftKey = () => (FP.state.user ? `fp_draft_${FP.state.user.id}` : null);
  const writeDraft = FP.debounce(() => {
    const key = draftKey();
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(snapshot())); } catch (e) { /* storage full or blocked */ }
  }, 400);
  function readDraft() {
    const key = draftKey();
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function dropDraft() { const key = draftKey(); if (key) try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  function onChange() {
    if (S.restoring) return;
    if (S.id) S.dirty = true;
    refreshAll();
    writeDraft();
  }

  /* ---------- Validation + save ---------- */
  function validate() {
    const f = form();
    $$('.is-invalid', f).forEach((el) => el.classList.remove('is-invalid'));
    const errors = [];
    const mark = (el, msg) => { if (el) el.classList.add('is-invalid'); errors.push({ el, msg }); };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.elements.report_date.value)) mark(f.elements.report_date, 'Pick the report date.');
    if (FP.int(f.elements.planned_minutes.value) < 1) mark(f.elements.planned_minutes, 'Planned production time must be at least 1 minute.');

    const pm = FP.int(f.elements.planned_minutes.value);
    const machineRows = rows(machineList).filter((r) => !machineBlank(r));
    if (!machineRows.length) mark(rows(machineList)[0]?.querySelector('[name="machine"]'), 'Add at least one machine line.');
    const dtMap = downtimeByMachine();
    machineRows.forEach((r, i) => {
      if (!val(r, 'machine')) mark(r.querySelector('[name="machine"]'), `Machine line ${i + 1} needs a machine name.`);
      if ((dtMap[r.dataset.uid] || 0) > pm) mark(r.querySelector('[name="downtime_min"]'), `Downtime on ${val(r, 'machine') || 'line ' + (i + 1)} is more than the planned time.`);
    });
    rows(downtimeList).filter((r) => !downtimeBlank(r)).forEach((r, i) => {
      const u = val(r, 'machine_uid');
      const linked = rows(machineList).find((m) => m.dataset.uid === u);
      if (!u || !linked || machineBlank(linked)) mark(r.querySelector('[name="machine_uid"]'), `Stoppage ${i + 1} needs a machine.`);
      if (!val(r, 'reason')) mark(r.querySelector('[name="reason"]'), `Stoppage ${i + 1} needs a reason.`);
      if (!FP.int(val(r, 'minutes'))) mark(r.querySelector('[name="minutes"]'), `Stoppage ${i + 1} needs minutes.`);
    });
    rows(rejectionList).filter((r) => !rejectionBlank(r)).forEach((r, i) => {
      if (!val(r, 'reason')) mark(r.querySelector('[name="reason"]'), `Rejection ${i + 1} needs a reason.`);
      if (!FP.int(val(r, 'qty'))) mark(r.querySelector('[name="qty"]'), `Rejection ${i + 1} needs a quantity.`);
    });

    if (errors.length) {
      const first = errors.find((e) => e.el) || errors[0];
      if (first.el) { first.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => first.el.focus({ preventScroll: true }), 300); }
      FP.toast(first.msg + (errors.length > 1 ? ` (${errors.length - 1} more to fix)` : ''), { type: 'error', timeout: 5200 });
      return false;
    }
    return true;
  }

  async function save() {
    if (!validate()) return;
    const btn = $('#btnSave');
    FP.busy(btn, true);
    try {
      const r = collect();
      const body = { ...r };
      delete body.report_no; delete body.created_at; delete body.prepared_by;
      body.downtime = r.downtime.map(({ machine, ...d }) => d);
      const res = await FP.api('save_report.php', { method: 'POST', body });
      const wasNew = !S.id;
      Object.assign(S, { id: res.id, reportNo: res.report_no, savedAt: res.updated_at, createdAt: res.created_at, dirty: false });
      renderSaveState();
      writeDraft();
      document.dispatchEvent(new CustomEvent('fp:saved', { detail: { id: res.id } }));
      FP.toast(wasNew ? `Saved as ${res.report_no}.` : `${res.report_no} updated.`, {
        type: 'good', action: () => (location.hash = '#history'), actionLabel: 'View history',
      });
    } catch (err) {
      FP.toast(err.message, { type: 'error', timeout: 6000 });
    } finally {
      FP.busy(btn, false);
    }
  }

  function reset() {
    const before = snapshot();
    blankState();
    dropDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    FP.toast('Report cleared. Ready for new data.', {
      action: () => { restore(before); writeDraft(); FP.toast('Report restored.'); },
      actionLabel: 'Undo', timeout: 7000,
    });
  }

  /* ---------- Wiring ---------- */
  function onListClick(e) {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    const row = rm.closest('.line-row');
    const list = row.parentElement;
    if (list === machineList() && rows(machineList).length === 1) {
      row.querySelectorAll('input:not([readonly])').forEach((i) => (i.value = ''));
    } else {
      row.remove();
    }
    if (list === machineList()) {
      const lost = rows(downtimeList).filter((r) => r.dataset.machineUid === row.dataset.uid && row.isConnected === false).length;
      if (lost) FP.toast(`${lost} stoppage${lost > 1 ? 's' : ''} lost ${lost > 1 ? 'their' : 'its'} machine. Pick again in the downtime log.`, { timeout: 5200 });
    }
    onChange();
  }

  FP.report = {
    init() {
      const f = form();
      f.addEventListener('input', (e) => {
        if (e.target.name === 'machine_uid') e.target.closest('.line-row').dataset.machineUid = e.target.value;
        if (e.target.classList.contains('is-invalid')) e.target.classList.remove('is-invalid');
        onChange();
      });
      f.addEventListener('change', (e) => {
        if (e.target.name === 'machine_uid') e.target.closest('.line-row').dataset.machineUid = e.target.value;
        onChange();
      });
      f.addEventListener('submit', (e) => e.preventDefault());
      [machineList(), downtimeList(), rejectionList()].forEach((l) => l.addEventListener('click', onListClick));

      $('#addMachine').addEventListener('click', () => { addMachineRow({}, { focus: true }); onChange(); });
      $('#addDowntime').addEventListener('click', () => {
        const first = rows(machineList).find((r) => !machineBlank(r));
        addDowntimeRow({ machine_uid: rows(machineList).length === 1 && first ? first.dataset.uid : '' }, { focus: true });
        onChange();
      });
      $('#addRejection').addEventListener('click', () => { addRejectionRow({}, { focus: true }); onChange(); });

      $('#btnSave').addEventListener('click', save);
      $('#btnReset').addEventListener('click', reset);
      $('#btnHistory').addEventListener('click', () => (location.hash = '#history'));
      $('#btnPdf').addEventListener('click', () => FP.exporter.pdf(collect(), $('#btnPdf')));
      $('#btnShare').addEventListener('click', () => FP.exporter.whatsapp(collect()));

      window.addEventListener('resize', FP.debounce(renumber, 150));
      window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

      document.addEventListener('fp:login', () => {
        const d = readDraft();
        if (d && d.machines) restore(d); else blankState();
      });
      document.addEventListener('fp:logout', () => { S.dirty = false; blankState(); });

      blankState();
    },
    collect,
  };
})();
