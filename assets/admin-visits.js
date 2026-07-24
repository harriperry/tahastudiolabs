(function () {
  var gate = document.getElementById('gate');
  var statsEl = document.getElementById('stats');
  var err = document.getElementById('err');
  var uniqueEl = document.getElementById('uniqueVisitors');
  var totalEl = document.getElementById('totalVisits');
  var STORE_KEY = 'sf_admin_stats_key';

  function loadStats(key) {
    err.style.display = 'none';
    fetch('/api/visit-stats?key=' + encodeURIComponent(key))
      .then(function (r) {
        if (!r.ok) throw new Error('unauthorized');
        return r.json();
      })
      .then(function (data) {
        window.localStorage.setItem(STORE_KEY, key);
        uniqueEl.textContent = data.unique_visitors;
        totalEl.textContent = data.total_visits;
        gate.style.display = 'none';
        statsEl.style.display = 'block';
      })
      .catch(function () {
        err.style.display = 'block';
        window.localStorage.removeItem(STORE_KEY);
      });
  }

  document.getElementById('btnGo').addEventListener('click', function () {
    var key = document.getElementById('keyInput').value.trim();
    if (key) loadStats(key);
  });

  document.getElementById('btnRefresh').addEventListener('click', function () {
    var key = window.localStorage.getItem(STORE_KEY);
    if (key) loadStats(key);
  });

  var saved = window.localStorage.getItem(STORE_KEY);
  if (saved) loadStats(saved);
})();
