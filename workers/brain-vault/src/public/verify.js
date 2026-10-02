/* Verify page: reads the one-time token from the URL fragment (never sent to the server
   in the URL), removes it from the address bar, and posts it only when the person clicks. */
(function () {
  var params = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var token = params.get("t") || "";
  try {
    history.replaceState(null, "", location.pathname);
  } catch (e) {}
  var btn = document.getElementById("go");
  var msg = document.getElementById("msg");
  function show(text, cls) {
    msg.textContent = text;
    msg.className = "msg " + cls;
  }
  if (!token) {
    btn.disabled = true;
    show("Länken saknar inloggningskod. Begär en ny länk. / The link has no login code. Request a new link.", "err");
    return;
  }
  btn.addEventListener("click", function () {
    btn.disabled = true;
    show("Loggar in... / Signing in...", "");
    fetch("/api/vault/auth/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token })
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (res.ok && res.d.redirect) {
          location.replace(res.d.redirect);
        } else {
          var m = res.d && res.d.message ? res.d.message.sv + " / " + res.d.message.en : "Fel / Error";
          show(m, "err");
        }
      })
      .catch(function () {
        btn.disabled = false;
        show("Nätverksfel, försök igen. / Network error, please try again.", "err");
      });
  });
})();
