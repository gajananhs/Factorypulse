/* FactoryPulse — Machine Shop Plan: rows, live Efficiency/Cycle Time, save, history.
 * Self-contained module. Does not modify FP.report, FP.history internals — only
 * uses FP.history.showView() (exposed for this purpose) to switch the visible view. */
(function () {
  'use strict';
  const FP = window.FP;
  const { $, $$, esc } = FP;

  /* Available working time used by both formulas, per the spec:
   *   Cycle Time = (28,800 × Plan Quantity) ÷ Actual Machine Running Time
   *   Efficiency = ((28,800 × Actual Quantity) ÷ Actual Machine Running Time) × 100 */
  const AVAILABLE_SEC = 28800;

  const form = () => $('#mplanForm');
  const rowsBody = () => $('#mspRows');

  let uidSeq = 0;
  const uid = () => `msp${Date.now().toString(36)}${++uidSeq}`;

  const S = { id: null, planNo: null, savedAt: null, createdAt: null, dirty: false, restoring: false };
  let lastAutoName = '';

  /* ---------- Formatting helpers ---------- */
  const fmtDDMMYYYY = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    if (!y || !m || !d) return '';
    return `${d}-${m}-${y}`;
  };
  const fmtEff = (v) => (v === null ? '—' : `${v.toFixed(1)}%`);
  const fmtCyc = (v) => (v === null ? '—' : `${v.toFixed(1)} s`);

  function computeRow(l) {
    const planQty = FP.int(l.plan_qty);
    const actualQty = FP.int(l.actual_qty);
    const sec = FP.num(l.actual_run_sec);
    const cyc = sec > 0 ? (AVAILABLE_SEC * planQty) / sec : null;
    const eff = sec > 0 ? ((AVAILABLE_SEC * actualQty) / sec) * 100 : null;
    return { cyc, eff };
  }

  /* ---------- Row builder ---------- */
  function addRow(data = {}, { focus = false } = {}) {
    const tr = document.createElement('tr');
    tr.className = 'msp-row is-new';
    tr.dataset.uid = data.uid || uid();
    tr.innerHTML = `
      <td class="msp-idx"></td>
      <td><input name="machine" maxlength="80" placeholder="e.g. CNC-01"></td>
      <td><input name="part_number" maxlength="80" placeholder="Part number"></td>
      <td><input name="opn" maxlength="40" placeholder="OPN"></td>
      <td><input type="number" name="plan_qty" min="0" step="1" inputmode="numeric" placeholder="0"></td>
      <td><input type="number" name="actual_qty" min="0" step="1" inputmode="numeric" placeholder="0"></td>
      <td><input type="number" name="actual_run_sec" min="0" step="1" inputmode="numeric" placeholder="0"></td>
      <td><input name="remarks" maxlength="255" placeholder=""></td>
      <td class="msp-out" data-out="eff">—</td>
      <td class="msp-out" data-out="cyc">—</td>
      <td><button class="icon-btn" type="button" data-remove aria-label="Remove row"><svg aria-hidden="true"><use href="#i-x"/></svg></button></td>`;
    ['machine', 'part_number', 'opn', 'plan_qty', 'actual_qty', 'actual_run_sec', 'remarks'].forEach((k) => {
      if (data[k] !== undefined && data[k] !== null && data[k] !== '' && data[k] !== 0 && data[k] !== '0') {
        tr.querySelector(`[name="${k}"]`).value = data[k];
      }
    });
    rowsBody().appendChild(tr);
    setTimeout(() => tr.classList.remove('is-new'), 400);
    if (focus) tr.querySelector('[name="machine"]').focus();
    return tr;
  }

  const rows = () => $$('.msp-row', rowsBody());
  const val = (row, name) => { const el = row.querySelector(`[name="${name}"]`); return el ? el.value.trim() : ''; };

  function rowBlank(r) {
    return !['machine', 'part_number', 'opn', 'remarks'].some((k) => val(r, k)) &&
      !['plan_qty', 'actual_qty', 'actual_run_sec'].some((k) => FP.num(val(r, k)) > 0);
  }

  function renumber() {
    rows().forEach((r, i) => { r.querySelector('.msp-idx').textContent = i + 1; });
    $('#mspCount').textContent = `${rows().length} row${rows().length === 1 ? '' : 's'}`;
  }

  /* ---------- Reading / writing the form ---------- */
  function collect() {
    const f = form();
    const r = {
      report_date: f.elements.report_date.value.trim(),
      report_name: f.elements.report_name.value.trim(),
      lines: [],
    };
    rows().forEach((row) => {
      if (rowBlank(row)) return;
      r.lines.push({
        machine: val(row, 'machine'), part_number: val(row, 'part_number'), opn: val(row, 'opn'),
        plan_qty: FP.int(val(row, 'plan_qty')), actual_qty: FP.int(val(row, 'actual_qty')),
        actual_run_sec: Math.max(0, FP.num(val(row, 'actual_run_sec'))), remarks: val(row, 'remarks'),
      });
    });
    r.id = S.id;
    r.plan_no = S.planNo;
    r.created_at = S.createdAt;
    return r;
  }

  function snapshot() {
    const f = form();
    const s = { report_date: f.elements.report_date.value, report_name: f.elements.report_name.value, lines: [], meta: { ...S } };
    rows().forEach((row) => {
      const l = { uid: row.dataset.uid };
      ['machine', 'part_number', 'opn', 'plan_qty', 'actual_qty', 'actual_run_sec', 'remarks'].forEach((k) => (l[k] = val(row, k)));
      s.lines.push(l);
    });
    return s;
  }

  function clearRows() { rows().forEach((r) => r.remove()); }

  function restore(s) {
    S.restoring = true;
    clearRows();
    const f = form();
    f.elements.report_date.value = s.report_date || FP.today();
    f.elements.report_name.value = s.report_name || '';
    lastAutoName = f.elements.report_name.value;
    (s.lines.length ? s.lines : [{}]).forEach((l) => addRow(l));
    Object.assign(S, { id: null, planNo: null, savedAt: null, createdAt: null, dirty: false }, s.meta || {});
    S.restoring = false;
    refreshAll();
  }

  function autoName(dateVal) { return `Machine Shop Plan - ${fmtDDMMYYYY(dateVal)}`; }
  function maybeAutoName() {
    const f = form();
    const candidate = autoName(f.elements.report_date.value);
    if (!f.elements.report_name.value.trim() || f.elements.report_name.value === lastAutoName) {
      f.elements.report_name.value = candidate;
    }
    lastAutoName = candidate;
  }

  function blankState() {
    const f = form();
    clearRows();
    f.elements.report_date.value = FP.today();
    lastAutoName = '';
    maybeAutoName();
    addRow();
    Object.assign(S, { id: null, planNo: null, savedAt: null, createdAt: null, dirty: false });
    $$('.is-invalid', f).forEach((el) => el.classList.remove('is-invalid'));
    refreshAll();
  }

  /* ---------- Live rendering ---------- */
  function refreshAll() {
    renumber();
    rows().forEach((row) => {
      const l = {
        plan_qty: val(row, 'plan_qty'), actual_qty: val(row, 'actual_qty'), actual_run_sec: val(row, 'actual_run_sec'),
      };
      const { eff, cyc } = computeRow(l);
      row.querySelector('[data-out="eff"]').textContent = fmtEff(eff);
      row.querySelector('[data-out="cyc"]').textContent = fmtCyc(cyc);
    });
    renderSaveState();
  }

  function renderSaveState() {
    const el = $('#mplanSaveState');
    if (!el) return;
    if (!S.id) {
      el.innerHTML = '<span class="dot dot-draft"></span>Draft, not saved yet';
    } else if (S.dirty) {
      el.innerHTML = `<span class="dot dot-dirty"></span>${esc(S.planNo)} has unsaved changes`;
    } else {
      el.innerHTML = `<span class="dot dot-saved"></span>Saved as ${esc(S.planNo)} at ${esc(FP.fmtDateTime(S.savedAt))}`;
    }
  }

  /* ---------- Draft (per user, this browser) ---------- */
  const draftKey = () => (FP.state.user ? `fp_msp_draft_${FP.state.user.id}` : null);
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
    if (!f.elements.report_name.value.trim()) mark(f.elements.report_name, 'Enter a report name.');

    const dataRows = rows().filter((r) => !rowBlank(r));
    if (!dataRows.length) mark(rows()[0]?.querySelector('[name="machine"]'), 'Add at least one row.');
    dataRows.forEach((r, i) => {
      if (!val(r, 'machine')) mark(r.querySelector('[name="machine"]'), `Row ${i + 1} needs a machine name.`);
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
    const btn = $('#mplanSave');
    FP.busy(btn, true);
    try {
      const r = collect();
      const body = { ...r };
      delete body.plan_no; delete body.created_at;
      const res = await FP.api('save_mplan.php', { method: 'POST', body });
      const wasNew = !S.id;
      Object.assign(S, { id: res.id, planNo: res.plan_no, savedAt: res.updated_at, createdAt: res.created_at, dirty: false });
      renderSaveState();
      writeDraft();
      FP.toast(wasNew ? `Saved as ${res.plan_no}.` : `${res.plan_no} updated.`, {
        type: 'good', action: () => (location.hash = '#mplan/history'), actionLabel: 'View history',
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
    FP.toast('Plan cleared. Ready for new data.', {
      action: () => { restore(before); writeDraft(); FP.toast('Plan restored.'); },
      actionLabel: 'Undo', timeout: 7000,
    });
  }

  function onListClick(e) {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    const row = rm.closest('.msp-row');
    if (rows().length === 1) {
      row.querySelectorAll('input').forEach((i) => (i.value = ''));
    } else {
      row.remove();
    }
    onChange();
  }

  /* ---------- History list ---------- */
  const HL = { loaded: false };

  function skeleton() {
    $('#mplanHistoryList').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  }

  function renderList(plans) {
    const count = plans.length;
    $('#mplanHistoryCount').textContent = `${count} plan${count === 1 ? '' : 's'}`;
    const list = $('#mplanHistoryList');
    if (!count) {
      list.innerHTML = '<div class="h-empty"><p>No saved plans yet.</p><p>Fill in a plan and press Save. It will appear here.</p></div>';
      return;
    }
    list.innerHTML = plans.map((p) => `
      <article class="h-item h-item-msp">
        <div class="h-main">
          <p class="h-no">${esc(p.plan_no || 'Plan #' + p.id)}</p>
          <p class="h-sub">Saved ${esc(FP.fmtDateTime(p.created_at))}</p>
        </div>
        <div class="h-meta">
          <div>${esc(p.report_name)}</div>
          <div class="h-sub">${esc(FP.fmtDate(p.report_date))}</div>
        </div>
        ${`<div class="h-stat"><span>Rows</span><b>${FP.fmtNum(p.line_count)}</b></div>`}
        <div class="h-actions">
          <a class="btn btn-blue" href="#mplan/history/${encodeURIComponent(p.id)}" aria-label="View ${esc(p.plan_no || 'plan')}">
            <svg aria-hidden="true"><use href="#i-eye"/></svg><span>View</span>
          </a>
          <button class="icon-btn icon-btn-danger" type="button" data-delete="${p.id}"
            aria-label="Delete ${esc(p.plan_no || 'plan')}" title="Delete plan">
            <svg aria-hidden="true"><use href="#i-trash"/></svg>
          </button>
        </div>
      </article>`).join('');
  }

  async function loadList(force = false) {
    if (!force && HL.loaded && $('#mplanHistoryList').children.length) return;
    skeleton();
    $('#mplanHistoryCount').textContent = 'Loading saved plans…';
    try {
      const res = await FP.api('get_mplans.php');
      HL.loaded = true;
      renderList(res.plans);
    } catch (err) {
      $('#mplanHistoryCount').textContent = 'Could not load plans';
      $('#mplanHistoryList').innerHTML = `<div class="h-empty"><p>${esc(err.message)}</p></div>`;
    }
  }

  async function deleteMplan(id, { label = 'this plan', onDone } = {}) {
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    try {
      await FP.api('delete_mplan.php', { method: 'POST', body: { id: Number(id) } });
      HL.loaded = false;
      FP.toast('Plan deleted.', { type: 'good' });
      if (onDone) onDone();
    } catch (err) {
      FP.toast(err.message, { type: 'error', timeout: 6000 });
    }
  }

  function onHistoryListClick(e) {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const article = btn.closest('.h-item');
    const label = article ? article.querySelector('.h-no')?.textContent : null;
    deleteMplan(btn.dataset.delete, { label: label || 'this plan', onDone: () => loadList(true) });
  }

  /* ---------- Detail (read-only) ---------- */
  let current = null;

  function renderDetail(p) {
    const rowsHtml = p.lines.map((l, i) => {
      const { eff, cyc } = computeRow(l);
      return `<tr><td>${i + 1}</td><td>${esc(l.machine)}</td><td>${esc(l.part_number || '—')}</td><td>${esc(l.opn || '—')}</td>
        <td>${FP.fmtNum(l.plan_qty)}</td><td>${FP.fmtNum(l.actual_qty)}</td><td>${l.actual_run_sec ? FP.fmtNum(l.actual_run_sec) : '—'}</td>
        <td>${esc(l.remarks || '—')}</td><td>${fmtEff(eff)}</td><td>${fmtCyc(cyc)}</td></tr>`;
    }).join('');

    $('#mplanDetailSheet').innerHTML = `
      <header class="sheet-head">
        <h2>Machine Shop Plan</h2>
        <p>${esc(p.plan_no)} — ${esc(p.report_name)}, ${esc(FP.fmtDate(p.report_date))}</p>
      </header>
      <div class="sheet-body">
        <section class="sheet-section">
          <p class="msp-note">Available Working Time: <b>28,800 seconds</b>. Cycle Time = (28,800 × Plan Quantity) ÷ Actual Machine Running Time. Efficiency = ((28,800 × Actual Quantity) ÷ Actual Machine Running Time) × 100.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Machine</th><th>Part Number</th><th>OPN</th><th>Plan Quantity</th><th>Actual Quantity</th><th>Actual Running Time (sec)</th><th>Remarks</th><th>Efficiency</th><th>Cycle Time</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>
        </section>
        <p class="sheet-foot">Generated by FactoryPulse</p>
      </div>`;
  }

  async function loadDetail(id) {
    current = null;
    $('#mplanDetailSheet').innerHTML = '<div class="sheet-body"><div class="skeleton"></div><div class="skeleton"></div></div>';
    try {
      const res = await FP.api('get_mplan.php', { query: { id } });
      current = res.plan;
      renderDetail(res.plan);
    } catch (err) {
      $('#mplanDetailSheet').innerHTML = `<div class="sheet-body"><div class="h-empty"><p>${esc(err.message)}</p></div></div>`;
    }
  }

  /* ---------- Router ---------- */
  function route() {
    if (!FP.state.user) return;
    const hash = location.hash.replace(/^#/, '');
    if (hash === 'mplan') { FP.history.showView('mplan'); document.title = 'Machine Shop Plan · FactoryPulse'; return; }
    if (hash === 'mplan/history') { FP.history.showView('mplan-history'); loadList(); document.title = 'Machine Shop Plan history · FactoryPulse'; return; }
    const m = hash.match(/^mplan\/history\/(\d+)$/);
    if (m) { FP.history.showView('mplan-detail'); loadDetail(m[1]); document.title = 'Saved plan · FactoryPulse'; return; }
  }

  FP.mplan = {
    init() {
      const f = form();
      f.addEventListener('input', (e) => {
        if (e.target.name === 'report_date' && e.target === f.elements.report_date) maybeAutoName();
        if (e.target.classList.contains('is-invalid')) e.target.classList.remove('is-invalid');
        onChange();
      });
      f.addEventListener('change', onChange);
      f.addEventListener('submit', (e) => e.preventDefault());
      rowsBody().addEventListener('click', onListClick);

      $('#mspAddRow').addEventListener('click', () => { addRow({}, { focus: true }); onChange(); });
      $('#mplanSave').addEventListener('click', save);
      $('#mplanReset').addEventListener('click', reset);
      $('#mplanHistoryBtn').addEventListener('click', () => (location.hash = '#mplan/history'));

      $('#mplanHistoryList').addEventListener('click', onHistoryListClick);
      $('#mplanDetailBack').addEventListener('click', () => { location.hash = '#mplan/history'; });
      $('#mplanDetailDelete').addEventListener('click', () => {
        if (!current) return;
        deleteMplan(current.id, { label: current.plan_no || 'this plan', onDone: () => { current = null; location.hash = '#mplan/history'; } });
      });

      window.addEventListener('hashchange', route);
      document.addEventListener('fp:login', () => {
        HL.loaded = false;
        const d = readDraft();
        if (d && d.lines) restore(d); else blankState();
        route();
      });
      document.addEventListener('fp:logout', () => { S.dirty = false; blankState(); });

      blankState();
    },
  };
})();
