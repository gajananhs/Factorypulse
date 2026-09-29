/* FactoryPulse — shared helpers (loaded first). */
(function () {
  'use strict';

  const FP = (window.FP = window.FP || {});

  FP.DOWNTIME_REASONS = [
    'Breakdown', 'Setup / changeover', 'Material shortage', 'Waiting for QC',
    'No operator', 'Power failure', 'Tool change', 'Planned maintenance', 'Other',
  ];
  FP.REJECT_REASONS = [
    'Dimension out of tolerance', 'Surface defect / dent', 'Thread defect', 'Burr',
    'Porosity / blowhole', 'Wrong material', 'Setting piece', 'Other',
  ];
  FP.REJECT_ACTIONS = ['Scrap', 'Rework', 'Hold'];

  /* Thresholds from the product spec (green / amber / red). */
  FP.THRESHOLDS = {
    attainment:   { good: 95, warn: 85 },
    oee:          { good: 65, warn: 50 },
    availability: { good: 85, warn: 75 },
    performance:  { good: 90, warn: 80 },
    quality:      { good: 98, warn: 95 },
    rejection:    { good: 2,  warn: 5, lowerIsBetter: true },
    downtimePct:  { good: 10, warn: 20, lowerIsBetter: true },
    manpower:     { good: 95, warn: 85 },
  };

  FP.state = { user: null };

  /* ---------- DOM + text ---------- */
  FP.$ = (sel, root = document) => root.querySelector(sel);
  FP.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  FP.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  FP.num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  FP.int = (v) => { const n = Math.round(parseFloat(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

  const nf = new Intl.NumberFormat('en-IN');
  FP.fmtNum = (v) => nf.format(Math.round(v || 0));
  FP.fmtPct = (v, digits = 1) => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : `${v.toFixed(digits)}%`;

  FP.today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  FP.isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  FP.fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y) return iso;
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  FP.fmtDateTime = (s) => {
    if (!s) return '—';
    const [date, time] = String(s).split(' ');
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = (time || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  FP.shiftLabel = (s) => (s === 'General' ? 'General shift' : `Shift ${s || '—'}`);
  FP.initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '–';

  FP.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- Status ---------- */
  FP.statusOf = (key, value) => {
    const t = FP.THRESHOLDS[key];
    if (!t || value === null || value === undefined || !Number.isFinite(value)) return '';
    if (t.lowerIsBetter) return value <= t.good ? 'is-good' : value <= t.warn ? 'is-warn' : 'is-bad';
    return value >= t.good ? 'is-good' : value >= t.warn ? 'is-warn' : 'is-bad';
  };
  FP.statusText = (cls) => ({ 'is-good': 'On track', 'is-warn': 'Watch', 'is-bad': 'Act now' }[cls] || 'No data');

  /* ---------- KPI engine (mirrors api/_common.php compute_kpis) ---------- */
  FP.computeKpis = (r) => {
    const pm = FP.int(r.planned_minutes);
    let plannedQty = 0, good = 0, reject = 0, down = 0, plannedTime = 0, run = 0, idealSec = 0, runSecP = 0;

    (r.machines || []).forEach((m) => {
      const dt = Math.min(FP.int(m.downtime_min), pm);
      const g = FP.int(m.good_qty), rj = FP.int(m.reject_qty), cyc = FP.num(m.ideal_cycle_sec);
      plannedQty += FP.int(m.planned_qty); good += g; reject += rj; down += dt;
      if (pm > 0) {
        plannedTime += pm;
        const rn = pm - dt;
        run += rn;
        if (cyc > 0 && rn > 0) { idealSec += cyc * (g + rj); runSecP += rn * 60; }
      }
    });

    const total = good + reject;
    const A = plannedTime ? run / plannedTime : null;
    const P = runSecP ? Math.min(idealSec / runSecP, 1) : null;
    const Q = total ? good / total : null;
    const OEE = A !== null && P !== null && Q !== null ? A * P * Q : null;
    const pct = (v) => (v === null ? null : v * 100);

    const byReason = {};
    (r.downtime || []).forEach((d) => {
      const mins = FP.int(d.minutes);
      if (!mins || !d.reason) return;
      byReason[d.reason] = (byReason[d.reason] || 0) + mins;
    });
    const reasons = Object.entries(byReason).map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes);

    const rejBreakdown = (r.rejections || []).reduce((s, x) => s + FP.int(x.qty), 0);
    const req = FP.int(r.manpower_required), pres = FP.int(r.manpower_present);

    return {
      plannedQty, good, reject, total, down, plannedTime, run,
      attainment: plannedQty ? (good / plannedQty) * 100 : null,
      availability: pct(A), performance: pct(P), quality: pct(Q), oee: pct(OEE),
      rejection: total ? (reject / total) * 100 : null,
      downtimePct: plannedTime ? (down / plannedTime) * 100 : null,
      manpower: req ? (pres / req) * 100 : null,
      manpowerRequired: req, manpowerPresent: pres,
      reasons, rejBreakdown,
      machineCount: (r.machines || []).length,
    };
  };

  /* ---------- API ---------- */
  FP.api = async (path, { method = 'GET', body, query } = {}) => {
    const base = (window.FP_API_BASE || 'api/').replace(/\/?$/, '/');
    let url = `${base}${path}`;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v !== null && v !== undefined));
      if ([...qs].length) url += `?${qs}`;
    }
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    let token = null;
    try { token = localStorage.getItem('fp_token'); } catch (e) { /* storage blocked */ }
    if (token) opts.headers['X-FP-Token'] = token;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      console.error('FactoryPulse API unreachable:', url, e);
      let msg = 'No connection to the server. Check your internet and try again.';
      if (/YOUR-DOMAIN/i.test(url)) {
        msg = 'API address not set. Edit config.js and put your real server address in FP_API_BASE.';
      } else if (navigator.onLine) {
        let host = url;
        try { host = new URL(url, location.href).host; } catch (e2) { /* keep raw */ }
        msg = `Cannot reach the API at ${host}. Check FP_API_BASE in config.js, that the api folder is uploaded, and CORS (see browser console).`;
      }
      throw Object.assign(new Error(msg), { network: true });
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    try {
      if (data && data.token && (path === 'login.php' || path === 'register.php')) localStorage.setItem('fp_token', data.token);
      if (path === 'logout.php' || res.status === 401) localStorage.removeItem('fp_token');
    } catch (e) { /* storage blocked */ }
    if (!res.ok || !data || data.ok === false) {
      const err = new Error((data && data.error) || `Server returned ${res.status}. Please try again.`);
      err.status = res.status;
      err.data = data;
      if (res.status === 401 && FP.auth && path !== 'login.php') FP.auth.requireLogin();
      throw err;
    }
    return data;
  };

  /* ---------- Toasts ---------- */
  FP.toast = (message, { type = '', action, actionLabel, timeout = 4200 } = {}) => {
    const wrap = FP.$('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${type ? 'is-' + type : ''}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-msg"></span>`;
    el.firstChild.textContent = message;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-blue';
      b.textContent = actionLabel || 'Undo';
      b.addEventListener('click', () => { action(); el.remove(); });
      el.appendChild(b);
    }
    wrap.appendChild(el);
    setTimeout(() => el.remove(), timeout);
    while (wrap.children.length > 3) wrap.firstChild.remove();
  };

  FP.busy = (btn, on) => {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('is-busy', on);
  };
})();
