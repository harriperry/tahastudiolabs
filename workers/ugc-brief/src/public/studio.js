/* Share Your Brief studio (admin). Hidden from the public: no page links here, the page is
   noindex, and every call needs the admin session cookie from the emailed sign-in link.
   All text goes in through textContent, never innerHTML. */
(function () {
  "use strict";
  var API = "/api/brief";
  var app = document.getElementById("app");
  var signOut = document.getElementById("signOut");
  var D = null;
  var draftId = null;
  var banner = "";

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
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
    if (opts.json) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .catch(function () { return { ok: false, status: 0, data: { message: "Could not reach the server." } }; });
  }
  function fmt(iso) { try { return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; } }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function copy(text, done) {
    var ok = function () { done("Copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { done("Copy failed"); });
    else { var t = h("textarea", { class: "sr" }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); ok(); } catch (e) { done("Copy failed"); } t.remove(); }
  }
  function note(kind, msg) { return h("div", { class: "callout" + (kind ? " " + kind : ""), role: "status" }, msg); }

  /* ------------------------------------------------ sign in */
  function showSignIn() {
    signOut.classList.add("hidden");
    clear(app);
    var email = h("input", { type: "email", id: "adminEmail", autocomplete: "email", placeholder: "hej@tahastudiolabs.com" });
    var out = h("p", { class: "small", role: "status", "aria-live": "polite" });
    app.appendChild(h("div", { class: "card" },
      h("h1", null, "Studio sign in"),
      h("p", { class: "muted" }, "Enter your studio email. If it can sign in, a one-time link arrives in your inbox."),
      h("label", { for: "adminEmail", class: "lab" }, "Email"), email,
      h("button", { class: "btn gold", type: "button", onclick: function () {
        call("/admin/request-link", { method: "POST", json: { email: email.value } }).then(function (r) { out.textContent = (r.data && r.data.message) || "Done."; });
      } }, "Email me a sign-in link"), out));
  }

  /* ------------------------------------------------ list */
  function showList() {
    D = null; draftId = null;
    signOut.classList.remove("hidden");
    history.replaceState(null, "", location.pathname);
    clear(app);
    app.appendChild(h("div", { class: "row split" }, h("div", null, h("div", { class: "kicker" }, "Share Your Brief"), h("h1", null, "Client projects")),
      h("button", { class: "btn small ghost", type: "button", onclick: showList }, "Refresh")));
    var list = h("div", { class: "list" }, h("p", { class: "muted" }, "Loading..."));
    app.appendChild(list);
    call("/admin/projects").then(function (r) {
      clear(list);
      if (r.status === 401) return showSignIn();
      var ps = (r.data && r.data.projects) || [];
      if (!ps.length) { list.appendChild(h("p", { class: "muted" }, "No briefs yet. They appear here the moment a client submits.")); return; }
      ps.forEach(function (p) {
        list.appendChild(h("button", { class: "item", type: "button", onclick: function () { location.hash = p.id; } },
          h("span", null, h("b", null, p.brand), h("br"), h("span", { class: "small muted" }, p.contactName + " · " + p.package + " · updated " + fmt(p.updatedAt))),
          h("span", { class: "row" }, p.needsYou ? h("span", { class: "chip clay" }, "Needs you") : null, h("span", { class: "chip" }, p.status.replace(/_/g, " ")))));
      });
    });
  }

  /* ------------------------------------------------ project */
  function openProject(id) {
    signOut.classList.remove("hidden");
    return call("/admin/projects/" + id).then(function (r) {
      if (r.status === 401) return showSignIn();
      if (!r.ok) { notice("Project not found."); return showList(); }
      D = r.data;
      renderProject();
    });
  }
  function notice(m) { banner = m; }
  function reload() { return openProject(D.project.id); }

  function renderProject() {
    var p = D.project;
    clear(app);
    document.title = p.brand + " | Studio";
    var copied = h("span", { class: "small muted", role: "status" });
    app.appendChild(h("div", { class: "row split" },
      h("button", { class: "btn small ghost", type: "button", onclick: function () { location.hash = ""; } }, "← All projects"),
      h("div", { class: "row" }, copied,
        h("button", { class: "btn small ghost", type: "button", onclick: function () { copy(p.clientLink, function (m) { copied.textContent = m; }); } }, "Copy client link"),
        h("button", { class: "btn small ghost", type: "button", onclick: function () {
          call("/admin/projects/" + p.id + "/reset-link", { method: "POST", json: {} }).then(function (r) { if (r.ok) { D.project.clientLink = r.data.clientLink; copied.textContent = "Old link disabled. New link ready to copy."; } });
        } }, "Reset link"))));
    app.appendChild(h("div", null, h("div", { class: "kicker" }, p.package.label + " package · " + p.email), h("h1", null, p.brand),
      h("div", { class: "row" }, h("span", { class: "chip gold" }, p.status.replace(/_/g, " ")), p.deliveryDate ? h("span", { class: "chip" }, "Wants delivery by " + p.deliveryDate) : null)));
    if (banner) { app.appendChild(note("", banner)); banner = ""; }
    app.appendChild(briefCard());
    if (["brief_received", "changes_requested", "script_review"].indexOf(p.status) >= 0) app.appendChild(editorCard());
    app.appendChild(productionCard());
    if (["approved", "in_production", "delivered"].indexOf(p.status) >= 0) app.appendChild(deliveryCard());
    app.appendChild(messagesCard());
    app.appendChild(dangerCard());
  }

  function briefCard() {
    var card = h("section", { class: "card" }, h("h2", null, "Brief"));
    card.appendChild(h("dl", { class: "kv" }, D.brief.map(function (r) { return [h("dt", null, r.label), h("dd", null, r.value)]; })));
    var assets = D.files.filter(function (f) { return f.area === "asset"; });
    card.appendChild(h("h3", null, "Client files (" + assets.length + ")"));
    card.appendChild(assets.length ? h("ul", { class: "files" }, assets.map(function (f) {
      return h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"), h("a", { class: "btn small ghost", href: API + "/admin/files/" + f.id, download: f.name }, "Download"));
    })) : h("p", { class: "muted" }, "None."));
    var out = h("span", { class: "small muted", role: "status" });
    card.appendChild(h("div", { class: "row" },
      h("button", { class: "btn small", type: "button", onclick: function () { copy(draftingKit(), function (m) { out.textContent = m + ". Paste it into Claude or ScriptForge."; }); } }, "Copy brief for drafting"), out));
    return card;
  }

  function draftingKit() {
    var rules = [
      "Write AI UGC hooks and a script for this client.",
      "Deliver: three hook options and one short script (15 to 45 seconds) based on the recommended hook.",
      "Script structure: Hook, Problem, Solution, Benefit, Call to action.",
      "Style: conversational, suited to short-form vertical video.",
      "Rules: no unsupported medical, financial, legal or exaggerated performance claims. Respect the required claims and restricted words below. Do not use em dashes anywhere.",
      "", "BRIEF", ""
    ];
    return rules.concat(D.brief.map(function (r) { return r.label + ": " + r.value; })).join("\n");
  }

  /* ---- hooks and script editor ---- */
  function editorCard() {
    var p = D.project;
    var last = D.proposals.filter(function (x) { return x.status === "draft"; }).pop() || D.proposals[D.proposals.length - 1] || null;
    draftId = last && last.status === "draft" ? last.id : null;
    var hooks = [0, 1, 2].map(function (i) { return h("textarea", { "aria-label": "Hook option " + (i + 1), rows: "2" }); });
    var rec = h("select", { "aria-label": "Recommended hook" }, [1, 2, 3].map(function (n) { return h("option", { value: String(n) }, "Hook option " + n); }));
    var parts = ["hook", "problem", "solution", "benefit", "cta"];
    var names = { hook: "Hook", problem: "Problem", solution: "Solution", benefit: "Benefit", cta: "Call to action" };
    var sc = {};
    parts.forEach(function (k) { sc[k] = h("textarea", { "aria-label": names[k], rows: "2" }); });
    if (last) { last.hooks.forEach(function (t, i) { hooks[i].value = t; }); rec.value = String(last.recommended); parts.forEach(function (k) { sc[k].value = last.script[k]; }); }
    var out = h("div", { role: "status", "aria-live": "polite" });
    var notify = h("input", { type: "checkbox" });
    var ack = false;

    function payload() {
      var script = {};
      parts.forEach(function (k) { script[k] = sc[k].value; });
      return { hooks: hooks.map(function (t) { return t.value; }), recommended: rec.value, script: script };
    }
    function show(kind, msg, warnings) {
      clear(out);
      out.appendChild(note(kind, msg + (warnings && warnings.length ? " Check these phrases: " + warnings.join(", ") + "." : "")));
    }
    function save() {
      var req = draftId
        ? call("/admin/proposals/" + draftId, { method: "PUT", json: payload() })
        : call("/admin/projects/" + p.id + "/proposals", { method: "POST", json: payload() });
      return req.then(function (r) {
        if (!r.ok) { show("err", r.data.message || "Could not save."); return false; }
        if (r.data.id) draftId = r.data.id;
        show("ok", "Draft saved.", r.data.warnings);
        return true;
      });
    }
    var latestChange = D.messages.filter(function (m) { return m.kind === "changes_request"; }).pop();
    var warnBox = h("div", null);
    var pubBtn = h("button", { class: "btn gold", type: "button", onclick: function () {
      save().then(function (ok) {
        if (!ok) return;
        call("/admin/proposals/" + draftId + "/publish", { method: "POST", json: { notify: notify.checked, ackWarnings: ack } }).then(function (r) {
          if (r.status === 409 && r.data.error === "warnings") {
            clear(warnBox);
            warnBox.appendChild(note("err", r.data.message));
            warnBox.appendChild(h("button", { class: "btn small ghost", type: "button", onclick: function () { ack = true; pubBtn.click(); } }, "Publish anyway"));
            return;
          }
          if (!r.ok) { show("err", r.data.message || "Could not publish."); return; }
          notice("Published to the client's dashboard.");
          reload();
        });
      });
    } }, "Publish to client");

    var card = h("section", { class: "card" }, h("h2", null, p.status === "script_review" ? "Hooks and script (published, you can replace it)" : "Hooks and script"));
    if (latestChange) card.appendChild(note("", "Client change request: " + latestChange.body));
    card.appendChild(h("p", { class: "small muted" }, D.intro));
    [0, 1, 2].forEach(function (i) { card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Hook option " + (i + 1)), hooks[i])); });
    card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Recommended hook for the script"), rec));
    parts.forEach(function (k) { card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Script: " + names[k]), sc[k])); });
    card.appendChild(h("p", { class: "small muted" }, "Dashes are cleaned automatically. Words like guarantee, cure or 100% are flagged before you publish."));
    card.appendChild(h("label", { class: "row" }, notify, h("span", null, "Notify client by email (a link only, no content)")));
    card.appendChild(h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", onclick: save }, "Save draft"), pubBtn));
    card.appendChild(warnBox);
    card.appendChild(out);
    var versions = D.proposals.filter(function (x) { return x.status !== "draft"; });
    if (versions.length) card.appendChild(h("p", { class: "small muted" }, "Versions sent so far: " + versions.map(function (v) { return "v" + v.version + " (" + v.status + ")"; }).join(", ")));
    return card;
  }

  /* ---- production ---- */
  function productionCard() {
    var p = D.project;
    var card = h("section", { class: "card" }, h("h2", null, "Approval and production"));
    var rows = [
      ["Approval", p.approvedAt ? "Hook " + p.approvedHook + " and the script approved on " + fmt(p.approvedAt) : "Not yet approved"],
      ["Concept change rounds", p.rounds.used + " used of " + p.rounds.allowed],
      ["Production", p.productionStartedAt ? "Started " + fmt(p.productionStartedAt) : p.productionLocked ? "Locked until the client approves one hook and one script" : "Ready to start"]
    ];
    card.appendChild(h("dl", { class: "kv" }, rows.map(function (r) { return [h("dt", null, r[0]), h("dd", null, r[1])]; })));
    var notify = h("input", { type: "checkbox" });
    var out = h("span", { class: "small muted", role: "status" });
    var start = h("button", { class: "btn gold", type: "button", disabled: p.status !== "approved", onclick: function () {
      call("/admin/projects/" + p.id + "/start-production", { method: "POST", json: { notify: notify.checked } }).then(function (r) { if (r.ok) { notice("Production started."); reload(); } else out.textContent = r.data.message; });
    } }, "Start production");
    var extra = h("button", { class: "btn small ghost", type: "button", disabled: ["brief_received", "changes_requested", "script_review"].indexOf(p.status) < 0, onclick: function () {
      call("/admin/projects/" + p.id + "/extra-round", { method: "POST", json: {} }).then(function (r) { if (r.ok) { notice("Extra concept round added."); reload(); } else out.textContent = r.data.message; });
    } }, "Add an extra concept round");
    card.appendChild(h("div", { class: "row" }, start, extra, h("label", { class: "row small" }, notify, "Notify client")));
    card.appendChild(out);
    return card;
  }

  /* ---- delivery ---- */
  function deliveryCard() {
    var p = D.project;
    var card = h("section", { class: "card" }, h("h2", null, "Delivery"));
    var files = D.files.filter(function (f) { return f.area === "delivery"; });
    var status = h("div", { role: "status", "aria-live": "polite" });
    card.appendChild(files.length ? h("ul", { class: "files" }, files.map(function (f) {
      return h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"), h("button", { class: "btn small ghost", type: "button", onclick: function () {
        call("/admin/files/" + f.id, { method: "DELETE" }).then(function () { reload(); });
      } }, "Remove"));
    })) : h("p", { class: "muted" }, "No delivery files yet."));
    if (p.status === "delivered") {
      card.appendChild(h("dl", { class: "kv" },
        h("dt", null, "Delivered"), h("dd", null, fmt(p.deliveredAt)), h("dt", null, "Videos"), h("dd", null, String(p.videos)),
        h("dt", null, "Revision window"), h("dd", null, "Until " + fmt(p.revisionUntil) + (p.revisionOpen ? " (open)" : " (closed)")),
        h("dt", null, "Revision rounds used"), h("dd", null, p.revisionsUsed + " of " + p.package.revisionRounds)));
      card.appendChild(h("button", { class: "btn small ghost", type: "button", onclick: function () {
        call("/admin/projects/" + p.id + "/extend-revisions", { method: "POST", json: { days: 3 } }).then(function (r) { if (r.ok) { notice("Revision window extended by 3 days."); reload(); } });
      } }, "Extend revision window by 3 days"));
      return card;
    }
    if (p.status !== "in_production") { card.appendChild(h("p", { class: "muted" }, "Start production first. Delivery opens once the project is in production.")); return card; }
    var input = h("input", { type: "file", multiple: true, "aria-label": "Upload delivery files" });
    input.addEventListener("change", function () {
      var list = Array.prototype.slice.call(input.files);
      var chain = Promise.resolve();
      list.forEach(function (f, i) {
        chain = chain.then(function () {
          status.textContent = "Uploading " + (i + 1) + " of " + list.length + ": " + f.name;
          return call("/admin/projects/" + p.id + "/files?name=" + encodeURIComponent(f.name), { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } }).then(function (r) {
            if (!r.ok) status.textContent = f.name + ": " + (r.data.message || "upload failed");
          });
        });
      });
      chain.then(function () { reload(); });
    });
    var videos = h("input", { type: "number", min: "1", max: "50", value: "1", "aria-label": "Number of videos delivered" });
    var link = h("input", { type: "text", placeholder: "https://... (optional, for files over 95 MB)", "aria-label": "Delivery link" });
    var nt = h("textarea", { rows: "2", placeholder: "Optional note for the client", "aria-label": "Delivery note" });
    var notify = h("input", { type: "checkbox" });
    card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Upload final videos, captions and usage details (95 MB each)"), input));
    card.appendChild(h("div", { class: "grid2" },
      h("div", { class: "field" }, h("span", { class: "lab" }, "Videos delivered"), videos),
      h("div", { class: "field" }, h("span", { class: "lab" }, "External delivery link"), link)));
    card.appendChild(nt);
    card.appendChild(h("label", { class: "row" }, notify, h("span", null, "Notify client by email (a link only)")));
    card.appendChild(h("button", { class: "btn gold", type: "button", onclick: function () {
      call("/admin/projects/" + p.id + "/deliver", { method: "POST", json: { videos: videos.value, link: link.value, note: nt.value, notify: notify.checked } }).then(function (r) {
        if (r.ok) { notice("Delivered. The 7 day revision window is open."); reload(); } else status.textContent = r.data.message || "Could not deliver.";
      });
    } }, "Deliver to client"));
    card.appendChild(status);
    return card;
  }

  /* ---- messages ---- */
  function messagesCard() {
    var thread = h("div", { class: "thread", role: "log" });
    D.messages.forEach(function (m) {
      var who = m.author === "client" ? D.project.contactName : m.author === "admin" ? "You" : "System";
      thread.appendChild(h("div", { class: "msg " + (m.author === "client" ? "admin" : m.author === "admin" ? "client" : "system") }, h("span", { class: "meta" }, who + " · " + fmt(m.at) + " · " + m.kind.replace(/_/g, " ")), m.body));
    });
    var ta = h("textarea", { rows: "3", "aria-label": "Reply to the client", placeholder: "Reply inside the dashboard" });
    var notify = h("input", { type: "checkbox" });
    var card = h("section", { class: "card" }, h("h2", null, "Messages"), thread, ta,
      h("label", { class: "row" }, notify, h("span", null, "Notify client by email (a link only)")),
      h("button", { class: "btn", type: "button", onclick: function () {
        if (!ta.value.trim()) return;
        call("/admin/projects/" + D.project.id + "/messages", { method: "POST", json: { text: ta.value, notify: notify.checked } }).then(function (r) { if (r.ok) reload(); });
      } }, "Send reply"));
    setTimeout(function () { thread.scrollTop = thread.scrollHeight; }, 0);
    return card;
  }

  /* ---- danger ---- */
  function dangerCard() {
    var p = D.project;
    var confirmInput = h("input", { type: "text", placeholder: "Type the brand name to enable", "aria-label": "Type the brand name to confirm erasing" });
    var del = h("button", { class: "btn danger", type: "button", disabled: true, onclick: function () {
      call("/admin/projects/" + p.id, { method: "DELETE" }).then(function (r) { if (r.ok) { location.hash = ""; } });
    } }, "Erase project and files");
    confirmInput.addEventListener("input", function () { del.disabled = confirmInput.value.trim() !== p.brand; });
    return h("section", { class: "card" }, h("h2", null, "Close or erase"),
      h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", disabled: p.status === "closed", onclick: function () {
        call("/admin/projects/" + p.id + "/close", { method: "POST", json: {} }).then(function () { reload(); });
      } }, "Close project")),
      h("p", { class: "small muted" }, "Erasing removes the brief, messages and every file for good. Use it when the retention period ends or a client asks."),
      confirmInput, del);
  }

  /* ------------------------------------------------ boot */
  function route() {
    var id = (location.hash || "").replace("#", "");
    if (/^pj_[a-z0-9]+$/.test(id)) openProject(id); else showList();
  }
  signOut.addEventListener("click", function () { call("/admin/logout", { method: "POST", json: {} }).then(showSignIn); });
  window.addEventListener("hashchange", route);
  call("/admin/me").then(function (r) { if (r.ok) route(); else showSignIn(); });
})();
