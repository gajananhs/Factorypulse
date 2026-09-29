/* FactoryPulse — start-up. Listeners first, then the login check fires fp:login. */
(function () {
  'use strict';
  const FP = window.FP;
  document.addEventListener('DOMContentLoaded', () => {
    FP.report.init();
    FP.history.init();
    FP.mplan.init();
    FP.auth.init();
  });

  /* PWA: register the service worker (needs HTTPS). */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
