/* FactoryPulse — report history (date range filter), saved report view. */
(function () {
  'use strict';
  const FP = window.FP;
  const { $, $$, esc } = FP;

  const H = { from: '', to: '', range: '', loadedFor: null, current: null };

  function readFilterFromStore() {
    try {
      const s = JSON.parse(sessionStorage.getItem('fp_history_filter') || 'null');
      if (s) Object.assign(H, { from: s.from || '', to: s.to || '', range: s.range || '' });
    } catch (e) { /* ignore */ }
  }
  function storeFilter() {
    try { sessionStorage.setItem('fp_history_filter', JSON.stringify({ from: H.from, to: H.to, range: H.range })); } catch (e) { /* ignore */ }
  }

  function syncFilterInputs() {
    $('#filterFrom').value = H.from;
    $('#filterTo').value = H.to;
    $$('.quick .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.range === H.range));
  }

  function skeleton() {
    $('#historyList').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  }

  function stat(label, value, cls = '', extra = '') {
    return `<div class="h-stat ${extra}"><span>${label}</span><b class="${cls}">${value}</b></div>`;
  }

  function renderList(reports) {
    const count = reports.length;
    const range = H.from || H.to
      ? ` saved ${H.from ? 'from ' + FP.fmtDate(H.from) : ''}${H.to ? ' to ' + FP.fmtDate(H.to) : ''}`
      : '';
    $('#historyCount').textContent = `${count} report${count === 1 ? '' : 's'}${range}`;

    const list = $('#historyList');
    if (!count) {
      list.innerHTML = H.from || H.to
        ? '<div class="h-empty"><p>No reports were saved in this date range.</p><p>Widen the range or choose Show all.</p></div>'
        : '<div class="h-empty"><p>No saved reports yet.</p><p>Fill in today\'s report and press Save. It will appear here.</p></div>';
      return;
    }
    list.innerHTML = reports.map((r) => `
      <article class="h-item">
        <div class="h-main">
          <p class="h-no">${esc(r.report_no || 'Report #' + r.id)}</p>
          <p class="h-sub">Saved ${esc(FP.fmtDateTime(r.created_at))}</p>
        </div>
        <div class="h-meta">
          <div>${esc(FP.fmtDate(r.report_date))}, ${esc(FP.shiftLabel(r.shift))}</div>
          <div class="h-sub">${esc([r.plant_name, r.section].filter(Boolean).join(', ') || 'No section')}</div>
        </div>
        ${stat('Attainment', FP.fmtPct(r.attainment_pct), FP.statusOf('attainment', r.attainment_pct))}
        ${stat('OEE', FP.fmtPct(r.oee_pct), FP.statusOf('oee', r.oee_pct))}
        ${stat('Good output', FP.fmtNum(r.total_good_qty), '', 'h-hide-md')}
        <div class="h-actions">
          <a class="btn btn-blue" href="#history/${encodeURIComponent(r.id)}" aria-label="View ${esc(r.report_no || 'report')}">
            <svg aria-hidden="true"><use href="#i-eye"/></svg><span>View</span>
          </a>
          <button class="icon-btn icon-btn-danger" type="button" data-delete="${r.id}"
            aria-label="Delete ${esc(r.report_no || 'report')}" title="Delete report">
            <svg aria-hidden="true"><use href="#i-trash"/></svg>
          </button>
        </div>
      </article>`).join('');
  }

  async function loadList(force = false) {
    const key = `${H.from}|${H.to}`;
    if (!force && H.loadedFor === key && $('#historyList').children.length) return;
    skeleton();
    $('#historyCount').textContent = 'Loading saved reports…';
    try {
      const res = await FP.api('get_reports.php', { query: { from: H.from, to: H.to } });
      H.loadedFor = key;
      renderList(res.reports);
    } catch (err) {
      $('#historyCount').textContent = 'Could not load reports';
      $('#historyList').innerHTML = `<div class="h-empty"><p>${esc(err.message)}</p><p><button class="btn btn-blue" type="button" id="retryHistory">Try again</button></p></div>`;
      const retry = $('#retryHistory');
      if (retry) retry.addEventListener('click', () => loadList(true));
    }
  }

  /** Deletes a saved report after a confirmation prompt. Removes it from the
   *  currently rendered list (or leaves the history view, if called from the
   *  detail page) without needing a full reload. */
  async function deleteReport(id, { label = 'this report', onDone } = {}) {
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return false;
    try {
      await FP.api('delete_report.php', { method: 'POST', body: { id: Number(id) } });
      H.loadedFor = null;
      FP.toast('Report deleted.', { type: 'good' });
      if (onDone) onDone();
      return true;
    } catch (err) {
      FP.toast(err.message, { type: 'error', timeout: 6000 });
      return false;
    }
  }

  function onHistoryListClick(e) {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const article = btn.closest('.h-item');
    const label = article ? article.querySelector('.h-no')?.textContent : null;
    deleteReport(btn.dataset.delete, {
      label: label || 'this report',
      onDone: () => loadList(true),
    });
  }

  function setRange(range) {
    const now = new Date();
    const back = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return FP.isoDate(d); };
    H.range = range;
    H.to = FP.today();
    if (range === 'today') H.from = FP.today();
    else if (range === 'month') H.from = FP.isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    else H.from = back(Number(range) - 1);
    syncFilterInputs(); storeFilter(); loadList(true);
  }

  /* ---------- Detail sheet ---------- */
  function table(head, rowsHtml, foot) {
    return `<div class="table-wrap"><table>
      <thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>${foot ? `<tfoot><tr>${foot.map((f) => `<td>${f}</td>`).join('')}</tr></tfoot>` : ''}
    </table></div>`;
  }

  function renderDetail(r) {
    const k = FP.computeKpis(r);
    const kpi = (label, value, cls = '') => `<div class="sheet-kpi"><span>${label}</span><b class="${cls}">${value}</b></div>`;
    const meta = (label, value) => `<div><dt>${label}</dt><dd>${esc(value || '—')}</dd></div>`;

    const AVAILABLE_SEC = 28800;
    const fmtEff = (v) => (v === null ? '—' : `${v.toFixed(1)}%`);
    const fmtCyc = (v) => (v === null ? '—' : `${v.toFixed(1)} s`);
    const machineRows = r.machines.map((m, i) => {
      const att = m.planned_qty ? (m.good_qty / m.planned_qty) * 100 : null;
      const runSec = m.actual_run_sec || 0;
      const eff = runSec > 0 ? ((AVAILABLE_SEC * (m.good_qty + m.reject_qty)) / runSec) * 100 : null;
      const cyc = runSec > 0 ? (AVAILABLE_SEC * m.planned_qty) / runSec : null;
      return `<tr><td>${i + 1}</td><td>${esc(m.machine)}</td><td>${esc(m.item || '—')}</td><td>${esc(m.operator || '—')}</td>
        <td>${FP.fmtNum(m.planned_qty)}</td><td>${FP.fmtNum(m.good_qty)}</td><td>${FP.fmtNum(m.reject_qty)}</td>
        <td>${m.ideal_cycle_sec ? esc(m.ideal_cycle_sec) : '—'}</td><td>${FP.fmtNum(m.downtime_min)}</td>
        <td>${runSec ? FP.fmtNum(runSec) : '—'}</td>
        <td><b class="${FP.statusOf('attainment', att)}">${FP.fmtPct(att, 0)}</b></td>
        <td>${fmtEff(eff)}</td><td>${fmtCyc(cyc)}</td></tr>`;
    }).join('');

    const downtimeRows = r.downtime.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.machine || '—')}</td><td>${esc(d.reason)}</td><td>${FP.fmtNum(d.minutes)}</td><td>${esc(d.remarks || '—')}</td></tr>`).join('');
    const rejectionRows = r.rejections.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.item || '—')}</td><td>${esc(x.reason)}</td><td>${FP.fmtNum(x.qty)}</td><td>${esc(x.action)}</td></tr>`).join('');

    $('#detailSheet').innerHTML = `
      <header class="sheet-head">
        <h2>Daily production report</h2>
        <p>${esc(r.report_no)} for ${esc(FP.fmtDate(r.report_date))}, ${esc(FP.shiftLabel(r.shift))}</p>
      </header>
      <div class="sheet-body">
        <dl class="sheet-meta">
          ${meta('Plant', r.plant_name)}
          ${meta('Section / line', r.section)}
          ${meta('Supervisor', r.supervisor)}
          ${meta('Planned time', `${FP.fmtNum(r.planned_minutes)} min per machine`)}
          ${meta('Manpower', r.manpower_required ? `${r.manpower_present} present of ${r.manpower_required}` : '')}
          ${meta('Overtime', r.overtime_hours ? `${r.overtime_hours} h` : '')}
          ${meta('Prepared by', r.prepared_by)}
          ${meta('Saved on', FP.fmtDateTime(r.created_at))}
          ${meta('Last updated', FP.fmtDateTime(r.updated_at))}
        </dl>

        <section class="sheet-section">
          <h3>Shift performance</h3>
          <div class="sheet-kpis">
            ${kpi('Plan attainment', FP.fmtPct(k.attainment), FP.statusOf('attainment', k.attainment))}
            ${kpi('OEE', FP.fmtPct(k.oee), FP.statusOf('oee', k.oee))}
            ${kpi('Availability', FP.fmtPct(k.availability), FP.statusOf('availability', k.availability))}
            ${kpi('Performance', FP.fmtPct(k.performance), FP.statusOf('performance', k.performance))}
            ${kpi('Quality', FP.fmtPct(k.quality), FP.statusOf('quality', k.quality))}
            ${kpi('Rejection', FP.fmtPct(k.rejection), FP.statusOf('rejection', k.rejection))}
            ${kpi('Good output', `${FP.fmtNum(k.good)} pcs`)}
            ${kpi('Downtime', `${FP.fmtNum(k.down)} min`, FP.statusOf('downtimePct', k.downtimePct))}
          </div>
        </section>

        <section class="sheet-section">
          <h3>Machine-wise production</h3>
          ${table(['#', 'Machine', 'Part / item', 'Operator', 'Planned', 'Good', 'Reject', 'Cycle (s)', 'Downtime (min)', 'Actual run (sec)', 'Attainment', 'Efficiency', 'Cycle Time'], machineRows,
            ['', 'Total', '', '', FP.fmtNum(k.plannedQty), FP.fmtNum(k.good), FP.fmtNum(k.reject), '', FP.fmtNum(k.down), '', FP.fmtPct(k.attainment, 0), '', ''])}
        </section>

        <section class="sheet-section">
          <h3>Downtime</h3>
          ${r.downtime.length ? table(['#', 'Machine', 'Reason', 'Minutes', 'Remarks'], downtimeRows, ['', '', 'Total', FP.fmtNum(k.down), '']) : '<p class="sheet-empty">No stoppages were recorded.</p>'}
        </section>

        <section class="sheet-section">
          <h3>Rejection details</h3>
          ${r.rejections.length ? table(['#', 'Part / item', 'Reason', 'Qty', 'Action'], rejectionRows, ['', '', 'Total', FP.fmtNum(k.rejBreakdown), '']) : '<p class="sheet-empty">No rejection breakdown was recorded.</p>'}
        </section>

        ${r.remarks ? `<section class="sheet-section"><h3>What happened this shift</h3><p class="sheet-note">${esc(r.remarks)}</p></section>` : ''}
        ${r.next_actions ? `<section class="sheet-section"><h3>Actions for next shift</h3><p class="sheet-note">${esc(r.next_actions)}</p></section>` : ''}

        <p class="sheet-foot">Generated by FactoryPulse</p>
      </div>`;
  }

  async function loadDetail(id) {
    H.current = null;
    $('#detailSheet').innerHTML = '<div class="sheet-body"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    try {
      const res = await FP.api('get_report.php', { query: { id } });
      H.current = res.report;
      renderDetail(res.report);
    } catch (err) {
      $('#detailSheet').innerHTML = `<div class="sheet-body"><div class="h-empty"><p>${esc(err.message)}</p><p>Go back to the history list and pick another report.</p></div></div>`;
    }
  }

  /* ---------- Views + router ---------- */
  const NAV_ALIAS = { detail: 'history', 'mplan-history': 'mplan', 'mplan-detail': 'mplan' };
  function show(view) {
    $$('.view').forEach((el) => { el.hidden = el.id !== `view-${view}`; });
    $$('.topnav a').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === (NAV_ALIAS[view] || view)));
    window.scrollTo({ top: 0 });
  }

  function route() {
    if (!FP.state.user) return;
    const hash = location.hash.replace(/^#/, '');
    if (hash === 'mplan' || hash.indexOf('mplan/') === 0) return; // handled by FP.mplan
    const m = hash.match(/^history\/(\d+)$/);
    if (m) { show('detail'); loadDetail(m[1]); document.title = 'Saved report · FactoryPulse'; return; }
    if (hash === 'history') { show('history'); syncFilterInputs(); loadList(); document.title = 'Report history · FactoryPulse'; return; }
    show('report');
    document.title = 'FactoryPulse · Daily production report';
  }

  FP.history = {
    init() {
      readFilterFromStore();

      $('#filterForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const from = $('#filterFrom').value, to = $('#filterTo').value;
        if (from && to && from > to) { FP.toast('"From" must be on or before "To".', { type: 'error' }); $('#filterFrom').focus(); return; }
        Object.assign(H, { from, to, range: '' });
        syncFilterInputs(); storeFilter(); loadList(true);
      });
      $('#filterClear').addEventListener('click', () => {
        Object.assign(H, { from: '', to: '', range: '' });
        syncFilterInputs(); storeFilter(); loadList(true);
      });
      $$('.quick .chip').forEach((c) => c.addEventListener('click', () => setRange(c.dataset.range)));

      $('#detailBack').addEventListener('click', () => { location.hash = '#history'; });
      $('#detailPdf').addEventListener('click', () => H.current && FP.exporter.pdf(H.current, $('#detailPdf')));
      $('#detailShare').addEventListener('click', () => H.current && FP.exporter.whatsapp(H.current));
      $('#detailDelete').addEventListener('click', () => {
        if (!H.current) return;
        deleteReport(H.current.id, {
          label: H.current.report_no || 'this report',
          onDone: () => { H.current = null; location.hash = '#history'; },
        });
      });
      $('#historyList').addEventListener('click', onHistoryListClick);

      window.addEventListener('hashchange', route);
      document.addEventListener('fp:login', () => { H.loadedFor = null; route(); });
      document.addEventListener('fp:logout', () => { H.loadedFor = null; H.current = null; $('#historyList').innerHTML = ''; show('report'); });
      // Newly saved reports should show up next time history opens.
      document.addEventListener('fp:saved', () => { H.loadedFor = null; });
    },
    route,
    showView: show,
  };
})();
