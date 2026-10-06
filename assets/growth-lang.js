/* ScriptForge Growth Clients panel: Swedish language review (TAHA Growth Department V2, Part H).
   Loaded by growth-campaign.js, admin only.

   Team: invite a language reviewer, tick the clients they work on, record the signed
   confidentiality and data processing agreement (the invite only works after that), resend
   the invite, deactivate.
   Language review box on each saved campaign: Send to language review (all Swedish fields,
   with a note and a due date), Always review Swedish for the client, every item with machine
   and reviewed text side by side, changes highlighted word by word, and Accept, Edit and
   approve, Send back or Keep machine text. Accept all once everything is Done. Language
   notes saved here go into the next Campaign Generator prompt as {{LANGUAGE_NOTES}}.
   Production (the landing page, Send to ScriptForge, client review, delivery) uses the
   approved text: approved() gives the map, and applyApproved() in growth-langfields.js puts
   it in place. */
import { applyApproved, wordDiff } from "./growth-langfields.js?v=h";

const STATE = {
  waiting: ["In review", "warn"],
  sent_back: ["Sent back", "warn"],
  flagged: ["Flagged", "err"],
  done: ["Reviewed", "info"],
  approved: ["Approved", "ok"],
  kept: ["Machine kept", "ok"],
  outdated: ["Outdated", "err"]
};

export function createLangUi(ctx) {
  const { h, api } = ctx;
  const when = ctx.when || ((x) => x || "");
  const st = {};
  const notes = {};
  let team = { loaded: false, loading: false, members: [], msg: null, form: false };

  const key = (c, cp) => c + "/" + cp;
  function entry(clientId, campaignId) {
    const k = key(clientId, campaignId);
    if (!st[k]) st[k] = { loaded: false, loading: false, data: null, open: false, busy: false, msg: null, act: {}, filter: "todo" };
    return st[k];
  }

  function load(clientId, campaignId, force) {
    const s = entry(clientId, campaignId);
    if ((s.loaded && !force) || s.loading) return s;
    s.loading = true;
    api("/admin/lang/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId)).then((r) => {
      s.loading = false;
      s.loaded = true;
      s.data = r.ok && r.d ? r.d : null;
      ctx.rerender(clientId);
    });
    loadNotes(clientId);
    return s;
  }

  function loadNotes(clientId, force) {
    const n = notes[clientId] || (notes[clientId] = { loaded: false, loading: false, list: [] });
    if ((n.loaded && !force) || n.loading) return n;
    n.loading = true;
    api("/admin/lang/notes/" + encodeURIComponent(clientId)).then((r) => {
      n.loading = false;
      n.loaded = true;
      n.list = r.ok && r.d ? r.d.notes : [];
    });
    return n;
  }

  /* For the Campaign Generator prompt. */
  function notesText(clientId) {
    const n = loadNotes(clientId);
    if (!n.list.length) return "None yet.";
    return n.list.map((x) => "- Write \"" + x.preferred + "\"" + (x.reason ? " (" + x.reason + ")" : "")).join("\n");
  }

  /* The approved map and gate for a campaign, once loaded (null before). */
  function approved(clientId, campaignId) {
    const s = load(clientId, campaignId);
    return s.data ? s.data.approved : null;
  }
  function gate(clientId, campaignId) {
    const s = load(clientId, campaignId);
    return s.data ? s.data.gate : null;
  }
  function productionDoc(clientId, campaignId, doc) {
    const a = approved(clientId, campaignId);
    return a ? applyApproved(doc, a) : doc;
  }

  /* Send to ScriptForge waits while the Swedish video script is not approved. */
  function videoBlocked(clientId, campaignId) {
    const s = entry(clientId, campaignId);
    if (!s.data || !s.data.gate.required) return false;
    const it = s.data.items.find((i) => i.outputKey === "shortVideo");
    return !it || !(it.state === "approved" || it.state === "kept");
  }

  /* A badge for an output card: how its Swedish texts stand. */
  function cardBadge(clientId, campaignId, cardKey) {
    const s = entry(clientId, campaignId);
    if (!s.data || !s.data.items.length) return null;
    const items = s.data.items.filter((i) => i.outputKey === cardKey || i.outputKey.startsWith(cardKey + "."));
    if (!items.length) return null;
    const ok = items.filter((i) => i.state === "approved" || i.state === "kept").length;
    const bad = items.filter((i) => i.state === "outdated" || i.state === "flagged").length;
    const text = "Swedish: " + (ok === items.length ? "Approved" : ok + " of " + items.length + " approved" + (bad ? ", " + bad + " need you" : ""));
    return h("span", { class: "gc-badge " + (ok === items.length ? "ok" : bad ? "err" : "warn"), text });
  }

  async function act(info, item, body) {
    const s = entry(info.client.id, info.campaignId);
    s.busy = true;
    ctx.rerender(info.client.id);
    const r = await api("/admin/lang/item/" + encodeURIComponent(item.id), { method: "POST", body });
    s.busy = false;
    if (r.ok && r.d) {
      const i = s.data.items.findIndex((x) => x.id === item.id);
      if (i > -1) s.data.items[i] = r.d.item;
      s.act[item.id] = null;
      s.msg = null;
      load(info.client.id, info.campaignId, true);
    } else {
      s.msg = { cls: "err", text: ((r.d && r.d.message && r.d.message.en) || "Could not save.") + (r.d && r.d.problems ? " " + r.d.problems.map((p) => p.en).join(" ") : "") };
      ctx.rerender(info.client.id);
    }
  }

  async function send(info, body) {
    const s = entry(info.client.id, info.campaignId);
    s.busy = true;
    s.msg = null;
    ctx.rerender(info.client.id);
    const r = await api("/admin/lang/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId) + "/send", { method: "POST", body });
    s.busy = false;
    if (r.ok && r.d) {
      s.data = r.d;
      const x = r.d.sent;
      s.msg = { cls: x.member ? "ok" : "err", text: (x.created + x.requeued) + " texts sent" + (x.member ? " to " + x.member.name + "." : ". No reviewer is assigned to this client yet: add one under Team.") + (x.created + x.requeued === 0 ? " Nothing new to send." : "") };
    } else s.msg = { cls: "err", text: (r.d && r.d.message && r.d.message.en) || "Could not send." };
    ctx.rerender(info.client.id);
  }

  async function acceptAll(info) {
    const s = entry(info.client.id, info.campaignId);
    const r = await api("/admin/lang/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId) + "/accept-all", { method: "POST", body: {} });
    if (r.ok && r.d) { s.data = r.d; s.msg = { cls: "ok", text: "Every reviewed text is approved." }; }
    else s.msg = { cls: "err", text: (r.d && r.d.message && r.d.message.en) || "Could not accept." };
    ctx.rerender(info.client.id);
  }

  async function setAlways(info, on) {
    const s = entry(info.client.id, info.campaignId);
    await api("/admin/lang/setting/" + encodeURIComponent(info.client.id), { method: "PUT", body: { review: on } });
    load(info.client.id, info.campaignId, true);
    void s;
  }

  async function saveNote(info, item, preferred, reason) {
    await api("/admin/lang/notes/" + encodeURIComponent(info.client.id), { method: "POST", body: { preferred, reason, fromItem: item ? item.id : undefined } });
    loadNotes(info.client.id, true);
    const s = entry(info.client.id, info.campaignId);
    s.msg = { cls: "ok", text: "Language note saved. The next campaign for this client will use it." };
    ctx.rerender(info.client.id);
  }

  function diffView(a, b) {
    const box = h("div", { class: "lg-diff" });
    wordDiff(a, b).forEach((d) => box.appendChild(h(d.op === "same" ? "span" : d.op === "add" ? "ins" : "del", { text: d.text })));
    return box;
  }

  function inputRow(id, label, value, attrs) {
    const el = h(attrs && attrs.textarea ? "textarea" : "input", Object.assign({ id, type: attrs && attrs.type ? attrs.type : "text" }, attrs && attrs.textarea ? { class: "gc-ta", rows: "4" } : {}));
    el.value = value || "";
    return { el, row: h("div", { class: "gc-ed" }, h("label", { for: id, text: label }), el) };
  }

  function itemView(info, it) {
    const s = entry(info.client.id, info.campaignId);
    const [label, cls] = STATE[it.state] || [it.state, ""];
    const row = h("div", { class: "lg-item" });
    row.appendChild(h("div", { class: "lg-item-h" }, h("b", { text: it.label }), h("span", { class: "gc-badge " + cls, text: label + (it.round > 1 ? " · round " + it.round : "") })));
    if (it.flagComment && (it.state === "flagged" || it.state === "sent_back")) row.appendChild(h("div", { class: "gc-msg " + (it.state === "flagged" ? "err" : "info"), text: (it.state === "flagged" ? "Reviewer flagged: " : "You sent it back: ") + it.flagComment }));
    if (it.reviewerNote) row.appendChild(h("div", { class: "gc-meta", text: "Reviewer's note: " + it.reviewerNote }));
    const shown = it.reviewed != null ? it.reviewed : it.approved;
    if (shown != null && shown !== it.machine) {
      row.appendChild(h("div", { class: "lg-cols" },
        h("div", null, h("div", { class: "gc-label", text: "Machine" }), h("p", { class: "lg-text", text: it.machine })),
        h("div", null, h("div", { class: "gc-label", text: (it.reviewed != null ? "Reviewed by " + String(it.reviewedBy || "").replace(/\s*<.*$/, "") : "Approved") + " · changes" }), diffView(it.machine, shown))));
    } else row.appendChild(h("p", { class: "lg-text", text: it.machine }));
    const a = s.act[it.id];
    const tools = h("div", { class: "gc-card-actions" });
    const btn = (text, fn, primary) => tools.appendChild(h("button", { type: "button", class: primary ? "btn-copy" : "gc-link", disabled: s.busy, on: { click: fn } }, text));
    if (it.state === "done") btn("Accept", () => act(info, it, { action: "accept" }), true);
    if (["done", "flagged", "waiting", "sent_back"].includes(it.state)) btn("Edit and approve", () => { s.act[it.id] = { kind: "approve" }; ctx.rerender(info.client.id); });
    if (["done", "flagged"].includes(it.state)) btn("Send back", () => { s.act[it.id] = { kind: "send_back" }; ctx.rerender(info.client.id); });
    if (it.state !== "outdated" && it.state !== "approved" && it.state !== "kept") btn("Keep machine text", () => { s.act[it.id] = { kind: "keep" }; ctx.rerender(info.client.id); });
    if (it.state === "outdated") btn("Send the new text for review", () => send(info, { paths: [it.path] }), true);
    if (it.reviewed != null && it.reviewed !== it.machine) btn("Save as language note", () => { s.act[it.id] = { kind: "note" }; ctx.rerender(info.client.id); });
    row.appendChild(tools);
    if (a) {
      const idp = "lg-" + it.id;
      if (a.kind === "approve") {
        const f = inputRow(idp, "Approved text", it.reviewed != null ? it.reviewed : it.machine, { textarea: true });
        row.appendChild(f.row);
        row.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => act(info, it, { action: "approve", text: f.el.value }) } }, "Approve this text"));
      } else if (a.kind === "send_back") {
        const f = inputRow(idp, "What should the reviewer look at again?", "");
        row.appendChild(f.row);
        row.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => act(info, it, { action: "send_back", comment: f.el.value }) } }, "Send back"));
      } else if (a.kind === "keep") {
        const f = inputRow(idp, "Reason to keep the machine text (logged)", "");
        row.appendChild(f.row);
        row.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => act(info, it, { action: "keep", reason: f.el.value }) } }, "Keep machine text"));
      } else if (a.kind === "note") {
        const f1 = inputRow(idp + "-p", "Preferred word or phrasing", "");
        const f2 = inputRow(idp + "-r", "Short reason", "");
        row.appendChild(f1.row);
        row.appendChild(f2.row);
        row.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => { if (f1.el.value.trim()) { s.act[it.id] = null; saveNote(info, it, f1.el.value.trim(), f2.el.value.trim()); } } } }, "Save note"));
      }
      row.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { s.act[it.id] = null; ctx.rerender(info.client.id); } } }, "Cancel"));
    }
    return row;
  }

  function renderBox(pane, info) {
    const { client, campaignId, doc, dirty } = info;
    const s = load(client.id, campaignId);
    if (!s.data) return;
    const d = s.data;
    if (!d.swedish && !d.items.length) return;
    const box = h("div", { class: "gc-box lg-box" });
    const g = d.gate;
    const okN = d.items.filter((i) => i.state === "approved" || i.state === "kept").length;
    const doneN = d.items.filter((i) => ["done", "approved", "kept"].includes(i.state)).length;
    const headText = !d.items.length ? "Not sent yet" : g.pending === 0 ? "Language review complete (" + okN + " of " + d.items.length + ")" : "Language review done (" + doneN + " of " + d.items.length + "), " + okN + " approved";
    box.appendChild(h("div", { class: "gc-bh" }, "Language review (Swedish)", h("span", { class: "gc-badge " + (g.pending === 0 && d.items.length ? "ok" : "warn"), text: headText })));
    box.appendChild(h("div", { class: "gc-meta", text: (d.reviewer ? "Reviewer: " + d.reviewer.name + "." : "No reviewer assigned to this client: add one under Team.") + (g.required && g.pending ? " Until every text is approved, the landing page, client review, delivery and Send to ScriptForge wait (or ask you for a reason)." : "") }));
    const always = h("input", { type: "checkbox", id: "lg-always-" + client.id });
    always.checked = d.alwaysReview;
    always.addEventListener("change", () => setAlways(info, always.checked));
    box.appendChild(h("label", { for: "lg-always-" + client.id, class: "lp-tick" }, always, h("span", { text: "Always review Swedish for this client (Swedish campaigns with a Visual Pack are sent automatically when saved)" })));
    /* Send */
    const noteF = inputRow("lg-note-" + campaignId, "Note to the reviewer (optional)", "");
    const dueF = inputRow("lg-due-" + campaignId, "Due date (optional)", "", { type: "date" });
    const sendRow = h("div", { class: "lp-grid" }, noteF.row, dueF.row);
    box.appendChild(sendRow);
    const tools = h("div", { class: "gc-brain-tools" });
    tools.appendChild(h("button", { type: "button", class: d.items.length ? "btn-ghost" : "gc-brain-btn", disabled: s.busy || dirty, title: dirty ? "Save your changes first" : "", on: { click: () => send(info, { note: noteF.el.value.trim() || undefined, due: dueF.el.value || undefined }) } }, d.items.length ? "Send changed texts again" : "Send to language review"));
    const canAll = d.items.length && d.items.every((i) => ["done", "approved", "kept"].includes(i.state)) && d.items.some((i) => i.state === "done");
    if (canAll) tools.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => acceptAll(info) } }, "Accept all"));
    if (d.items.length) tools.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { s.open = !s.open; ctx.rerender(client.id); } } }, s.open ? "Hide texts" : "Show texts (" + d.items.length + ")"));
    box.appendChild(tools);
    if (s.msg) box.appendChild(h("div", { class: "gc-msg " + s.msg.cls, role: "status", text: s.msg.text }));
    if (s.open && d.items.length) {
      const f = h("div", { class: "gc-brain-tools" });
      [["todo", "Needs you"], ["all", "All"]].forEach((x) => f.appendChild(h("button", { type: "button", class: s.filter === x[0] ? "btn-copy" : "gc-link", on: { click: () => { s.filter = x[0]; ctx.rerender(client.id); } } }, x[1])));
      box.appendChild(f);
      const list = s.filter === "todo" ? d.items.filter((i) => ["done", "flagged", "outdated"].includes(i.state)) : d.items;
      if (!list.length) box.appendChild(h("div", { class: "gc-meta", text: "Nothing needs you right now." }));
      list.forEach((it) => box.appendChild(itemView(info, it)));
    }
    const n = loadNotes(client.id);
    if (n.list.length) {
      box.appendChild(h("div", { class: "gc-label", text: "Language notes for this client (" + n.list.length + ")" }));
      n.list.slice(0, 8).forEach((x) => box.appendChild(h("div", { class: "gc-meta", text: "“" + x.preferred + "”" + (x.reason ? ": " + x.reason : "") })));
    }
    void doc;
    pane.appendChild(box);
  }

  /* ---------- Team ---------- */

  function loadTeam(force) {
    if ((team.loaded && !force) || team.loading) return;
    team.loading = true;
    api("/admin/team").then((r) => {
      team.loading = false;
      team.loaded = true;
      team.members = r.ok && r.d ? r.d.members : [];
      ctx.rerenderTeam();
    });
  }

  async function teamCall(path, method, body, okText) {
    const r = await api(path, { method, body });
    team.msg = r.ok ? { cls: "ok", text: okText(r.d) } : { cls: "err", text: (r.d && r.d.message && r.d.message.en) || "Could not save." };
    loadTeam(true);
    ctx.rerenderTeam();
  }

  function renderTeam(pane, clients) {
    loadTeam();
    pane.appendChild(h("div", { class: "gc-title" }, h("div", null, h("h3", { text: "Team" }), h("div", { class: "gc-sub", text: "Swedish language reviewers. They sign in at /grow/review/ and see only the texts you send, for the clients you tick." }))));
    if (team.msg) pane.appendChild(h("div", { class: "gc-msg " + team.msg.cls, role: "status", text: team.msg.text }));
    const clientTicks = (prefix, chosen) => {
      const box = h("div", { class: "lg-ticks" });
      const inputs = [];
      clients.forEach((c) => {
        const id = prefix + c.id;
        const el = h("input", { type: "checkbox", id });
        el.checked = chosen.includes(c.id);
        el.dataset.client = c.id;
        inputs.push(el);
        box.appendChild(h("label", { for: id, class: "lp-tick" }, el, h("span", { text: c.name })));
      });
      return { box, value: () => inputs.filter((x) => x.checked).map((x) => x.dataset.client) };
    };
    /* Invite */
    const inv = h("div", { class: "gc-box" }, h("div", { class: "gc-bh" }, "Invite a reviewer"));
    const n = inputRow("tm-new-name", "Name", "");
    const e = inputRow("tm-new-email", "Email", "", { type: "email" });
    const a = inputRow("tm-new-agree", "Agreement signed on (the invite goes out only with this date)", "", { type: "date" });
    const ticks = clientTicks("tm-new-c-", []);
    inv.appendChild(h("div", { class: "lp-grid" }, n.row, e.row, a.row));
    inv.appendChild(h("div", { class: "gc-label", text: "Clients they work on" }));
    inv.appendChild(ticks.box);
    inv.appendChild(h("div", { class: "gc-meta", text: "Before the first sign-in they sign a confidentiality and data processing agreement with TAHA Studio Labs (an underbiträdesavtal if they invoice through their own company)." }));
    inv.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => teamCall("/admin/team/invite", "POST", { name: n.el.value, email: e.el.value, agreementAt: a.el.value || null, languages: ["sv"], clients: ticks.value() }, (d) => d.invited ? "Invited. They have an email with a sign-in link." : "Saved. Add the agreement date to send the invite.") } }, "Save and invite"));
    pane.appendChild(inv);
    if (!team.loaded) { pane.appendChild(h("div", { class: "gc-meta" }, h("span", { class: "spin" }), "Loading...")); return; }
    team.members.forEach((m) => {
      const box = h("div", { class: "gc-box" });
      box.appendChild(h("div", { class: "gc-bh" }, m.name + " · " + m.email, h("span", { class: "gc-badge " + (m.active ? (m.agreementAt ? "ok" : "warn") : "err"), text: !m.active ? "Deactivated" : m.agreementAt ? "Active · agreement " + m.agreementAt : "Waiting for the agreement" })));
      box.appendChild(h("div", { class: "gc-meta", text: "Last sign-in: " + (m.lastLoginAt ? when(m.lastLoginAt) : "never") }));
      const ag = inputRow("tm-ag-" + m.id, "Agreement signed on", m.agreementAt || "", { type: "date" });
      const tk = clientTicks("tm-c-" + m.id + "-", m.clients);
      box.appendChild(ag.row);
      box.appendChild(h("div", { class: "gc-label", text: "Clients" }));
      box.appendChild(tk.box);
      const tools = h("div", { class: "gc-brain-tools" });
      tools.appendChild(h("button", { type: "button", class: "btn-copy", on: { click: () => teamCall("/admin/team/" + m.id, "PATCH", { agreementAt: ag.el.value || null, clients: tk.value() }, () => "Saved.") } }, "Save"));
      if (m.active && m.agreementAt) tools.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => teamCall("/admin/team/" + m.id, "PATCH", { resend: true }, () => "Invite sent again.") } }, "Resend invite"));
      tools.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => teamCall("/admin/team/" + m.id, "PATCH", { active: !m.active }, () => (m.active ? "Deactivated. Their sessions have ended." : "Active again.")) } }, m.active ? "Deactivate" : "Activate"));
      box.appendChild(tools);
      pane.appendChild(box);
    });
  }

  return { renderBox, renderTeam, cardBadge, approved, gate, productionDoc, notesText, load, videoBlocked };
}
