/* Share Your Brief: client page. One file, no libraries. All text goes in through textContent,
   never innerHTML, so nothing a client types can run as code. */
(function () {
  "use strict";
  var API = "/api/brief";
  var STORE = "ugc_brief_key";
  var app = document.getElementById("app");
  var KEY = null;
  var META = null;
  var STATE = null;
  var drafts = {};
  var notice = "";
  var picked = [];
  var timer = null;
  var fingerprint = "";

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function call(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (KEY) headers["X-Project-Key"] = KEY;
    if (opts.json) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .catch(function () { return { ok: false, status: 0, data: { message: "Could not reach the server. Check your connection and try again." } }; });
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return iso; }
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; }
  }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  function saveKey(k) { KEY = k; try { localStorage.setItem(STORE, k); } catch (e) { /* private window */ } }
  function forgetKey() { KEY = null; try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } }
  function readKey() {
    var m = /[#&]k=([A-Za-z0-9_.\-]+)/.exec(location.hash);
    if (m) { saveKey(m[1]); history.replaceState(null, "", location.pathname + location.search); return; }
    try { KEY = localStorage.getItem(STORE) || null; } catch (e) { KEY = null; }
  }

  /* ------------------------------------------------------------ steps strip */
  function stepsStrip(cur) {
    var names = ["Share your brief", "Approve hooks and script", "Receive your AI UGC videos"];
    return h("ol", { class: "steps", "aria-label": "Your project in three steps" },
      names.map(function (n, i) {
        var cls = i + 1 < cur ? "done" : i + 1 === cur ? "cur" : "";
        return h("li", { class: cls, "aria-current": i + 1 === cur ? "step" : null }, h("span", { class: "num" }, i + 1 < cur ? "✓" : String(i + 1)), n);
      }));
  }

  /* ------------------------------------------------------------ intake */
  function showIntake() {
    clear(app);
    document.title = "Share Your Brief | TAHA Studio Labs AI UGC";
    var form = buildForm();
    app.appendChild(h("div", null,
      h("div", { class: "kicker" }, "AI UGC for your brand"),
      h("h1", null, "Share Your Brief"),
      h("p", { class: "lede" }, "Tell me about your product and goal. Everything that follows happens in your private project dashboard: hook and script approval, revisions and delivery. No email threads.")));
    app.appendChild(stepsStrip(1));
    app.appendChild(form);
    app.appendChild(linkAgainCard());
  }

  function field(f, children) {
    return h("div", { class: "field", id: "w_" + f.key },
      f.type === "package" ? h("span", { class: "lab" }, f.label, f.required ? h("span", { class: "req" }, " *") : null) : h("label", { for: "f_" + f.key }, f.label, f.required ? h("span", { class: "req" }, " *") : null),
      children,
      f.help ? h("span", { class: "help" }, f.help) : null,
      h("span", { class: "err-text", id: "e_" + f.key, role: "alert" }));
  }

  function control(f) {
    if (f.type === "textarea") return h("textarea", { id: "f_" + f.key, name: f.key, maxlength: String(f.max || 1000), rows: "3" });
    if (f.type === "select") {
      var s = h("select", { id: "f_" + f.key, name: f.key }, h("option", { value: "" }, "Choose..."));
      Object.keys(f.options).forEach(function (k) { s.appendChild(h("option", { value: k }, f.options[k])); });
      return s;
    }
    if (f.type === "package") {
      var wrap = h("div", null);
      var grid = h("div", { class: "pkgs", role: "radiogroup" });
      var detail = h("div", { class: "pkgdetail hidden", id: "pkgDetail", "aria-live": "polite" });
      Object.keys(META.packages).forEach(function (k) {
        var p = META.packages[k];
        var input = h("input", { type: "radio", name: "package", value: k, onchange: function () {
          clear(detail);
          detail.classList.remove("hidden");
          detail.appendChild(h("b", null, p.label + " includes"));
          detail.appendChild(h("p", null, "Usage rights: " + p.usage + "."));
          detail.appendChild(h("p", null, "Revisions: " + p.revision + " within " + META.revisionDays + " days of delivery. Up to " + META.changeRounds + " rounds of changes to the hooks and script before production."));
          detail.appendChild(h("p", { class: "small muted" }, META.usageNote));
        } });
        grid.appendChild(h("label", { class: "pkg" }, input, h("b", null, p.label), h("span", { class: "small muted" }, p.usage)));
      });
      wrap.appendChild(grid);
      wrap.appendChild(detail);
      return wrap;
    }
    return h("input", { id: "f_" + f.key, name: f.key, type: f.type === "email" ? "email" : f.type === "date" ? "date" : "text", maxlength: String(f.max || 200), autocomplete: f.type === "email" ? "email" : "off" });
  }

  function buildForm() {
    var groups = [];
    META.fields.forEach(function (f) {
      var g = groups.filter(function (x) { return x.name === f.group; })[0];
      if (!g) { g = { name: f.group, items: [] }; groups.push(g); }
      g.items.push(f);
    });
    var form = h("form", { id: "intake", novalidate: true, autocomplete: "on" });
    groups.forEach(function (g) {
      var fs = h("fieldset", null, h("legend", null, g.name));
      g.items.forEach(function (f) { fs.appendChild(field(f, control(f))); });
      if (g.name === "Your brand") fs.appendChild(assetsField());
      form.appendChild(h("div", { class: "card" }, fs));
    });
    META.fields.forEach(function (f) {
      if (!f.showIf) return;
      var w = form.querySelector("#w_" + f.key);
      var src = form.querySelector("#f_" + f.showIf.key);
      var sync = function () { w.classList.toggle("hidden", src.value !== f.showIf.value); };
      src.addEventListener("change", sync);
      sync();
    });
    form.appendChild(h("div", { class: "hp", "aria-hidden": "true" }, h("label", null, "Leave this empty", h("input", { type: "text", name: "company_url", tabindex: "-1", autocomplete: "off" }))));
    form.appendChild(h("div", { class: "card" },
      h("label", { class: "row" }, h("input", { type: "checkbox", id: "consent" }), h("span", null, "I have read the ", h("a", { href: META.privacyUrl, target: "_blank", rel: "noopener noreferrer" }, "privacy policy"), " and agree that my brief and files are stored to produce my videos.")),
      h("span", { class: "err-text", id: "e_consent", role: "alert" }),
      h("div", { class: "row" }, h("button", { class: "btn gold", type: "submit", id: "sendBtn" }, "Share your brief"), h("span", { class: "muted small", id: "sendState", role: "status", "aria-live": "polite" }))));
    form.addEventListener("submit", onSubmit);
    return form;
  }

  function assetsField() {
    var list = h("ul", { class: "files", id: "pickedList" });
    var input = h("input", { type: "file", id: "assetInput", multiple: true, accept: META.accept.map(function (e) { return "." + e; }).join(",") });
    input.addEventListener("change", function () {
      addPicked(input.files, list);
      input.value = "";
    });
    return h("div", { class: "field" },
      h("label", { for: "assetInput" }, "Product images, demo video or other brand assets"),
      input,
      h("span", { class: "help" }, "Up to " + META.maxAssets + " files. Images, PDF, DOCX, TXT up to 15 MB. MP4 or MOV up to 50 MB."),
      list);
  }

  function extOf(n) { var m = /\.([a-z0-9]{1,5})$/i.exec(n); return m ? m[1].toLowerCase() : ""; }
  function addPicked(files, list) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var ext = extOf(f.name);
      var limit = ext === "mp4" || ext === "mov" ? 50 * 1048576 : ext === "txt" ? 5 * 1048576 : 15 * 1048576;
      if (META.accept.indexOf(ext) < 0) { notice = f.name + " was skipped: this file type is not accepted."; continue; }
      if (f.size > limit) { notice = f.name + " was skipped: it is too large."; continue; }
      if (picked.length >= META.maxAssets) { notice = "Only " + META.maxAssets + " files can be added."; break; }
      picked.push(f);
    }
    renderPicked(list);
    var s = document.getElementById("sendState");
    if (s && notice) { s.textContent = notice; notice = ""; }
  }
  function renderPicked(list) {
    clear(list);
    picked.forEach(function (f, i) {
      list.appendChild(h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"),
        h("button", { type: "button", class: "btn small ghost", onclick: function () { picked.splice(i, 1); renderPicked(list); } }, "Remove")));
    });
  }

  function fieldErrors(errs) {
    var first = null;
    META.fields.concat([{ key: "consent" }]).forEach(function (f) {
      var e = document.getElementById("e_" + f.key);
      var w = document.getElementById("w_" + f.key);
      if (!e) return;
      e.textContent = errs[f.key] || "";
      if (w) w.classList.toggle("bad", !!errs[f.key]);
      if (errs[f.key] && !first) first = e;
    });
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function collect(form) {
    var body = { consent: document.getElementById("consent").checked, company_url: form.elements.company_url.value };
    META.fields.forEach(function (f) {
      if (f.type === "package") { var r = form.querySelector('input[name="package"]:checked'); body.package = r ? r.value : ""; return; }
      var el = form.querySelector("#f_" + f.key);
      if (el) body[f.key] = el.value;
    });
    return body;
  }

  function onSubmit(ev) {
    ev.preventDefault();
    var form = ev.target;
    var btn = document.getElementById("sendBtn");
    var state = document.getElementById("sendState");
    fieldErrors({});
    btn.disabled = true;
    state.textContent = "Sending your brief...";
    call("/submit", { method: "POST", json: collect(form) }).then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        if (res.data && res.data.fields) { fieldErrors(res.data.fields); state.textContent = "Please check the highlighted fields."; }
        else state.textContent = (res.data && res.data.message) || "Something went wrong. Please try again.";
        return;
      }
      if (res.data.key === "pj_fake.fake") { state.textContent = "Thank you."; return; }
      saveKey(res.data.key);
      uploadAll(state).then(function (failed) {
        return call("/finalize", { method: "POST", json: {} }).then(function () {
          if (failed.length) notice = failed.length + " file(s) could not be uploaded: " + failed.join(", ") + ". You can add them from your dashboard.";
          picked = [];
          return load(true);
        });
      });
    });
  }

  function uploadAll(state) {
    var failed = [];
    var chain = Promise.resolve();
    picked.forEach(function (f, i) {
      chain = chain.then(function () {
        state.textContent = "Uploading file " + (i + 1) + " of " + picked.length + "...";
        return upload(f).then(function (ok) { if (!ok) failed.push(f.name); });
      });
    });
    return chain.then(function () { return failed; });
  }
  function upload(file) {
    return call("/files?name=" + encodeURIComponent(file.name), { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } }).then(function (r) { return r.ok; });
  }

  function linkAgainCard() {
    var msg = h("p", { class: "small", role: "status", "aria-live": "polite" });
    var input = h("input", { type: "email", id: "againEmail", autocomplete: "email", placeholder: "you@company.com" });
    return h("div", { class: "card" },
      h("h2", null, "Already shared a brief?"),
      h("p", { class: "muted" }, "Enter your email and we will send your private dashboard link again."),
      h("div", { class: "row" }, h("label", { class: "sr", for: "againEmail" }, "Email address"), input,
        h("button", { class: "btn ghost", type: "button", onclick: function () {
          call("/request-link", { method: "POST", json: { email: input.value } }).then(function (r) { msg.textContent = (r.data && r.data.message) || "Done."; });
        } }, "Send my link")),
      msg);
  }

  /* ------------------------------------------------------------ dashboard */
  function load(force) {
    return call("/project").then(function (res) {
      if (res.status === 401) { forgetKey(); stopPoll(); showIntake(); return; }
      if (!res.ok) { clear(app); app.appendChild(h("div", { class: "callout err" }, (res.data && res.data.message) || "Could not load your project.", " ", h("button", { class: "btn small ghost", type: "button", onclick: function () { load(true); } }, "Try again"))); return; }
      var fp = res.data.project.status + "|" + res.data.messages.length + "|" + (res.data.proposal ? res.data.proposal.id : "") + "|" + res.data.files.assets.length + "|" + res.data.files.delivery.length;
      var changed = fp !== fingerprint;
      STATE = res.data;
      fingerprint = fp;
      if (force || changed) render();
      startPoll();
    });
  }
  function startPoll() {
    if (timer) return;
    timer = setInterval(function () { if (!document.hidden && KEY) load(false); }, 60000);
  }
  function stopPoll() { if (timer) clearInterval(timer); timer = null; }

  function keepDrafts() {
    document.querySelectorAll("[data-draft]").forEach(function (el) { drafts[el.getAttribute("data-draft")] = el.value; });
  }
  function restoreDrafts() {
    document.querySelectorAll("[data-draft]").forEach(function (el) { var v = drafts[el.getAttribute("data-draft")]; if (v) el.value = v; });
  }

  function render() {
    keepDrafts();
    var s = STATE;
    var p = s.project;
    document.title = p.brand + " | Share Your Brief";
    clear(app);
    app.appendChild(h("div", null,
      h("div", { class: "kicker" }, "Your project dashboard"),
      h("h1", null, p.brand),
      h("div", { class: "row" }, h("span", { class: "chip gold" }, p.statusLabel), h("span", { class: "chip" }, p.package.label + " package"))));
    if (notice) { app.appendChild(h("div", { class: "callout" }, notice)); }
    app.appendChild(stepsStrip(p.step));
    app.appendChild(nextCallout());
    if (s.proposal) app.appendChild(proposalCard());
    if (s.delivery) app.appendChild(deliveryCard());
    app.appendChild(messagesCard());
    app.appendChild(briefCard());
    app.appendChild(termsCard());
    restoreDrafts();
    var foot = document.getElementById("foot");
    clear(foot);
    foot.appendChild(h("button", { class: "btn small ghost", type: "button", onclick: function () { forgetKey(); stopPoll(); fingerprint = ""; showIntake(); } }, "Not you? Forget this device"));
  }

  function nextCallout() {
    var s = STATE, p = s.project, d = s.delivery;
    var text, cls = "callout";
    if (p.status === "brief_received" || p.status === "draft") text = "Your brief is in. Hook options and a script arrive here within 24 to 48 hours.";
    else if (p.status === "script_review") { text = "Your hooks and script are ready below. Approve one hook and the script, or ask for small changes."; }
    else if (p.status === "changes_requested") text = "Your change request is with me. An updated version will appear here. Change rounds used: " + s.rounds.used + " of " + s.rounds.allowed + ".";
    else if (p.status === "approved") { text = "Approved. Production is being prepared."; cls += " ok"; }
    else if (p.status === "in_production") { text = "Your videos are in production."; cls += " ok"; }
    else if (p.status === "delivered") { text = d && d.revisionOpen ? "Your videos are delivered. Revisions are open until " + fmtDate(d.revisionUntil) + "." : "Your videos are delivered."; cls += " ok"; }
    else text = "This project is closed. Thank you for working with TAHA Studio Labs.";
    return h("div", { class: cls, role: "status" }, h("b", null, "What is next. "), text);
  }

  function proposalCard() {
    var s = STATE, pr = s.proposal, open = s.project.status === "script_review";
    var approvedHook = s.approval ? s.approval.hook : null;
    var card = h("section", { class: "card", "aria-labelledby": "ph" }, h("h2", { id: "ph" }, "Hooks and script"), h("p", { class: "muted" }, pr.intro));
    var hooksWrap = h("div", { class: "list", role: open ? "radiogroup" : null });
    pr.hooks.forEach(function (t, i) {
      var n = i + 1;
      var input = open ? h("input", { type: "radio", name: "hook", value: String(n), checked: n === pr.recommended }) : null;
      var cls = "hook" + (approvedHook && approvedHook !== n ? " dim" : "") + (approvedHook === n ? " sel" : "");
      hooksWrap.appendChild(h("label", { class: cls }, input, h("span", null, h("b", null, "Hook option " + n + (n === pr.recommended ? " (recommended)" : "") + (approvedHook === n ? " (approved)" : "")), h("br"), t)));
    });
    card.appendChild(hooksWrap);
    var sc = pr.script;
    card.appendChild(h("h3", null, "Script based on hook option " + pr.recommended));
    card.appendChild(h("dl", { class: "script" },
      h("dt", null, "Hook"), h("dd", null, sc.hook), h("dt", null, "Problem"), h("dd", null, sc.problem), h("dt", null, "Solution"), h("dd", null, sc.solution),
      h("dt", null, "Benefit"), h("dd", null, sc.benefit), h("dt", null, "Call to action"), h("dd", null, sc.cta)));
    if (s.approval) {
      card.appendChild(h("div", { class: "callout ok" }, "You approved hook " + s.approval.hook + " and this script on " + fmtDate(s.approval.at) + ". Production is unlocked."));
      return card;
    }
    if (!open) return card;
    var confirm = h("input", { type: "checkbox", id: "confirmScript" });
    var okBtn = h("button", { class: "btn gold", type: "button", disabled: true, onclick: function () {
      var r = document.querySelector('input[name="hook"]:checked');
      okBtn.disabled = true;
      call("/approve", { method: "POST", json: { proposalId: pr.id, hook: r ? r.value : 0, confirmScript: true } }).then(function (res) {
        if (!res.ok) { notice = (res.data && res.data.message) || "Could not approve."; }
        load(true);
      });
    } }, "Approve this hook and script");
    confirm.addEventListener("change", function () { okBtn.disabled = !confirm.checked; });
    card.appendChild(h("label", { class: "row" }, confirm, h("span", null, "I confirm the script above and the hook I selected.")));
    card.appendChild(okBtn);
    var left = s.rounds.left;
    var ta = h("textarea", { "data-draft": "changes", "aria-label": "What would you like changed?", placeholder: "Tell me what to change. Small changes only, for example a different tone, a different opening line, or a claim to remove.", disabled: left === 0 });
    var chBtn = h("button", { class: "btn ghost", type: "button", disabled: left === 0, onclick: function () {
      chBtn.disabled = true;
      call("/changes", { method: "POST", json: { proposalId: pr.id, text: ta.value } }).then(function (res) {
        if (!res.ok) { notice = (res.data && res.data.message) || "Could not send."; } else { drafts.changes = ""; notice = ""; }
        load(true);
      });
    } }, "Request changes");
    card.appendChild(h("h3", null, "Or request changes"));
    card.appendChild(h("p", { class: "small muted" }, left > 0 ? "Change round " + (s.rounds.used + 1) + " of " + s.rounds.allowed + ". Production starts only after you approve one hook and one script." : "Both included change rounds are used. You can still approve this version, or ask in the messages about an extra concept round."));
    card.appendChild(ta);
    card.appendChild(chBtn);
    return card;
  }

  function download(file) {
    fetch(API + "/files/" + file.id, { headers: { "X-Project-Key": KEY } }).then(function (r) {
      if (!r.ok) throw new Error("x");
      return r.blob();
    }).then(function (b) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }).catch(function () { notice = "That download did not work. Please try again."; render(); });
  }

  function fileList(files) {
    return h("ul", { class: "files" }, files.map(function (f) {
      return h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"), h("button", { class: "btn small ghost", type: "button", onclick: function () { download(f); } }, "Download"));
    }));
  }

  function deliveryCard() {
    var s = STATE, d = s.delivery;
    var card = h("section", { class: "card", "aria-labelledby": "dh" }, h("h2", { id: "dh" }, "Your delivery"));
    card.appendChild(h("dl", { class: "kv" },
      h("dt", null, "Package"), h("dd", null, s.project.package.label),
      h("dt", null, "Videos delivered"), h("dd", null, String(d.videos)),
      h("dt", null, "Approved hook used"), h("dd", null, s.approval && s.approval.hookText ? s.approval.hookText : ""),
      h("dt", null, "Delivered"), h("dd", null, fmtDate(d.deliveredAt)),
      h("dt", null, "Usage rights included"), h("dd", null, d.usage)));
    card.appendChild(h("p", { class: "small muted" }, d.usageNote));
    if (d.link) card.appendChild(h("p", null, "Delivery link: ", h("a", { href: d.link, target: "_blank", rel: "noopener noreferrer" }, d.link)));
    if (d.note) card.appendChild(h("p", null, d.note));
    if (s.files.delivery.length) { card.appendChild(h("h3", null, "Files")); card.appendChild(fileList(s.files.delivery)); }
    card.appendChild(h("h3", null, "Revisions"));
    if (d.revisionOpen) {
      var days = Math.max(0, Math.ceil((Date.parse(d.revisionUntil) - Date.now()) / 86400000));
      card.appendChild(h("p", { class: "small muted" }, "Open until " + fmtDate(d.revisionUntil) + " (" + days + " day" + (days === 1 ? "" : "s") + " left). Revision rounds used: " + d.revisionsUsed + " of " + d.revisionsAllowed + " (" + s.project.package.revision + ")."));
      var ta = h("textarea", { "data-draft": "revision", "aria-label": "What should be revised?", placeholder: "Describe what you would like revised." });
      var b = h("button", { class: "btn ghost", type: "button", onclick: function () {
        b.disabled = true;
        call("/revision", { method: "POST", json: { text: ta.value } }).then(function (res) {
          if (!res.ok) notice = (res.data && res.data.message) || "Could not send."; else { drafts.revision = ""; notice = "Revision request sent."; }
          load(true);
        });
      } }, "Request revision");
      card.appendChild(ta);
      card.appendChild(b);
    } else {
      card.appendChild(h("p", { class: "muted" }, "The " + (META ? META.revisionDays : 7) + " day revision window has ended or all included revision rounds are used. Use the messages below if you need something else."));
    }
    return card;
  }

  function messagesCard() {
    var s = STATE;
    var thread = h("div", { class: "thread", role: "log", "aria-live": "polite" });
    s.messages.forEach(function (m) {
      var who = m.author === "client" ? "You" : m.author === "admin" ? "TAHA Studio Labs" : "Update";
      thread.appendChild(h("div", { class: "msg " + m.author }, h("span", { class: "meta" }, who + " · " + fmtTime(m.at)), m.body));
    });
    var ta = h("textarea", { "data-draft": "message", "aria-label": "Write a message", placeholder: "Write a message to TAHA Studio Labs" });
    var b = h("button", { class: "btn", type: "button", onclick: function () {
      if (!ta.value.trim()) return;
      b.disabled = true;
      call("/message", { method: "POST", json: { text: ta.value } }).then(function (res) {
        if (!res.ok) notice = (res.data && res.data.message) || "Could not send."; else { drafts.message = ""; notice = ""; }
        load(true);
      });
    } }, "Send message");
    var card = h("section", { class: "card", "aria-labelledby": "mh" }, h("h2", { id: "mh" }, "Messages"), thread, ta, b);
    setTimeout(function () { thread.scrollTop = thread.scrollHeight; }, 0);
    return card;
  }

  function briefCard() {
    var s = STATE;
    var d = h("details", { class: "card" }, h("summary", null, "Your brief"));
    d.appendChild(h("dl", { class: "kv" }, s.brief.map(function (r) { return [h("dt", null, r.label), h("dd", null, r.value)]; })));
    d.appendChild(h("h3", null, "Files you shared"));
    d.appendChild(s.files.assets.length ? fileList(s.files.assets) : h("p", { class: "muted" }, "No files shared."));
    if (["draft", "brief_received", "script_review", "changes_requested", "approved"].indexOf(s.project.status) >= 0) {
      var input = h("input", { type: "file", multiple: true, "aria-label": "Add more files" });
      input.addEventListener("change", function () {
        var files = Array.prototype.slice.call(input.files);
        var chain = Promise.resolve();
        files.forEach(function (f) { chain = chain.then(function () { return upload(f); }); });
        chain.then(function () { load(true); });
      });
      d.appendChild(h("p", { class: "small muted" }, "Add more files:"));
      d.appendChild(input);
    }
    return d;
  }

  function termsCard() {
    var s = STATE;
    return h("section", { class: "card" }, h("h2", null, s.project.package.label + " package terms"),
      h("p", null, "Usage rights: " + s.project.package.usage + "."),
      h("p", null, "Revisions: " + s.project.package.revision + ", requested within " + (META ? META.revisionDays : 7) + " days of delivery."),
      h("p", { class: "small muted" }, META ? META.usageNote : ""));
  }

  /* ------------------------------------------------------------ boot */
  readKey();
  call("/meta").then(function (res) {
    if (!res.ok) { clear(app); app.appendChild(h("div", { class: "callout err" }, "This page could not load. Please refresh.")); return; }
    META = res.data;
    if (KEY) load(true); else showIntake();
  });
})();
