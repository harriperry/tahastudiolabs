/* The client panel: a standalone page served by social-hub itself, so no existing Growth
   Department file is touched. It reuses the Vault login (same cookie), draws everything with
   textContent (no HTML from the server or from users is ever injected), and is served with a
   strict Content Security Policy: no inline script, no inline style, no outside connections. */

export const PANEL_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-cache"
};

export const PANEL_HTML = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>TAHA Studio Labs, Social</title>
<link rel="stylesheet" href="/api/vault/social/panel.css"></head>
<body><div id="app"></div><script src="/api/vault/social/panel.js"></script></body></html>`;

export const PANEL_CSS = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#12141a;color:#e8e9ee;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
#app{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 10px;color:#e8a317}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px}
.card{background:#1b1e27;border:1px solid #2a2e3a;border-radius:10px;padding:16px;margin-bottom:14px}
.muted{color:#9aa0b0;font-size:13px}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}
button{background:#e8a317;color:#1a1300;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:#e8e9ee;border:1px solid #3a3f4f}
button:disabled{opacity:.5;cursor:default}
input,select,textarea{width:100%;background:#12141a;color:#e8e9ee;border:1px solid #3a3f4f;border-radius:8px;padding:8px;font:inherit}
textarea{min-height:110px;resize:vertical}label{display:block;margin:8px 0 3px;font-size:13px;color:#9aa0b0}
.badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;background:#2a2e3a}
.b-published{background:#1f4d33}.b-failed,.b-needs_check{background:#5a2323}.b-scheduled,.b-publishing{background:#4a3d12}
.note{border-left:3px solid #e8a317;padding:8px 12px;margin-bottom:14px;background:#1b1e27;border-radius:0 8px 8px 0}
.err{border-left-color:#e05a5a}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid #2a2e3a;font-size:14px;vertical-align:top}
`;

export const PANEL_JS = `(function () {
  "use strict";
  var BASE = "/api/vault/social";
  var T = {
    sv: {
      title: "Sociala medier", signin: "Logga in", signinText: "Du behöver logga in för att använda den här sidan.",
      consentH: "Godkännande", consentText: "Genom att godkänna ger du TAHA Studio Labs rätt att publicera de inlägg du själv har godkänt på dina anslutna konton, vid den tid du väljer. Vi lagrar åtkomstnycklarna krypterat och du kan koppla bort ett konto när som helst.",
      consentBtn: "Jag godkänner", accountsH: "Anslutna konton", none: "Inga konton anslutna ännu.", connect: "Anslut Facebook och Instagram",
      revoke: "Koppla bort", notEnabled: "Publicering är inte aktiverad för ditt konto ännu. Du kan förbereda inlägg, men inget publiceras förrän vi aktiverar det.",
      paused: "Publicering är pausad just nu.", composeH: "Nytt inlägg", account: "Konto", text: "Text", link: "Länk (valfritt, Facebook)",
      image: "Bild-URL (https, krävs för Instagram)", saveDraft: "Spara utkast", draftsH: "Utkast och godkända inlägg", approve: "Godkänn",
      schedule: "Schemalägg", when: "Tid", jobsH: "Schemalagda och publicerade", cancel: "Avbryt", platform: "Plattform", status: "Status", error: "Info",
      s_scheduled: "Schemalagd", s_publishing: "Publiceras", s_published: "Publicerad", s_failed: "Misslyckades", s_needs_check: "Kontrollera på plattformen", s_cancelled: "Avbruten",
      v_draft: "Utkast", v_approved: "Godkänd", connected: "Kontona är anslutna.", denied: "Anslutningen avbröts eller nekades.", deletion: "Din begäran om radering är mottagen.",
      saved: "Utkastet är sparat.", scheduledOk: "Inlägget är schemalagt.", failedGeneric: "Något gick fel. Försök igen.", adminH: "Administratör", clientId: "Klient-ID",
      load: "Visa", enable: "Aktivera", disable: "Stäng av", pause: "Pausa klient", resume: "Återuppta klient", pauseAll: "Pausa allt", resumeAll: "Återuppta allt", expired: "Måste anslutas igen",
      inboxH: "Inlägg att granska", inboxNone: "Inga nya inlägg att granska.", editHint: "Du kan ändra texten innan du godkänner. Ingenting publiceras förrän du godkänner.",
      approveSchedule: "Godkänn och schemalägg", requestChanges: "Begär ändringar", rejectBtn: "Avvisa", noteLabel: "Vad ska ändras?", noteReq: "Skriv vad som ska ändras.",
      expiresOn: "Går ut", earlier: "Tidigare förslag", suggestedTime: "Föreslagen tid (valfri)", approvedOk: "Godkänt och schemalagt.", changesOk: "Ändringarna är begärda.", rejectedOk: "Förslaget är avvisat.",
      p_pending: "Väntar", p_approved: "Godkänd", p_changes_requested: "Ändringar begärda", p_rejected: "Avvisad", p_expired: "Utgången", p_withdrawn: "Tillbakadragen",
      proposeH: "Skicka till klienten för godkännande", addToBatch: "Lägg till i paketet", sendBatch: "Skicka paketet", batchH: "Paket att skicka", sentOk: "Skickat till klienten.", withdraw: "Dra tillbaka", optional: "Konto (valfritt)", noClient: "Ladda en klient först."
    },
    en: {
      title: "Social media", signin: "Sign in", signinText: "You need to sign in to use this page.",
      consentH: "Consent", consentText: "By agreeing you let TAHA Studio Labs publish the posts you have approved yourself to your connected accounts, at the time you choose. Access keys are stored encrypted and you can disconnect an account at any time.",
      consentBtn: "I agree", accountsH: "Connected accounts", none: "No accounts connected yet.", connect: "Connect Facebook and Instagram",
      revoke: "Disconnect", notEnabled: "Publishing is not enabled for your account yet. You can prepare posts, but nothing is published until we enable it.",
      paused: "Publishing is paused right now.", composeH: "New post", account: "Account", text: "Text", link: "Link (optional, Facebook)",
      image: "Image URL (https, required for Instagram)", saveDraft: "Save draft", draftsH: "Drafts and approved posts", approve: "Approve",
      schedule: "Schedule", when: "Time", jobsH: "Scheduled and published", cancel: "Cancel", platform: "Platform", status: "Status", error: "Info",
      s_scheduled: "Scheduled", s_publishing: "Publishing", s_published: "Published", s_failed: "Failed", s_needs_check: "Check on the platform", s_cancelled: "Cancelled",
      v_draft: "Draft", v_approved: "Approved", connected: "Your accounts are connected.", denied: "The connection was cancelled or denied.", deletion: "Your deletion request was received.",
      saved: "Draft saved.", scheduledOk: "The post is scheduled.", failedGeneric: "Something went wrong. Please try again.", adminH: "Administrator", clientId: "Client ID",
      load: "Show", enable: "Enable", disable: "Disable", pause: "Pause client", resume: "Resume client", pauseAll: "Pause everything", resumeAll: "Resume everything", expired: "Needs to be reconnected",
      inboxH: "Posts to review", inboxNone: "No posts to review.", editHint: "You can edit the text before approving. Nothing is published until you approve.",
      approveSchedule: "Approve and schedule", requestChanges: "Request changes", rejectBtn: "Reject", noteLabel: "What should change?", noteReq: "Please write what should change.",
      expiresOn: "Expires", earlier: "Earlier proposals", suggestedTime: "Suggested time (optional)", approvedOk: "Approved and scheduled.", changesOk: "Changes requested.", rejectedOk: "Proposal rejected.",
      p_pending: "Waiting", p_approved: "Approved", p_changes_requested: "Changes requested", p_rejected: "Rejected", p_expired: "Expired", p_withdrawn: "Withdrawn",
      proposeH: "Send to the client for approval", addToBatch: "Add to the batch", sendBatch: "Send the batch", batchH: "Batch to send", sentOk: "Sent to the client.", withdraw: "Withdraw", optional: "Account (optional)", noClient: "Load a client first."
    }
  };
  var lang = "sv";
  try { lang = localStorage.getItem("social_lang") || (navigator.language || "sv").slice(0, 2) === "en" ? "en" : "sv"; } catch (e) {}
  var S = { data: null, clientId: "", notice: null, batch: [] };
  var app = document.getElementById("app");
  function t(k) { return (T[lang] && T[lang][k]) || k; }
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function api(method, path, body) {
    return fetch(BASE + path, { method: method, credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; }); });
  }
  function load() {
    var q = S.clientId ? "?clientId=" + encodeURIComponent(S.clientId) : "";
    return api("GET", "/status" + q).then(function (r) { S.status = r.status; S.data = r.status === 200 ? r.data : null; render(); });
  }
  function act(method, path, body, okKey) {
    return api(method, path, body).then(function (r) {
      S.notice = r.status >= 200 && r.status < 300 ? { ok: true, text: t(okKey || "saved") } : { ok: false, text: t("failedGeneric") + (r.data && r.data.error ? " (" + r.data.error + ")" : "") };
      return load();
    });
  }
  function withClient(body) { if (S.clientId) body.clientId = S.clientId; return body; }
  function render() {
    app.textContent = "";
    var d = S.data;
    var top = el("div", { class: "top" }, [el("h1", { text: "TAHA Studio Labs, " + t("title") }),
      el("button", { class: "ghost", text: lang === "sv" ? "EN" : "SV", onclick: function () { lang = lang === "sv" ? "en" : "sv"; try { localStorage.setItem("social_lang", lang); } catch (e) {} render(); } })]);
    app.appendChild(top);
    if (S.notice) app.appendChild(el("div", { class: "note" + (S.notice.ok ? "" : " err"), text: S.notice.text }));
    if (!d) {
      if (S.status === 401) {
        app.appendChild(el("div", { class: "card" }, [el("p", { text: t("signinText") }), el("a", { href: "/grow/" }, [el("button", { text: t("signin") })])]));
      }
      if (S.status === 400 || S.status === 200 || !S.status) {}
      if (S.status === 400) app.appendChild(adminCard());
      return;
    }
    if (d.role === "admin") app.appendChild(adminCard());
    if (!d.consented) {
      app.appendChild(el("div", { class: "card" }, [el("h2", { text: t("consentH") }), el("p", { text: t("consentText") }),
        el("button", { text: t("consentBtn"), onclick: function () { act("POST", "/consent", withClient({}), "saved"); } })]));
    }
    if (!d.switches.enabled) app.appendChild(el("div", { class: "note", text: t("notEnabled") }));
    else if (d.switches.globalPaused || d.switches.clientPaused) app.appendChild(el("div", { class: "note", text: t("paused") }));
    app.appendChild(accountsCard(d));
    if (d.role === "client") app.appendChild(inboxCard(d));
    if (d.role === "admin") { app.appendChild(proposeCard(d)); app.appendChild(proposalHistoryCard(d)); }
    if (d.consented) { app.appendChild(composeCard(d)); app.appendChild(draftsCard(d)); }
    app.appendChild(jobsCard(d));
  }
  function adminCard() {
    var inp = el("input", { value: S.clientId, placeholder: t("clientId") });
    var row = function (labels) { return el("div", { class: "row" }, labels); };
    var flag = function (body) { return function () { S.clientId = inp.value.trim(); api("POST", "/admin/client", Object.assign({ clientId: S.clientId }, body)).then(function () { S.notice = { ok: true, text: t("saved") }; load(); }); }; };
    return el("div", { class: "card" }, [el("h2", { text: t("adminH") }), el("label", { text: t("clientId") }), inp,
      row([el("button", { text: t("load"), onclick: function () { S.clientId = inp.value.trim(); load(); } }),
        el("button", { class: "ghost", text: t("enable"), onclick: flag({ enabled: true }) }), el("button", { class: "ghost", text: t("disable"), onclick: flag({ enabled: false }) }),
        el("button", { class: "ghost", text: t("pause"), onclick: flag({ paused: true }) }), el("button", { class: "ghost", text: t("resume"), onclick: flag({ paused: false }) })]),
      row([el("button", { class: "ghost", text: t("pauseAll"), onclick: function () { act("POST", "/admin/pause", { paused: true }); } }),
        el("button", { class: "ghost", text: t("resumeAll"), onclick: function () { act("POST", "/admin/pause", { paused: false }); } })])]);
  }
  function accountsCard(d) {
    var kids = [el("h2", { text: t("accountsH") })];
    if (!d.accounts.length) kids.push(el("p", { class: "muted", text: t("none") }));
    d.accounts.forEach(function (a) {
      kids.push(el("div", { class: "row" }, [el("span", { text: a.platform + ": " + a.display_name }),
        a.status !== "active" ? el("span", { class: "badge", text: a.status === "expired" ? t("expired") : a.status }) : null,
        a.status === "active" ? el("button", { class: "ghost", text: t("revoke"), onclick: function () { act("POST", "/accounts/revoke", withClient({ accountId: a.id }), "saved"); } }) : null]));
    });
    if (d.consented && d.role === "client") kids.push(el("button", { text: t("connect"), onclick: function () {
      api("POST", "/oauth/start", { platform: "meta" }).then(function (r) { if (r.data && r.data.url) window.location.href = r.data.url; else { S.notice = { ok: false, text: t("failedGeneric") }; render(); } });
    } }));
    return el("div", { class: "card" }, kids);
  }
  function localInput(ms) {
    var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function inboxCard(d) {
    var list = d.proposals || [];
    var pending = list.filter(function (p) { return p.status === "pending"; });
    var kids = [el("h2", { text: t("inboxH") })];
    if (!pending.length) kids.push(el("p", { class: "muted", text: t("inboxNone") }));
    else kids.push(el("p", { class: "muted", text: t("editHint") }));
    pending.forEach(function (p) {
      var body = el("textarea", { maxlength: "5000" });
      body.value = p.body;
      var sel = accountSelect(d, p.platform);
      if (p.account_id) sel.value = p.account_id;
      var when = el("input", { type: "datetime-local" });
      if (p.suggested_run_at) when.value = localInput(p.suggested_run_at);
      var note = el("input", { placeholder: t("noteLabel"), maxlength: "1000" });
      var card = el("div", { class: "card" }, [
        el("div", { class: "muted", text: p.platform + " | " + t("expiresOn") + " " + new Date(p.expires_at).toLocaleDateString() }),
        p.media_url ? el("div", { class: "muted", text: p.media_url }) : null,
        p.link_url ? el("div", { class: "muted", text: p.link_url }) : null,
        body,
        el("div", { class: "row" }, [sel, when]),
        el("div", { class: "row" }, [
          el("button", { text: t("approveSchedule"), onclick: function () {
            var ms = Date.parse(when.value);
            if (!sel.value || !isFinite(ms)) { S.notice = { ok: false, text: t("failedGeneric") }; render(); return; }
            act("POST", "/proposals/decide", { proposalId: p.id, action: "approve", body: body.value, accountId: sel.value, runAt: ms }, "approvedOk");
          } })
        ]),
        el("div", { class: "row" }, [note,
          el("button", { class: "ghost", text: t("requestChanges"), onclick: function () {
            if (!note.value.trim()) { S.notice = { ok: false, text: t("noteReq") }; render(); return; }
            act("POST", "/proposals/decide", { proposalId: p.id, action: "changes", note: note.value }, "changesOk");
          } }),
          el("button", { class: "ghost", text: t("rejectBtn"), onclick: function () {
            act("POST", "/proposals/decide", { proposalId: p.id, action: "reject", note: note.value }, "rejectedOk");
          } })
        ])
      ]);
      kids.push(card);
    });
    var done = list.filter(function (p) { return p.status !== "pending"; }).slice(0, 10);
    if (done.length) {
      kids.push(el("h2", { text: t("earlier") }));
      done.forEach(function (p) {
        kids.push(el("div", { class: "row" }, [el("span", { class: "badge", text: t("p_" + p.status) }), el("span", { class: "muted", text: p.platform + ": " + p.body.slice(0, 80) })]));
      });
    }
    return el("div", { class: "card" }, kids);
  }
  function proposalHistoryCard(d) {
    var kids = [el("h2", { text: t("earlier") })];
    (d.proposals || []).forEach(function (p) {
      var row = [el("span", { class: "badge", text: t("p_" + p.status) }), el("span", { class: "muted", text: p.platform + ": " + p.body.slice(0, 80) + (p.decision_note ? " | " + p.decision_note : "") })];
      if (p.status === "pending") row.push(el("button", { class: "ghost", text: t("withdraw"), onclick: function () { act("POST", "/proposals/withdraw", withClient({ proposalId: p.id }), "saved"); } }));
      kids.push(el("div", { class: "row" }, row));
    });
    return el("div", { class: "card" }, kids);
  }
  function proposeCard(d) {
    if (!S.clientId) return el("div", { class: "card" }, [el("h2", { text: t("proposeH") }), el("p", { class: "muted", text: t("noClient") })]);
    var plat = el("select");
    ["facebook", "instagram"].forEach(function (x) { plat.appendChild(el("option", { value: x, text: x })); });
    var acc = el("select");
    acc.appendChild(el("option", { value: "", text: t("optional") }));
    d.accounts.filter(function (a) { return a.status === "active"; }).forEach(function (a) { acc.appendChild(el("option", { value: a.id, text: a.platform + ": " + a.display_name })); });
    var body = el("textarea", { maxlength: "5000" }), link = el("input", { placeholder: "https://" }), img = el("input", { placeholder: "https://" }), when = el("input", { type: "datetime-local" });
    var kids = [el("h2", { text: t("proposeH") }), el("label", { text: t("platform") }), plat, el("label", { text: t("text") }), body,
      el("label", { text: t("link") }), link, el("label", { text: t("image") }), img, el("label", { text: t("optional") }), acc, el("label", { text: t("suggestedTime") }), when,
      el("div", { class: "row" }, [el("button", { class: "ghost", text: t("addToBatch"), onclick: function () {
        if (!body.value.trim()) return;
        var item = { platform: plat.value, body: body.value };
        if (link.value.trim()) item.linkUrl = link.value.trim();
        if (img.value.trim()) item.mediaUrl = img.value.trim();
        if (acc.value) item.accountId = acc.value;
        var ms = Date.parse(when.value);
        if (isFinite(ms)) item.suggestedRunAt = ms;
        S.batch.push(item);
        render();
      } })])];
    if (S.batch.length) {
      kids.push(el("h2", { text: t("batchH") + " (" + S.batch.length + ")" }));
      S.batch.forEach(function (it) { kids.push(el("div", { class: "muted", text: it.platform + ": " + it.body.slice(0, 80) })); });
      kids.push(el("div", { class: "row" }, [el("button", { text: t("sendBatch"), onclick: function () {
        var items = S.batch.slice();
        api("POST", "/proposals", withClient({ items: items })).then(function (r) {
          if (r.status === 200) { S.batch = []; S.notice = { ok: true, text: t("sentOk") }; }
          else S.notice = { ok: false, text: t("failedGeneric") + (r.data && r.data.error ? " (" + r.data.error + ")" : "") };
          return load();
        });
      } })]));
    }
    return el("div", { class: "card" }, kids);
  }
  function accountSelect(d, platform) {
    var sel = el("select");
    d.accounts.filter(function (a) { return a.status === "active" && (!platform || a.platform === platform); }).forEach(function (a) { sel.appendChild(el("option", { value: a.id, text: a.platform + ": " + a.display_name })); });
    return sel;
  }
  function composeCard(d) {
    var sel = accountSelect(d), body = el("textarea", { maxlength: "5000" }), link = el("input", { placeholder: "https://" }), img = el("input", { placeholder: "https://" });
    var byId = {}; d.accounts.forEach(function (a) { byId[a.id] = a; });
    return el("div", { class: "card" }, [el("h2", { text: t("composeH") }), el("label", { text: t("account") }), sel, el("label", { text: t("text") }), body,
      el("label", { text: t("link") }), link, el("label", { text: t("image") }), img,
      el("div", { class: "row" }, [el("button", { text: t("saveDraft"), onclick: function () {
        var a = byId[sel.value]; if (!a) return;
        var payload = withClient({ platform: a.platform, body: body.value });
        if (link.value.trim()) payload.linkUrl = link.value.trim();
        if (img.value.trim()) payload.mediaUrl = img.value.trim();
        act("POST", "/versions", payload, "saved");
      } })])]);
  }
  function draftsCard(d) {
    var kids = [el("h2", { text: t("draftsH") })];
    (d.versions || []).filter(function (v) { return v.status !== "withdrawn"; }).forEach(function (v) {
      var line = el("div", { class: "card" }, [el("div", { class: "muted", text: v.platform + " | " + (v.status === "approved" ? t("v_approved") : t("v_draft")) }), el("div", { text: v.body })]);
      if (v.status === "draft" && d.role === "client") line.appendChild(el("div", { class: "row" }, [el("button", { text: t("approve"), onclick: function () { act("POST", "/versions/approve", { versionId: v.id }, "saved"); } })]));
      if (v.status === "approved") {
        var sel = accountSelect(d, v.platform), when = el("input", { type: "datetime-local" });
        line.appendChild(el("div", { class: "row" }, [sel, when, el("button", { text: t("schedule"), onclick: function () {
          var ms = Date.parse(when.value); if (!sel.value || !isFinite(ms)) return;
          act("POST", "/jobs", withClient({ accountId: sel.value, versionId: v.id, runAt: ms }), "scheduledOk");
        } })]));
      }
      kids.push(line);
    });
    return el("div", { class: "card" }, kids);
  }
  function jobsCard(d) {
    var tbl = el("table");
    tbl.appendChild(el("tr", null, [el("th", { text: t("platform") }), el("th", { text: t("when") }), el("th", { text: t("status") }), el("th", { text: t("error") }), el("th")]));
    (d.jobs || []).forEach(function (j) {
      tbl.appendChild(el("tr", null, [el("td", { text: j.platform }), el("td", { text: new Date(j.run_at).toLocaleString() }),
        el("td", null, [el("span", { class: "badge b-" + j.status, text: t("s_" + j.status) })]), el("td", { class: "muted", text: j.last_error || "" }),
        el("td", null, [j.status === "scheduled" ? el("button", { class: "ghost", text: t("cancel"), onclick: function () { act("POST", "/jobs/cancel", withClient({ jobId: j.id }), "saved"); } }) : null])]));
    });
    return el("div", { class: "card" }, [el("h2", { text: t("jobsH") }), tbl]);
  }
  var qs = new URLSearchParams(window.location.search);
  if (qs.get("connected")) S.notice = { ok: true, text: t("connected") };
  else if (qs.get("error")) S.notice = { ok: false, text: t("denied") };
  else if (qs.get("deletion")) S.notice = { ok: true, text: t("deletion") };
  load();
})();`;
