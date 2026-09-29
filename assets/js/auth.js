/* FactoryPulse — login, register, profile menu. */
(function () {
  'use strict';
  const FP = window.FP;
  const { $, $$ } = FP;

  const modal = () => $('#authModal');
  let lastFocus = null;

  function showTab(which) {
    const login = which === 'login';
    $('#tabLogin').classList.toggle('is-active', login);
    $('#tabRegister').classList.toggle('is-active', !login);
    $('#tabLogin').setAttribute('aria-selected', String(login));
    $('#tabRegister').setAttribute('aria-selected', String(!login));
    $('#loginForm').hidden = !login;
    $('#registerForm').hidden = login;
    clearErrors();
    const first = (login ? $('#loginForm') : $('#registerForm')).querySelector('input');
    setTimeout(() => first && first.focus(), 30);
  }

  function clearErrors() {
    $$('.auth-form .form-error').forEach((e) => (e.textContent = ''));
    $$('.auth-form .field-error').forEach((e) => (e.textContent = ''));
    $$('.auth-form input').forEach((i) => i.classList.remove('is-invalid'));
  }

  function fieldError(form, name, msg) {
    const input = form.elements[name];
    const slot = form.querySelector(`.field-error[data-for="${name}"]`);
    if (input) input.classList.add('is-invalid');
    if (slot) slot.textContent = msg;
  }

  function openModal() {
    lastFocus = document.activeElement;
    document.body.classList.add('is-locked');
    modal().hidden = false;
    showTab('login');
  }

  function closeModal() {
    modal().hidden = true;
    document.body.classList.remove('is-locked');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function setUser(user) {
    FP.state.user = user;
    const p = $('#profile');
    if (!user) { p.hidden = true; return; }
    p.hidden = false;
    const ini = FP.initials(user.name);
    $('#avatarInitials').textContent = ini;
    $('#menuInitials').textContent = ini;
    $('#avatarName').textContent = user.name;
    $('#menuName').textContent = user.name;
    $('#menuPhone').textContent = user.phone;
    $('#menuEmail').textContent = user.email;
  }

  function signedIn(user, fresh) {
    setUser(user);
    closeModal();
    document.dispatchEvent(new CustomEvent('fp:login', { detail: { user, fresh } }));
  }

  /* ---------- Forms ---------- */
  async function onLogin(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors();
    const login = form.elements.login.value.trim();
    const password = form.elements.password.value;
    if (!login || !password) {
      form.querySelector('.form-error').textContent = 'Enter your email or phone and your password.';
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    FP.busy(btn, true);
    try {
      const res = await FP.api('login.php', { method: 'POST', body: { login, password } });
      form.reset();
      signedIn(res.user, true);
      FP.toast(`Welcome back, ${res.user.name.split(' ')[0]}.`, { type: 'good' });
    } catch (err) {
      form.querySelector('.form-error').textContent = err.message;
    } finally {
      FP.busy(btn, false);
    }
  }

  async function onRegister(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors();
    const v = {
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
      confirm: form.elements.confirm.value,
    };
    let bad = false;
    if (v.name.length < 2) { fieldError(form, 'name', 'Enter your full name.'); bad = true; }
    if (!/^\+?\d{10,15}$/.test(v.phone.replace(/[\s\-().]/g, ''))) { fieldError(form, 'phone', 'Enter a valid phone number (10–15 digits).'); bad = true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) { fieldError(form, 'email', 'Enter a valid email address.'); bad = true; }
    if (v.password.length < 8) { fieldError(form, 'password', 'Use at least 8 characters.'); bad = true; }
    if (v.password !== v.confirm) { fieldError(form, 'confirm', 'Passwords do not match.'); bad = true; }
    if (bad) return;

    const btn = form.querySelector('button[type="submit"]');
    FP.busy(btn, true);
    try {
      const res = await FP.api('register.php', { method: 'POST', body: { name: v.name, phone: v.phone, email: v.email, password: v.password } });
      form.reset();
      signedIn(res.user, true);
      FP.toast('Account created. You are logged in.', { type: 'good' });
    } catch (err) {
      const fields = err.data && err.data.fields;
      if (fields) Object.entries(fields).forEach(([k, msg]) => fieldError(form, k, msg));
      form.querySelector('.form-error').textContent = err.message;
    } finally {
      FP.busy(btn, false);
    }
  }

  /* ---------- Profile menu ---------- */
  function toggleMenu(force) {
    const btn = $('#profileBtn');
    const menu = $('#profileMenu');
    const open = force !== undefined ? force : menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  async function logout() {
    const btn = $('#logoutBtn');
    FP.busy(btn, true);
    try { await FP.api('logout.php', { method: 'POST', body: {} }); } catch (e) { /* cookie cleared server-side when reachable */ }
    FP.busy(btn, false);
    toggleMenu(false);
    setUser(null);
    document.dispatchEvent(new CustomEvent('fp:logout'));
    openModal();
    FP.toast('You have logged out.');
  }

  /* Keep keyboard focus inside the modal while it is open. */
  function trapFocus(e) {
    if (modal().hidden || e.key !== 'Tab') return;
    const nodes = $$('button, input, select, textarea, a[href]', modal()).filter((n) => !n.disabled && n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  FP.auth = {
    async init() {
      $('#tabLogin').addEventListener('click', () => showTab('login'));
      $('#tabRegister').addEventListener('click', () => showTab('register'));
      $$('[data-switch]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.switch)));
      $('#loginForm').addEventListener('submit', onLogin);
      $('#registerForm').addEventListener('submit', onRegister);
      $('#profileBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
      $('#logoutBtn').addEventListener('click', logout);
      document.addEventListener('click', (e) => { if (!$('#profileMenu').hidden && !e.target.closest('#profile')) toggleMenu(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); trapFocus(e); });

      try {
        const res = await FP.api('me.php');
        if (res.user) signedIn(res.user, false);
        else openModal();
      } catch (err) {
        openModal();
        $('#loginForm .form-error').textContent = err.message;
      }
    },
    requireLogin() {
      if (!modal().hidden) return;
      setUser(null);
      openModal();
      $('#loginForm .form-error').textContent = 'Your login has expired. Please log in again.';
    },
  };
})();
