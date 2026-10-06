/* ScriptForge Growth Clients panel (TAHA Growth Department V1, phases 3 and 4).

   What it does
   - On page load, and whenever the ScriptForge account changes, it asks the Brain Vault
     (GET /api/vault/admin/check) whether the visitor is the admin. Public users get
     {admin:false} and this file then does nothing at all: no button, no panel.
   - For the admin it adds a "Growth Clients" button to the ScriptForge header. The button
     opens a full-width, closable panel above section 1.
   - The panel lists clients (GET /api/vault/admin/clients) when it opens and every 60
     seconds while it is open, invites new clients, and shows the selected client's intake
     read-only with its files. A submitted intake Harry has not opened yet carries a "New"
     badge; opening it marks that version seen.
   - Phase 4: the Business Brain tab and button live in growth-brain.js, loaded on demand.
   - Phase 5: the Campaigns tab (Campaign Generator) lives in growth-campaign.js, loaded on
     demand. Its short video card can hand the script to ScriptForge's own sections 1 to 5.
   - Phase 6: the Data and privacy tab: full export, Mark as left (erased 6 months later) and
     Erase now, confirmed by typing the client's email (no browser pop-ups).

   House rules
   - The AI key stays with ScriptForge. The strip only checks whether the section 2 key field
     is filled in. When Harry presses Build Business Brain, the key is read at that moment and
     sent only to ScriptForge's own /api/format relay, exactly as a normal ScriptForge script
     run does. It is never sent to the Brain Vault.
   - Client content is always written with textContent, never as HTML.
   - Nothing in ScriptForge sections 1 to 7, the Library, Characters or PDF export changes. */
(function () {
  "use strict";

  var API = "/api/vault";
  var POLL_MS = 60000;

  var PROVIDERS = {
    anthropic: { key: "apiKey", model: "model" },
    gemini: { key: "apiKeyGemini", model: "modelGemini" },
    groq: { key: "apiKeyGroq", model: "modelGroq" },
    deepseek: { key: "apiKeyDeepseek", model: "modelDeepseek" }
  };

  var LANGS = { sv: "Swedish", en: "English", both: "Swedish and English" };

  var S = {
    admin: false,
    open: false,
    clients: [],
    selectedId: null,
    detail: null,
    tab: "intake",
    timer: null,
    lastCheck: null,
    online: null,
    checking: false
  };

  var ui = null;
  var brain = null;
  var brainLoading = null;
  var camps = null;

  /* ---------- small helpers ---------- */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else if (k === "on") Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: { Accept: "application/json" } };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init).then(
      function (r) {
        return r.json().then(
          function (d) { return { ok: r.ok, status: r.status, d: d }; },
          function () { return { ok: r.ok, status: r.status, d: null }; }
        );
      },
      function () { return { ok: false, status: 0, d: null }; }
    );
  }

  function msgEn(d, fallback) {
    if (d && d.message) return typeof d.message === "string" ? d.message : d.message.en || fallback;
    return fallback;
  }

  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function clock(d) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function safeUrl(v) {
    var s = String(v || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return "https://" + s;
    return null;
  }

  function statusLabel(c) {
    return c.statusLabel && c.statusLabel.en ? c.statusLabel.en : c.status;
  }

  function selected() {
    for (var i = 0; i < S.clients.length; i++) if (S.clients[i].id === S.selectedId) return S.clients[i];
    return null;
  }

  function newCount() {
    return S.clients.filter(function (c) { return c.isNew; }).length;
  }

  /* ---------- admin check ---------- */

  function checkAdmin() {
    return api("/admin/check").then(function (r) {
      var isAdmin = !!(r.ok && r.d && r.d.admin === true);
      if (isAdmin && !S.admin) enable();
      else if (!isAdmin && S.admin) disable();
    });
  }

  /* ---------- header button ---------- */

  function enable() {
    S.admin = true;
    var header = document.querySelector("body > header");
    var account = document.getElementById("btnAccount");
    if (!header || !account) return;
    var count = h("span", { class: "gc-count", hidden: true });
    var btn = h("button", { type: "button", class: "gc-btn-growth", id: "btnGrowth", "aria-expanded": "false", "aria-controls": "growthPanel", on: { click: toggle } }, "Growth Clients", count);
    var wrap = h("div", { class: "gc-head-actions", id: "gcHeadActions" });
    account.dataset.gcStyle = account.getAttribute("style") || "";
    account.removeAttribute("style");
    header.appendChild(wrap);
    wrap.appendChild(btn);
    wrap.appendChild(account);

    var panel = buildPanel();
    var main = document.querySelector("body > main");
    main.parentNode.insertBefore(panel, main);

    ui.btn = btn;
    ui.count = count;
    ui.wrap = wrap;
    ui.panel = panel;

    watchSection2();
    loadBrain();
    /* A background check keeps the header badge honest even while the panel is closed. */
    refresh();
    schedule();
    if (location.hash === "#growth") openPanel();
  }

  function disable() {
    S.admin = false;
    S.open = false;
    S.clients = [];
    S.selectedId = null;
    S.detail = null;
    if (S.timer) clearTimeout(S.timer);
    S.timer = null;
    if (!ui) return;
    var account = document.getElementById("btnAccount");
    var header = document.querySelector("body > header");
    if (account && header) {
      if (account.dataset.gcStyle) account.setAttribute("style", account.dataset.gcStyle);
      header.appendChild(account);
    }
    if (ui.wrap) ui.wrap.remove();
    if (ui.panel) ui.panel.remove();
    ui = null;
  }

  function updateButton() {
    if (!ui || !ui.btn) return;
    var n = newCount();
    ui.count.textContent = String(n);
    ui.count.hidden = n === 0;
    ui.btn.setAttribute("aria-label", n ? "Growth Clients, " + n + " new" : "Growth Clients");
    ui.btn.setAttribute("aria-expanded", S.open ? "true" : "false");
  }

  function toggle() {
    if (S.open) closePanel();
    else openPanel();
  }

  function openPanel() {
    S.open = true;
    ui.panel.hidden = false;
    updateButton();
    if (location.hash !== "#growth") history.replaceState(null, "", location.pathname + location.search + "#growth");
    refresh();
    ui.panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closePanel() {
    S.open = false;
    ui.panel.hidden = true;
    updateButton();
    if (location.hash === "#growth") history.replaceState(null, "", location.pathname + location.search);
  }

  /* ---------- polling ---------- */

  function schedule() {
    if (S.timer) clearTimeout(S.timer);
    S.timer = setTimeout(function () {
      refresh().then(schedule);
    }, POLL_MS);
  }

  function refresh() {
    if (!S.admin) return Promise.resolve();
    /* A check is already running: run once more right after it, so a change Harry just made
       (save, status) shows without waiting for the next 60 second check. */
    if (S.checking) { S.again = true; return Promise.resolve(); }
    S.checking = true;
    return api("/admin/clients").then(function (r) {
      S.checking = false;
      if (!ui) return;
      S.lastCheck = new Date();
      if (r.status === 401 || r.status === 403) {
        disable();
        return;
      }
      S.online = r.ok;
      if (r.ok && r.d && Array.isArray(r.d.clients)) {
        var before = selected();
        S.clients = r.d.clients;
        if (!S.selectedId && S.clients.length) {
          var firstNew = S.clients.filter(function (c) { return c.isNew; })[0];
          S.selectedId = (firstNew || S.clients[0]).id;
        }
        var now = selected();
        if (!now) S.selectedId = S.clients.length ? S.clients[0].id : null;
        now = selected();
        var changed = !before || !now || !S.detail || before.id !== now.id || now.latestIntakeVersion !== S.detail.version || now.status !== before.status;
        var leftChanged = !!(before && now && before.id === now.id && (before.leftAt || null) !== (now.leftAt || null));
        renderList();
        if (S.open && now && changed) loadDetail(now.id);
        else if (S.open && leftChanged && S.tab === "privacy") renderDetail();
        else if (!now) renderDetail();
      }
      renderLive();
      updateButton();
      if (S.again) { S.again = false; refresh(); }
    });
  }

  /* ---------- section 2 strip ---------- */

  function providerInfo(withKey) {
    var sel = document.getElementById("formatProvider");
    var p = sel ? sel.value : "anthropic";
    if (!PROVIDERS[p]) p = "anthropic";
    var map = PROVIDERS[p];
    var label = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.replace(/\s*\(.*\)\s*$/, "") : "Anthropic Claude";
    var m = document.getElementById(map.model);
    var model = m && m.value ? m.value : "";
    var k = document.getElementById(map.key);
    var val = k && k.value ? k.value.trim() : "";
    var hasKey = !!val && val !== "sk-ant-YOUR_KEY_HERE";
    var out = { provider: p, label: label, model: model, hasKey: hasKey };
    /* Only the Build Business Brain call asks for the key itself, at the moment it is pressed. */
    if (withKey === true && hasKey) out.key = val;
    return out;
  }

  /* No key yet: take Harry to the key field in section 2. */
  function pointToSection2() {
    var p = providerInfo();
    var k = document.getElementById((PROVIDERS[p.provider] || PROVIDERS.anthropic).key);
    if (k) {
      k.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { k.focus(); }, 400);
    }
  }

  /* Phase 5: the short video card's "Send to ScriptForge". Sets section 1 to Short Advert,
     section 4 to 9:16, three 10 second segments, pastes the script into section 5, closes the
     panel and scrolls there. ScriptForge's own Format button and video steps take it from there.
     V2 phase G1: target is "veo" (Veo 3.1, scenes) or "heygen" (HeyGen, talking avatar). The
     formatted segments then start on that generator (window.__sfVideoTarget, read by app.js). */
  function setField(id, value, evt) {
    var el = document.getElementById(id);
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event(evt || "change", { bubbles: true }));
    return true;
  }
  function sendToScriptForge(script, target) {
    window.__sfVideoTarget = target === "heygen" ? "heygen" : "veo";
    setField("scriptType", "Short Advert");
    setField("ratio", "9:16");
    setField("segCount", "3");
    setField("script", String(script || ""), "input");
    closePanel();
    var el = document.getElementById("script");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { el.focus(); }, 400);
    }
  }

  /* Phase 4 and 5: the Business Brain and Campaign Generator modules, loaded only for the admin. */
  function loadBrain() {
    if (brain || brainLoading) return brainLoading;
    var ctx = {
      h: h,
      clear: clear,
      api: api,
      when: when,
      providerInfo: providerInfo,
      pointToSection2: pointToSection2,
      sendToScriptForge: sendToScriptForge,
      rerender: function (id) {
        if (ui && S.selectedId === id) renderDetail();
      },
      onSaved: function (id) {
        /* Reload this client's details directly: the list refresh may be skipped if the
           60 second check is already running at this moment. */
        if (S.selectedId === id) loadDetail(id);
        refresh();
      }
    };
    brainLoading = Promise.all([import("/assets/growth-brain.js?v=p5"), import("/assets/growth-campaign.js?v=g1b")]).then(function (mods) {
      brain = mods[0].createBrain(ctx);
      camps = mods[1].createCampaigns(ctx);
      if (ui) renderDetail();
    }, function () {
      brainLoading = null;
    });
    return brainLoading;
  }

  function renderStrip() {
    if (!ui) return;
    var p = providerInfo();
    clear(ui.provider);
    ui.provider.appendChild(h("b", { text: p.label + (p.model ? " · " + p.model : "") }));
    ui.provider.appendChild(document.createTextNode(", from section 2. "));
    ui.provider.appendChild(document.createTextNode(p.hasKey ? "Key set. It is used only for calls to your AI provider, never sent to the Brain Vault." : "No key in section 2 yet. Add one to build a Business Brain."));
    if (ui && ui.main && S.detail && !(brain && brain.entry(S.detail.client.id).building)) {
      var bb = document.getElementById("gcBrainBtn");
      if (bb) renderDetail();
    }
  }

  function watchSection2() {
    ["formatProvider", "model", "modelGemini", "modelGroq", "modelDeepseek"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", renderStrip);
    });
    ["apiKey", "apiKeyGemini", "apiKeyGroq", "apiKeyDeepseek"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", renderStrip);
    });
  }

  function renderLive() {
    if (!ui) return;
    clear(ui.live);
    var dot = h("span", { class: "gc-dot" + (S.online === false ? " off" : S.online == null ? " wait" : "") });
    var text = S.online === false
      ? "Brain Vault unreachable, retrying every 60 s"
      : S.online == null
        ? "Connecting to the Brain Vault"
        : "Brain Vault connected · checked " + clock(S.lastCheck) + " · checks every 60 s";
    ui.live.appendChild(dot);
    ui.live.appendChild(document.createTextNode(text));
  }

  /* ---------- panel skeleton ---------- */

  function buildPanel() {
    ui = {};
    ui.provider = h("span");
    ui.live = h("span", { class: "gc-live", role: "status" });
    ui.list = h("div", { class: "gc-side", id: "gcList" });
    ui.main = h("section", { class: "gc-main", "aria-live": "polite" });
    ui.form = buildInviteForm();

    var inviteBtn = h("button", { type: "button", class: "btn-copy", "aria-controls": "gcInvite", on: { click: function () {
      ui.form.hidden = !ui.form.hidden;
      if (!ui.form.hidden) ui.form.querySelector("input").focus();
    } } }, "+ Invite client");

    var side = h("aside", { class: "gc-side" },
      h("div", { class: "gc-side-head" }, h("h3", { text: "Clients" }), inviteBtn),
      ui.form,
      ui.list
    );

    var panel = h("section", { class: "gc-panel", id: "growthPanel", hidden: true, "aria-label": "Growth Clients" },
      h("div", { class: "gc-shell" },
        h("div", { class: "gc-top" },
          h("div", null, h("h2", { style: "display:inline" }, "Growth Clients"), h("span", { class: "gc-admin", text: "Admin only" })),
          h("button", { type: "button", class: "btn-copy", on: { click: closePanel } }, "Close")
        ),
        h("div", { class: "gc-strip" }, ui.provider, ui.live),
        h("div", { class: "gc-body" }, side, ui.main)
      )
    );
    renderStrip();
    renderLive();
    renderList();
    renderDetail();
    return panel;
  }

  function buildInviteForm() {
    var name = h("input", { type: "text", id: "gcInvName", maxlength: "200", autocomplete: "off", required: true });
    var email = h("input", { type: "email", id: "gcInvEmail", autocomplete: "off", required: true });
    var lang = h("select", { id: "gcInvLang" },
      h("option", { value: "sv" }, "Svenska"),
      h("option", { value: "en" }, "English")
    );
    var msg = h("div", { class: "gc-msg", hidden: true, role: "status" });
    var send = h("button", { type: "submit", class: "btn-primary" }, "Send invite");
    var form = h("form", { class: "gc-form", id: "gcInvite", hidden: true, novalidate: true },
      h("label", { for: "gcInvName", text: "Business name" }), name,
      h("label", { for: "gcInvEmail", text: "Email" }), email,
      h("label", { for: "gcInvLang", text: "Invite language" }), lang,
      h("div", { class: "gc-actions" },
        send,
        h("button", { type: "button", class: "btn-ghost", on: { click: function () { form.hidden = true; } } }, "Cancel")
      ),
      msg
    );
    function say(cls, text) {
      msg.className = "gc-msg " + cls;
      msg.textContent = text;
      msg.hidden = false;
    }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var n = name.value.trim();
      var e = email.value.trim();
      if (!n) return say("err", "Enter the business name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return say("err", "Enter a valid email address.");
      send.disabled = true;
      say("info", "Sending the invite...");
      api("/admin/clients", { method: "POST", body: { name: n, email: e, language: lang.value } }).then(function (r) {
        send.disabled = false;
        if (r.ok && r.d && r.d.client) {
          say(r.d.emailSent ? "ok" : "err", r.d.emailSent
            ? "Invite sent to " + e + "."
            : "Client created, but the invite email failed. Open the client and press Resend invite.");
          name.value = "";
          email.value = "";
          S.selectedId = r.d.client.id;
          S.detail = null;
          refresh();
        } else if (r.status === 409) {
          say("err", "A client with that email already exists.");
          if (r.d && r.d.clientId) { S.selectedId = r.d.clientId; S.detail = null; refresh(); }
        } else {
          say("err", msgEn(r.d, "Could not create the client. Try again."));
        }
      });
    });
    return form;
  }

  /* ---------- client list ---------- */

  function renderList() {
    if (!ui) return;
    clear(ui.list);
    if (!S.clients.length) {
      ui.list.appendChild(h("div", { class: "gc-empty" }, S.lastCheck ? "No clients yet. Invite your first founding client." : "Loading clients..."));
      return;
    }
    S.clients.forEach(function (c) {
      var meta = "Intake v" + c.latestIntakeVersion + " · Brain v" + c.latestBrainVersion;
      var b = h("button", { type: "button", class: "gc-client", "aria-current": c.id === S.selectedId ? "true" : "false", on: { click: function () {
        if (S.selectedId === c.id && S.detail) return;
        S.selectedId = c.id;
        S.detail = null;
        S.notice = null;
        S.tab = "intake";
        renderList();
        loadDetail(c.id);
      } } },
        h("span", { class: "gc-row" }, h("span", { class: "gc-name", text: c.name }), c.isNew ? h("span", { class: "gc-new", text: "New" }) : null),
        h("span", { class: "gc-row" }, h("span", { class: "gc-badge st-" + c.status, text: statusLabel(c) })),
        h("span", { class: "gc-meta", text: meta + (c.latestSubmittedAt ? " · " + when(c.latestSubmittedAt) : "") }),
        c.leftAt ? h("span", { class: "gc-meta gc-left", text: "Left · erased " + whenDate(c.eraseAfter) }) : null
      );
      ui.list.appendChild(b);
    });
  }

  /* ---------- client detail ---------- */

  function loadDetail(id) {
    if (!ui) return;
    if (!S.detail || S.detail.client.id !== id) renderDetail(true);
    return api("/admin/intake/" + encodeURIComponent(id)).then(function (r) {
      if (!ui || S.selectedId !== id) return;
      if (!r.ok || !r.d) {
        S.detail = null;
        renderDetail(false, msgEn(r.d, "Could not load this client. Try again in a moment."));
        return;
      }
      S.detail = r.d;
      renderDetail();
      markSeen(id, r.d);
    });
  }

  function markSeen(id, d) {
    var c = selected();
    if (!c || d.source !== "submitted" || !d.version || d.version <= (c.seenIntakeVersion || 0)) return;
    api("/admin/clients/" + encodeURIComponent(id) + "/seen", { method: "POST", body: { version: d.version } }).then(function (r) {
      if (!r.ok || !r.d) return;
      c.seenIntakeVersion = r.d.seenIntakeVersion;
      c.isNew = c.latestIntakeVersion > c.seenIntakeVersion;
      renderList();
      updateButton();
    });
  }

  function renderDetail(loading, error) {
    if (!ui) return;
    clear(ui.main);
    if (S.notice) ui.main.appendChild(h("div", { class: "gc-msg " + S.notice.cls, role: "status", text: S.notice.text }));
    var c = selected();
    if (!c) {
      ui.main.appendChild(h("div", { class: "gc-soon" }, "Select a client on the left, or invite one."));
      return;
    }
    var d = S.detail && S.detail.client.id === c.id ? S.detail : null;
    var p = d && d.intake ? d.intake.profile || {} : {};
    var place = p.location ? p.location : "";
    var cl = d && d.intake ? d.intake.campaignLanguage : "";
    var subBits = [];
    if (place) subBits.push(place);
    subBits.push(c.email);
    if (cl) subBits.push("Campaign language: " + (LANGS[cl] || cl));

    var chips = h("div", { class: "gc-chips" }, h("span", { class: "gc-badge st-" + c.status, text: statusLabel(c) }));
    if (d && d.consent) chips.appendChild(h("span", { class: "gc-badge ok", text: "Consent " + d.consent.version + " accepted " + when(d.consent.acceptedAt) }));
    else if (d) chips.appendChild(h("span", { class: "gc-badge warn", text: "No consent yet" }));
    if (c.lastLoginAt) chips.appendChild(h("span", { class: "gc-badge", text: "Last login " + when(c.lastLoginAt) }));

    /* Manual status change (spec section 4: PATCH /admin/status). Normally the steps set it. */
    var STATUS_EN = [["invited", "Invited"], ["profile_in_progress", "Profile in progress"], ["submitted", "Submitted"], ["brain_ready", "Your strategy is ready"], ["campaign_in_production", "Campaign in production"], ["campaign_delivered", "Campaign delivered"]];
    var stSel = h("select", { id: "gcStatusSel", class: "gc-select" }, STATUS_EN.map(function (x) { return h("option", { value: x[0], selected: x[0] === c.status }, x[1]); }));
    stSel.addEventListener("change", function () {
      stSel.disabled = true;
      api("/admin/status/" + encodeURIComponent(c.id), { method: "PATCH", body: { status: stSel.value } }).then(function (r) {
        stSel.disabled = false;
        if (!r.ok) stSel.value = c.status;
        refresh();
      });
    });
    var statusCtl = h("div", { class: "gc-verpick gc-status-ctl" }, h("label", { for: "gcStatusSel", class: "gc-label", text: "Status the client sees" }), stSel);

    var resendMsg = h("div", { class: "gc-msg", hidden: true, role: "status" });
    var resend = null;
    if (c.status === "invited" || c.status === "profile_in_progress") {
      resend = h("button", { type: "button", class: "gc-link", on: { click: function () {
        resend.disabled = true;
        api("/admin/clients/" + encodeURIComponent(c.id) + "/invite", { method: "POST", body: {} }).then(function (r) {
          resend.disabled = false;
          resendMsg.className = "gc-msg " + (r.ok && r.d && r.d.emailSent ? "ok" : "err");
          resendMsg.textContent = r.ok && r.d && r.d.emailSent ? "A new invite link was sent to " + c.email + "." : "The invite email could not be sent. Try again.";
          resendMsg.hidden = false;
        });
      } } }, "Resend invite");
    }

    var bs = brain && d ? brain.buttonState(c, d) : { label: "Build Business Brain", disabled: true, hint: d ? "Loading..." : "" };
    var brainBtn = h("button", { type: "button", class: "gc-brain-btn", id: "gcBrainBtn", disabled: bs.disabled, "aria-describedby": "gcBrainHint", on: { click: function () {
      if (!brain || !S.detail) return;
      if (bs.noKey) { pointToSection2(); return; }
      S.tab = "brain";
      brain.build(c, S.detail);
    } } }, bs.label);

    ui.main.appendChild(h("div", { class: "gc-title" },
      h("div", null,
        h("h3", { text: (p.companyName && String(p.companyName).trim()) || c.name }),
        h("div", { class: "gc-sub", text: subBits.join(" · ") }),
        chips,
        resend ? h("div", { style: "margin-top:8px" }, resend) : null,
        statusCtl,
        resendMsg
      ),
      h("div", null, brainBtn, h("div", { class: "gc-hint", id: "gcBrainHint", text: bs.hint || "" }))
    ));

    var tabs = [["intake", "Intake"], ["brain", c.latestBrainVersion ? "Business Brain (v" + c.latestBrainVersion + ")" : "Business Brain"], ["campaigns", "Campaigns"], ["privacy", "Data and privacy"]];
    var tabBar = h("div", { class: "gc-tabs", role: "tablist" });
    tabs.forEach(function (t) {
      tabBar.appendChild(h("button", { type: "button", role: "tab", class: "gc-tab", "aria-selected": S.tab === t[0] ? "true" : "false", on: { click: function () {
        S.tab = t[0];
        renderDetail();
      } } }, t[1]));
    });
    ui.main.appendChild(tabBar);

    var pane = h("div", { role: "tabpanel", style: "display:flex;flex-direction:column;gap:14px" });
    ui.main.appendChild(pane);

    if (S.tab === "brain") {
      if (!brain) {
        pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading the Business Brain tools..."));
        loadBrain();
      } else if (!d) {
        pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading..."));
      } else {
        brain.renderTab(pane, c, d);
      }
      return;
    }
    if (S.tab === "privacy") {
      renderPrivacy(pane, c);
      return;
    }
    if (S.tab === "campaigns") {
      if (!camps || !brain) {
        pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading the Campaign Generator..."));
        loadBrain();
        return;
      }
      var be = brain.entry(c.id);
      brain.load(c.id);
      if (!d || (!be.loaded && !be.latest)) {
        pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading..."));
        return;
      }
      camps.renderTab(pane, c, d, be.latest);
      return;
    }

    if (error) {
      pane.appendChild(h("div", { class: "gc-msg err", text: error }));
      return;
    }
    if (loading || !d) {
      pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading the intake..."));
      return;
    }
    renderIntake(pane, d);
  }

  function field(label, value, wide) {
    var empty = value == null || value === "" || (Array.isArray(value) && !value.length);
    var v;
    if (empty) v = h("div", { class: "gc-v missing", text: "Not filled in" });
    else if (typeof value === "string") v = h("div", { class: "gc-v", text: value });
    else v = value;
    return h("div", { class: "gc-field" + (wide ? " wide" : "") }, h("div", { class: "gc-k", text: label }), v);
  }

  function lines(arr) {
    return h("div", { class: "gc-v" }, arr.map(function (x, i) { return h("div", { style: i ? "margin-top:6px" : null, text: x }); }));
  }

  function tags(list, avoid) {
    return h("div", { class: "gc-tags" }, list.map(function (w) { return h("span", { class: "gc-tag" + (avoid ? " avoid" : ""), text: w }); }));
  }

  function fileLink(f) {
    var size = f.size ? " (" + Math.max(1, Math.round(f.size / 1024)) + " KB)" : "";
    return h("div", null, h("a", { href: f.url, target: "_blank", rel: "noopener", text: f.name || f.id }), size);
  }

  function renderIntake(pane, d) {
    var i = d.intake;
    var head = d.source === "submitted"
      ? "Intake v" + d.version + " · read only · as the client submitted it " + when(d.submittedAt)
      : d.source === "draft"
        ? "Draft · not submitted yet · the client is still filling it in"
        : "Nothing yet · the client has not started the profile";

    var dl = h("button", { type: "button", class: "gc-link", on: { click: function () { download(d); } } }, "Download intake (JSON)");
    pane.appendChild(h("div", { class: "gc-bar" }, h("div", { class: "gc-label", text: head }), i ? dl : null));
    if (d.versions && d.versions.length > 1) {
      pane.appendChild(h("div", { class: "gc-meta", text: "Earlier versions: " + d.versions.slice(1).map(function (v) { return "v" + v.version + " (" + when(v.submittedAt) + ")"; }).join(", ") }));
    }
    if (!i) return;

    var p = i.profile || {};
    var grid = h("div", { class: "gc-grid" });
    grid.appendChild(field("Company name", p.companyName));
    var site = safeUrl(p.website);
    grid.appendChild(field("Website", p.website ? (site ? h("div", { class: "gc-v" }, h("a", { href: site, target: "_blank", rel: "noopener noreferrer", text: p.website })) : p.website) : ""));
    grid.appendChild(field("Location", p.location));
    grid.appendChild(field("Product / service", p.productService, true));
    grid.appendChild(field("Target audience", p.targetAudience, true));

    var bv = p.brandVoice || {};
    var bvBox = null;
    if (bv.text || (bv.toneChips && bv.toneChips.length)) {
      bvBox = h("div", { class: "gc-v" },
        bv.text ? h("div", { text: bv.text }) : null,
        bv.toneChips && bv.toneChips.length ? h("div", { style: "margin-top:8px" }, tags(bv.toneChips)) : null
      );
    }
    grid.appendChild(field("Brand voice", bvBox, true));
    grid.appendChild(field("USP", p.usp, true));

    var offers = (p.offers || []).filter(function (o) { return o && (o.offer || o.priceOrDiscount); }).map(function (o) {
      return [o.offer, o.priceOrDiscount, o.validUntil ? "valid until " + o.validUntil : ""].filter(Boolean).join(" · ");
    });
    grid.appendChild(field("Offers", offers.length ? lines(offers) : ""));
    var comps = (p.competitors || []).filter(function (c) { return c && (c.name || c.website); }).map(function (c) {
      return [c.name, c.website].filter(Boolean).join(" · ");
    });
    grid.appendChild(field("Competitors", comps.length ? lines(comps) : ""));

    var rv = p.reviews || {};
    var pasted = (rv.pasted || []).filter(Boolean);
    var revFiles = d.files.filter(function (f) { return f.section === "reviews"; });
    var revBox = null;
    if (pasted.length || revFiles.length) {
      revBox = h("div", { class: "gc-v" }, pasted.length ? lines(pasted.map(function (x) { return "“" + x + "”"; })) : null,
        revFiles.length ? h("div", { class: "gc-files", style: "margin-top:8px" }, revFiles.map(fileLink)) : null);
    }
    grid.appendChild(field("Reviews", revBox, true));

    var bw = p.brandWords || {};
    var use = (bw.use || []).filter(Boolean);
    var avoid = (bw.avoid || []).filter(Boolean);
    grid.appendChild(field("Brand words to use", use.length ? tags(use) : ""));
    grid.appendChild(field("Brand words to avoid", avoid.length ? tags(avoid, true) : ""));
    grid.appendChild(field("Campaign language", i.campaignLanguage ? LANGS[i.campaignLanguage] || i.campaignLanguage : ""));
    grid.appendChild(field("Client answered in", i.answerLanguage ? LANGS[i.answerLanguage] || i.answerLanguage : ""));
    pane.appendChild(grid);

    /* Uploads */
    var u = i.uploads || {};
    pane.appendChild(h("div", { class: "gc-label", style: "padding-top:4px", text: "Uploads" }));

    var pics = d.files.filter(function (f) { return f.section === "pictures"; });
    var picBox = h("div", { class: "gc-box" }, h("div", { class: "gc-bh" }, "Pictures · " + pics.length + (pics.length === 1 ? " file" : " files"), h("span", { text: "Click a picture to open it full size" })));
    if (pics.length) {
      picBox.appendChild(h("div", { class: "gc-pics" }, pics.map(function (f) {
        return h("a", { href: f.url, target: "_blank", rel: "noopener" }, h("img", { src: f.url, alt: f.name || "Client picture", loading: "lazy" }));
      })));
    } else picBox.appendChild(h("div", { class: "gc-meta", text: "No pictures uploaded" }));
    pane.appendChild(picBox);

    var fs = u.founderStory || {};
    var fsFiles = d.files.filter(function (f) { return f.section === "founderStory"; });
    var storyBox = h("div", { class: "gc-box" }, h("div", { class: "gc-bh" }, "Founder story", h("span", { text: fs.text ? "Text · " + fs.text.split(/\n\s*\n/).filter(function (x) { return x.trim(); }).length + " paragraphs" : fsFiles.length ? "File" : "" })));
    if (fs.text) storyBox.appendChild(h("div", { class: "gc-story", text: fs.text }));
    if (fsFiles.length) storyBox.appendChild(h("div", { class: "gc-files" }, fsFiles.map(fileLink)));
    if (!fs.text && !fsFiles.length) storyBox.appendChild(h("div", { class: "gc-meta", text: "Not given" }));
    pane.appendChild(storyBox);

    var posts = u.previousPosts || [];
    var postFiles = d.files.filter(function (f) { return f.section === "previousPosts"; });
    var byId = {};
    d.files.forEach(function (f) { byId[f.id] = f; });
    var postBox = h("div", { class: "gc-box" }, h("div", { class: "gc-bh" }, "Previous posts", h("span", { text: posts.length + (posts.length === 1 ? " item" : " items") })));
    if (posts.length) {
      postBox.appendChild(h("div", { class: "gc-files" }, posts.map(function (x) {
        if (x.type === "link") {
          var lu = safeUrl(x.value);
          return lu ? h("div", null, h("a", { href: lu, target: "_blank", rel: "noopener noreferrer", text: x.value })) : h("div", { text: x.value });
        }
        if (x.type === "image") {
          var f = byId[x.value];
          return f ? fileLink(f) : h("div", { class: "gc-meta", text: "Screenshot (file removed)" });
        }
        return h("div", { class: "gc-story", text: x.value });
      })));
    } else if (postFiles.length) {
      postBox.appendChild(h("div", { class: "gc-files" }, postFiles.map(fileLink)));
    } else postBox.appendChild(h("div", { class: "gc-meta", text: "Not given" }));
    pane.appendChild(postBox);

    var fq = u.faqs || {};
    var rows = (fq.rows || []).filter(function (r) { return r && (r.q || r.a); });
    var faqFiles = d.files.filter(function (f) { return f.section === "faqs"; });
    var faqBox = h("div", { class: "gc-box" }, h("div", { class: "gc-bh" }, "FAQs", h("span", { text: rows.length ? rows.length + " questions" : faqFiles.length ? "File" : "" })));
    rows.forEach(function (r) {
      faqBox.appendChild(h("div", null, h("div", { style: "font-weight:600;font-size:.86rem", text: r.q }), h("div", { class: "gc-story", text: r.a })));
    });
    if (faqFiles.length) faqBox.appendChild(h("div", { class: "gc-files" }, faqFiles.map(fileLink)));
    if (!rows.length && !faqFiles.length) faqBox.appendChild(h("div", { class: "gc-meta", text: "None given" }));
    pane.appendChild(faqBox);
  }

  function whenDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  /* ---------- Phase 6: data and privacy (GDPR) ---------- */

  function renderPrivacy(pane, c) {
    var msg = h("div", { class: "gc-msg", hidden: true, role: "status" });
    function say(cls, text) { msg.className = "gc-msg " + cls; msg.textContent = text; msg.hidden = false; }

    /* 1. Export */
    var exBtn = h("button", { type: "button", class: "btn-ghost", on: { click: function () {
      exBtn.disabled = true;
      fetch(API + "/admin/export/" + encodeURIComponent(c.id), { credentials: "same-origin" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      }).then(function (blob) {
        var slug = String(c.name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
        var a = h("a", { href: URL.createObjectURL(blob), download: "client-record-" + slug + ".json" });
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        exBtn.disabled = false;
        say("ok", "Full record downloaded: profile, every intake version, file list, consent log, status history, every brain and campaign.");
      }).catch(function () {
        exBtn.disabled = false;
        say("err", "Could not export. Try again.");
      });
    } } }, "Download full record (JSON)");
    pane.appendChild(h("section", { class: "gc-box" },
      h("div", { class: "gc-bh" }, "Export", h("span", { text: "For a client who asks for a copy of their data" })),
      h("div", { class: "gc-meta", text: "One JSON file with everything held about " + c.name + ". Files are listed with links that work while you are signed in." }),
      h("div", null, exBtn)));

    /* 2. Leaving and the retention rule */
    var leftBox = h("section", { class: "gc-box" }, h("div", { class: "gc-bh" }, "Leaving", h("span", { text: "Retention: 6 months after the work ends" })));
    if (c.leftAt) {
      leftBox.appendChild(h("div", { class: "gc-meta", text: "Marked as left on " + whenDate(c.leftAt) + ". Everything will be erased automatically on " + whenDate(c.eraseAfter) + ". The client can no longer sign in." }));
      leftBox.appendChild(h("div", null, h("button", { type: "button", class: "btn-ghost", on: { click: function (ev) { setLeft(c, false, ev.target); } } }, "Undo: the client is back")));
    } else {
      leftBox.appendChild(h("div", { class: "gc-meta", text: "When you stop working with " + c.name + ", mark them as left. Their sign-in stops at once, and everything is erased automatically 6 months later." }));
      leftBox.appendChild(h("div", null, h("button", { type: "button", class: "btn-ghost", on: { click: function (ev) { setLeft(c, true, ev.target); } } }, "Mark as left")));
    }
    pane.appendChild(leftBox);

    /* 3. Erase now */
    var confirmIn = h("input", { type: "text", id: "gcEraseConfirm", autocomplete: "off", spellcheck: "false" });
    var eraseBtn = h("button", { type: "button", class: "gc-danger", disabled: true }, "Erase everything now");
    confirmIn.addEventListener("input", function () {
      eraseBtn.disabled = confirmIn.value.trim().toLowerCase() !== String(c.email).toLowerCase();
    });
    eraseBtn.addEventListener("click", function () {
      eraseBtn.disabled = true;
      say("info", "Erasing...");
      api("/admin/clients/" + encodeURIComponent(c.id), { method: "DELETE", body: { confirm: confirmIn.value.trim() } }).then(function (r) {
        if (r.ok && r.d && r.d.erased) {
          var rem = r.d.remaining || {};
          S.notice = { cls: rem.rows === 0 && rem.files === 0 ? "ok" : "err", text: c.name + " was erased: " + r.d.filesDeleted + (r.d.filesDeleted === 1 ? " file" : " files") + " and " + r.d.rowsDeleted + " records deleted. Traces left: " + (rem.rows || 0) + " records, " + (rem.files || 0) + " files." };
          try {
            localStorage.removeItem("taha-growth-brain-draft:" + c.id);
            localStorage.removeItem("taha-growth-campaign-draft:" + c.id);
          } catch (e) {}
          S.clients = S.clients.filter(function (x) { return x.id !== c.id; });
          S.selectedId = null;
          S.detail = null;
          S.tab = "intake";
          renderList();
          renderDetail();
          updateButton();
          refresh();
        } else {
          eraseBtn.disabled = false;
          say("err", (r.d && r.d.message && r.d.message.en) || "Could not erase. Try again.");
        }
      });
    });
    pane.appendChild(h("section", { class: "gc-box gc-danger-box" },
      h("div", { class: "gc-bh" }, "Erase now", h("span", { text: "Cannot be undone" })),
      h("div", { class: "gc-meta", text: "Deletes every file and every record for " + c.name + ": profile, intake versions, uploads, consent log, status history, brains, campaigns, sign-ins and login links. Only an anonymous line stays to show that an erasure happened. Download the full record first if you need a copy." }),
      h("div", { class: "gc-ed" }, h("label", { for: "gcEraseConfirm", text: "Type " + c.email + " to confirm" }), confirmIn),
      h("div", null, eraseBtn)));
    pane.appendChild(msg);
    pane.appendChild(h("div", { class: "gc-meta", text: "The client's data processing agreement (PUB-avtal) is signed outside the portal." }));
  }

  function setLeft(c, left, btn) {
    if (btn) btn.disabled = true;
    api("/admin/clients/" + encodeURIComponent(c.id) + "/left", { method: "POST", body: { left: left } }).then(function (r) {
      if (r.ok && r.d) {
        /* Update the client as it is in the list now (the 60 s check may have replaced it). */
        S.clients.forEach(function (x) {
          if (x.id === c.id) { x.leftAt = r.d.leftAt; x.eraseAfter = r.d.eraseAfter; }
        });
        renderList();
        renderDetail();
      } else if (btn) btn.disabled = false;
      refresh();
    });
  }

  function download(d) {
    var doc = {
      exportedAt: new Date().toISOString(),
      client: d.client,
      consent: d.consent,
      source: d.source,
      intakeVersion: d.version,
      submittedAt: d.submittedAt,
      intake: d.intake,
      files: d.files.map(function (f) { return { id: f.id, section: f.section, name: f.name, mime: f.mime, size: f.size }; })
    };
    var slug = String(d.client.name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    var a = h("a", { href: URL.createObjectURL(blob), download: "intake-" + slug + "-v" + (d.version || "draft") + ".json" });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- start ---------- */

  function start() {
    checkAdmin();
    /* app.js fires this after every sign in, sign out or account refresh. */
    document.addEventListener("scriptforge:auth", function () { checkAdmin(); });
    window.addEventListener("hashchange", function () {
      if (S.admin && ui && location.hash === "#growth" && !S.open) openPanel();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && S.admin && S.open) refresh();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
