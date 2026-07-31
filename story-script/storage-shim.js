// Local persistence shim — replaces Claude.ai's window.storage with plain localStorage
// so this app runs standalone, outside the Claude artifact sandbox.
(function () {
  var NS = "ssps:";
  window.storage = {
    get: function (key) {
      var v = localStorage.getItem(NS + key);
      return Promise.resolve({ value: v });
    },
    set: function (key, value) {
      localStorage.setItem(NS + key, value);
      return Promise.resolve();
    },
    delete: function (key) {
      localStorage.removeItem(NS + key);
      return Promise.resolve();
    },
    list: function (prefix) {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(NS + prefix) === 0) keys.push(k.slice(NS.length));
      }
      return Promise.resolve({ keys: keys });
    }
  };
})();
