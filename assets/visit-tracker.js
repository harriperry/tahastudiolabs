(function () {
  try {
    if (!sessionStorage.getItem('sf_visit_tracked')) {
      sessionStorage.setItem('sf_visit_tracked', '1');
      fetch('/api/track-visit', { method: 'POST', keepalive: true }).catch(function () {});
    }
  } catch (e) {}
})();
