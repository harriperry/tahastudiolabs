/* TAHA Growth Department V2, Part H: the language reviewer's workspace at /grow/review/.
   The page itself is Swedish first, English on request; the texts are Swedish or Spanish. The reviewer sees only the texts Harry sent to them, for
   clients they are assigned to: the machine text on the left (read only), their version on the
   right, the character limit, the parts that must not change, and the brand's voice and words.
   Drafts save themselves; Harry sees nothing until an item is Done. */
(function () {
  "use strict";
  var API = "/api/vault";
  var DICT = null;
  var L = "sv";
  var ME = null;
  var Q = [];
  var filter = "open";
  var openId = null;
  var drafts = {};
  var timers = {};
  var msgs = {};
  var flagOpen = {};
  var app = document.getElementById("app");
  /* Markets step 2: a reviewer may check more than one language; each item says which. */
  var LANG_NAME = { sv: { sv: "Svenska", en: "Swedish" }, es: { sv: "Spanska", en: "Spanish" } };
  function langName(code) { return LANG_NAME[code] ? LANG_NAME[code][L] : code || ""; }

  function t(path, vars) {
    var v = path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, DICT ? DICT[L] : null);
    if (v == null) return path;
    return String(v).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    if (opts.json !== undefined) {
      opts.headers = { "Content-Type": "application/json", Accept: "application/json" };
      opts.body = JSON.stringify(opts.json);
      delete opts.json;
    }
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }, function () { return { ok: r.ok, status: r.status, data: {} }; });
    }, function () { return { ok: false, status: 0, data: {} }; });
  }
  function both(m) { return m ? (m[L] || m.en || m.sv || "") : ""; }

  /* Parts that must stay exactly as they are (same rule as the Vault). */
  function chips(s) {
    var out = [];
    [/https?:\/\/[^\s<>"']+/g, /\b[A-Z]{2,8}-(?:IG|FB|TT|LI|GB|EM|QR|VID|BIO|WEB)\b/g, /\{\{[A-Z_]+\}\}/g].forEach(function (re) {
      (String(s || "").match(re) || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    });
    return out;
  }

  function setLang(next) {
    L = next === "en" ? "en" : "sv";
    document.documentElement.lang = L;
    document.querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-lang") === L ? "true" : "false"); });
    try { localStorage.setItem("tv_rev_lang", L); } catch (e) {}
    document.getElementById("brandSub").textContent = t("rev.title");
    document.getElementById("signOut").textContent = t("rev.signout");
  }

  /* ---------- sign in ---------- */
  var sent = false;
  function viewSignin() {
    var email = h("input", { type: "email", id: "email", autocomplete: "email", required: true });
    var msg = h("p", { class: "msg", role: "status" });
    var form = h("form", { class: "card", novalidate: true, onSubmit: function (ev) {
      ev.preventDefault();
      api("/auth/request-link", { method: "POST", json: { email: email.value.trim(), lang: L } }).then(function (r) {
        msg.textContent = r.data && r.data.message ? both(r.data.message) : "";
        sent = true;
      });
    } }, h("label", { for: "email", text: "E-post / Email" }), email, h("button", { type: "submit", class: "btn", text: L === "en" ? "Send me a link" : "Skicka en länk" }), msg);
    return [h("div", { class: "head" }, h("h1", { text: t("rev.title") }), h("p", { class: "lead", text: t("rev.signin") })), form];
  }

  /* ---------- queue ---------- */
  function stateLabel(s) {
    return { waiting: t("rev.stWaiting"), sent_back: t("rev.stBack"), done: t("rev.stDone"), flagged: t("rev.stFlagged") }[s] || s;
  }
  function load() {
    return api("/review/queue").then(function (r) {
      if (r.ok) Q = r.data.items || [];
      render();
    });
  }
  function current(it) {
    if (drafts[it.id] != null) return drafts[it.id];
    if (it.draft != null) return it.draft;
    if (it.reviewed != null && it.state !== "waiting") return it.reviewed;
    return it.machine;
  }
  function saveDraft(it) {
    clearTimeout(timers[it.id]);
    msgs[it.id] = { text: t("rev.saving") };
    timers[it.id] = setTimeout(function () {
      api("/review/item/" + it.id, { method: "PUT", json: { draft: drafts[it.id] } }).then(function (r) {
        msgs[it.id] = r.ok ? { text: t("rev.saved") } : { err: true, text: both(r.data.message) };
        it.draft = drafts[it.id];
        var el = document.getElementById("m_" + it.id);
        if (el) { el.textContent = msgs[it.id].text; el.className = "msg small" + (msgs[it.id].err ? " err" : ""); }
      });
    }, 900);
  }
  function done(it, note) {
    api("/review/item/" + it.id + "/done", { method: "POST", json: { text: current(it), note: note } }).then(function (r) {
      if (r.ok) {
        it.state = "done";
        it.reviewed = current(it);
        delete drafts[it.id];
        msgs[it.id] = { text: t("rev.doneOk") };
        var next = Q.filter(function (x) { return x.state === "waiting" || x.state === "sent_back"; })[0];
        openId = next ? next.id : null;
      } else {
        msgs[it.id] = { err: true, text: (r.data.problems ? t("rev.fixFirst") + " " + r.data.problems.map(both).join(" ") : both(r.data.message)) };
      }
      render();
    });
  }
  function flag(it, comment) {
    api("/review/item/" + it.id + "/flag", { method: "POST", json: { comment: comment } }).then(function (r) {
      if (r.ok) { it.state = "flagged"; it.flagComment = comment; flagOpen[it.id] = false; }
      else msgs[it.id] = { err: true, text: both(r.data.message) };
      render();
    });
  }
  function editor(it) {
    var editable = it.state === "waiting" || it.state === "sent_back" || it.state === "flagged";
    var val = current(it);
    var ta = h("textarea", { id: "ta_" + it.id, class: "rv-ta", rows: String(Math.min(18, Math.max(3, Math.ceil(val.length / 60) + 1))), readonly: !editable });
    ta.value = val;
    var count = h("span", { class: "muted small" });
    function upd() {
      var n = ta.value.length;
      count.textContent = it.maxLen ? t("rev.limit", { n: n, max: it.maxLen }) : String(n);
      count.className = "small " + (it.maxLen && n > it.maxLen ? "over" : "muted");
    }
    upd();
    ta.addEventListener("input", function () { drafts[it.id] = ta.value; upd(); saveDraft(it); });
    var lockedList = chips(it.machine);
    var note = h("input", { type: "text", id: "nt_" + it.id, placeholder: t("rev.noteHarry") });
    note.value = it.reviewerNote || "";
    var ctx = it.context || {};
    var side = [];
    if (it.note) side.push(h("p", { class: "small rv-note" }, h("b", { text: t("rev.noteFrom") + ": " }), it.note));
    if (it.state === "sent_back" && it.flagComment) side.push(h("p", { class: "small rv-back", text: t("rev.backComment", { c: it.flagComment }) }));
    if (it.state === "flagged" && it.flagComment) side.push(h("p", { class: "small rv-back", text: t("rev.flagged", { c: it.flagComment }) }));
    var flagBox = null;
    if (flagOpen[it.id]) {
      var fc = h("textarea", { id: "fc_" + it.id, rows: "3", placeholder: t("rev.flagWhat") });
      flagBox = h("div", { class: "rv-flag" }, fc, h("button", { type: "button", class: "btn small secondary", text: t("rev.sendFlag"), onClick: function () { if (fc.value.trim()) flag(it, fc.value.trim()); } }));
    }
    return h("div", { class: "card rv-item" },
      h("div", { class: "pr-head" }, h("span", { class: "pr-badge" + (it.state === "done" ? " ok" : ""), text: stateLabel(it.state) }),
        h("span", { class: "muted small", text: langName(it.language) + " · " + it.clientName + " · " + it.campaignName + " · " + t("rev.round", { n: it.round }) + (it.due ? " · " + t("rev.due", { d: it.due }) : "") })),
      h("h2", { class: "rv-label", text: it.label }),
      side,
      h("div", { class: "rv-cols" },
        h("div", {}, h("div", { class: "kicker", text: t("rev.machine") }), h("p", { class: "rv-machine", text: it.machine })),
        h("div", {}, h("label", { class: "kicker", for: "ta_" + it.id, text: t("rev.yours") }), ta, count)),
      lockedList.length ? h("p", { class: "small" }, h("b", { text: t("rev.locked") + " " }), lockedList.map(function (c) { return h("code", { class: "chip", text: c }); })) : null,
      h("details", { class: "small" }, h("summary", { text: t("rev.voice") }),
        ctx.voice ? h("p", { text: ctx.voice }) : null,
        ctx.use && ctx.use.length ? h("p", {}, h("b", { text: t("rev.use") + ": " }), ctx.use.join(", ")) : null,
        ctx.avoid && ctx.avoid.length ? h("p", {}, h("b", { text: t("rev.avoid") + ": " }), ctx.avoid.join(", ")) : null),
      editable ? note : null,
      editable ? h("div", { class: "actions" },
        h("button", { type: "button", class: "btn", text: t("rev.done"), onClick: function () { done(it, note.value.trim()); } }),
        it.state !== "flagged" ? h("button", { type: "button", class: "btn secondary", text: t("rev.flag"), onClick: function () { flagOpen[it.id] = !flagOpen[it.id]; render(); } }) : null) : null,
      flagBox,
      h("p", { id: "m_" + it.id, class: "msg small" + (msgs[it.id] && msgs[it.id].err ? " err" : ""), role: "status", text: msgs[it.id] ? msgs[it.id].text : "" }));
  }
  function viewQueue() {
    var open = Q.filter(function (x) { return x.state === "waiting" || x.state === "sent_back"; });
    var list = filter === "open" ? open : filter === "done" ? Q.filter(function (x) { return x.state === "done"; }) : Q.filter(function (x) { return x.state === "sent_back" || x.state === "flagged"; });
    if (!openId && list.length) openId = list[0].id;
    var tabs = h("div", { class: "rv-tabs", role: "tablist" }, [["open", t("rev.filterWaiting") + " (" + open.length + ")"], ["done", t("rev.filterDone")], ["back", t("rev.filterBack")]].map(function (f) {
      return h("button", { type: "button", role: "tab", class: "rv-tab", "aria-selected": filter === f[0] ? "true" : "false", text: f[1], onClick: function () { filter = f[0]; openId = null; render(); } });
    }));
    var rows = list.map(function (it) {
      if (it.id === openId) return editor(it);
      return h("button", { type: "button", class: "card rv-row", onClick: function () { openId = it.id; render(); } },
        h("span", { class: "pr-badge" + (it.state === "done" ? " ok" : ""), text: stateLabel(it.state) }),
        h("b", { text: it.label }), h("span", { class: "muted small", text: langName(it.language) + " · " + it.clientName + " · " + it.campaignName }));
    });
    return [h("div", { class: "head" }, h("h1", { text: t("rev.title") }), h("p", { class: "lead", text: t("rev.lead") })), tabs,
      rows.length ? rows : h("div", { class: "card" }, h("p", { text: t("rev.empty") }))];
  }

  function render() {
    var y = window.scrollY;
    app.textContent = "";
    document.getElementById("signOut").classList.toggle("hidden", !ME);
    if (!ME) add(app, viewSignin());
    else if (ME.role !== "reviewer") add(app, h("div", { class: "card" }, h("p", { text: t("rev.notMember") })));
    else add(app, viewQueue());
    window.scrollTo(0, y);
  }

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); render(); });
  });
  document.getElementById("signOut").addEventListener("click", function () {
    api("/auth/logout", { method: "POST", json: {} }).then(function () { location.href = "/grow/review/"; });
  });
  fetch("/grow/i18n.json").then(function (r) { return r.json(); }).then(function (d) {
    DICT = d;
    var stored = null;
    try { stored = localStorage.getItem("tv_rev_lang"); } catch (e) {}
    setLang(stored || "sv");
    return api("/auth/me");
  }).then(function (r) {
    ME = r.ok && r.data && r.data.role ? r.data : null;
    if (ME && ME.role === "reviewer") return load();
    render();
  }).catch(function () {
    app.textContent = "Nätverksfel, ladda om sidan. / Network error, please reload the page.";
  });
})();
