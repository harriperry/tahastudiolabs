(function () {
  "use strict";
  var m = /[#&]t=([A-Za-z0-9_-]+)/.exec(location.hash);
  var btn = document.getElementById("go");
  var msg = document.getElementById("msg");
  if (!m) { msg.textContent = "This link is incomplete. Request a new one from the studio page."; btn.classList.add("hidden"); return; }
  var token = m[1];
  history.replaceState(null, "", location.pathname);
  btn.addEventListener("click", function () {
    btn.disabled = true;
    fetch("/api/brief/admin/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (res.ok) { location.replace("/brief/studio"); return; }
        msg.textContent = (res.data && res.data.message) || "This link did not work. Request a new one.";
        btn.classList.add("hidden");
      })
      .catch(function () { msg.textContent = "Could not reach the server. Try again."; btn.disabled = false; });
  });
})();
