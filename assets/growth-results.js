/* ScriptForge Growth Clients panel: Results (TAHA Growth Department V2 Part D). Loaded by
   growth-campaign.js, admin only.

   A Results box on every saved campaign: what the client reported in her portal ("How did it
   go?"), a field per question for Harry to fill or correct (his value wins, hers is kept and
   shown), a note, and a small chart of the client's main number (orders, bookings or customers)
   month by month. The numbers and the note go into the next campaign's {{LAST_RESULTS}}.
   No em-dashes anywhere. */
import { POST_CHANNELS, POST_LABEL } from "./growth-resultfields.js?v=m3";

export function createResultsUi(ctx) {
  const { h, api } = ctx;
  const when = ctx.when || ((x) => x || "");
  const state = {};

  function st(clientId) {
    if (!state[clientId]) state[clientId] = { loaded: false, loading: false, data: null, edit: {}, msg: {}, busy: {} };
    return state[clientId];
  }

  function load(clientId, force) {
    const s = st(clientId);
    if ((s.loaded && !force) || s.loading) return s;
    s.loading = true;
    api("/admin/results/" + encodeURIComponent(clientId)).then((r) => {
      s.loading = false;
      s.loaded = true;
      if (r.ok && r.d) s.data = r.d;
      ctx.rerender(clientId);
    });
    return s;
  }

  function monthShort(m) {
    const [y, mo] = String(m).split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, 15)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }) + " " + String(y).slice(2);
  }

  /* A small bar chart of the main number, one bar per campaign month (latest 12). */
  function chart(data) {
    const byMonth = {};
    data.items.forEach((i) => { if (i.main != null) byMonth[i.month] = (byMonth[i.month] || 0) + i.main; });
    const months = Object.keys(byMonth).sort().slice(-12);
    const label = (data.fields.find((f) => f.key === data.mainKey) || {}).label || "Main number";
    if (!months.length) return h("div", { class: "gc-meta", text: label + " by month: no numbers yet. They appear here when the client reports or you fill them in." });
    const W = 44, GAP = 14, H = 90, top = 18, base = top + H;
    const max = Math.max.apply(null, months.map((m) => byMonth[m])) || 1;
    const width = months.length * (W + GAP) + GAP;
    const ns = "http://www.w3.org/2000/svg";
    const el = (tag, attrs, text) => {
      const e = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
      if (text != null) e.textContent = text;
      return e;
    };
    const svg = el("svg", { viewBox: "0 0 " + width + " " + (base + 22), width: String(width), height: String(base + 22), role: "img", class: "rs-chart", "aria-label": label + " by month: " + months.map((m) => monthShort(m) + " " + byMonth[m]).join(", ") });
    svg.appendChild(el("line", { x1: "0", y1: String(base), x2: String(width), y2: String(base), class: "rs-axis" }));
    months.forEach((m, i) => {
      const v = byMonth[m];
      const bh = Math.max(2, Math.round((v / max) * H));
      const x = GAP + i * (W + GAP);
      svg.appendChild(el("rect", { x: String(x), y: String(base - bh), width: String(W), height: String(bh), rx: "3", class: "rs-bar" + (i === months.length - 1 ? " last" : "") }));
      svg.appendChild(el("text", { x: String(x + W / 2), y: String(base - bh - 5), "text-anchor": "middle", class: "rs-val" }, String(v)));
      svg.appendChild(el("text", { x: String(x + W / 2), y: String(base + 15), "text-anchor": "middle", class: "rs-lbl" }, monthShort(m)));
    });
    return h("div", { class: "rs-chart-wrap" }, h("div", { class: "gc-meta", text: label + " by month" }), svg);
  }

  function renderBox(pane, info) {
    const { client, campaignId } = info;
    const s = load(client.id);
    const box = h("div", { class: "gc-box rs-box", id: "gcResults" });
    box.appendChild(h("div", { class: "gc-bh" }, "Results", h("span", { text: "what the client reported, your corrections and note; goes into next month's campaign" })));
    if (!s.data) {
      box.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading results..."));
      pane.appendChild(box);
      return;
    }
    const item = s.data.items.find((i) => i.campaignId === campaignId);
    if (!item) { pane.appendChild(box); return; }
    const status = item.clientAt ? "Reported by the client " + when(item.clientAt) : item.skipped ? "The client skipped the question" : item.delivered ? "Not reported yet. The client's portal asks from the 25th of the campaign month." : "The portal asks once the campaign is delivered.";
    box.appendChild(h("div", { class: "gc-meta", text: status + (item.harryAt ? " · You edited " + when(item.harryAt) : "") }));

    const ed = s.edit[campaignId] || (s.edit[campaignId] = { values: Object.assign({}, item.harry), note: item.note });
    const grid = h("div", { class: "gc-cgrid" });
    s.data.fields.forEach((f) => {
      const id = "rs-" + f.key;
      const theirs = item.client[f.key];
      let input;
      if (f.type === "int") {
        input = h("input", { type: "text", inputmode: "numeric", id, placeholder: theirs != null ? String(theirs) : "" });
        input.value = ed.values[f.key] != null ? String(ed.values[f.key]) : "";
        input.addEventListener("input", () => { ed.values[f.key] = input.value.trim(); });
      } else if (f.type === "post") {
        input = h("select", { id }, h("option", { value: "" }, theirs ? "Client: " + (POST_LABEL[theirs] || theirs) : "Not set"),
          POST_CHANNELS.map((c) => h("option", { value: c, selected: ed.values[f.key] === c }, POST_LABEL[c])));
        input.addEventListener("change", () => { ed.values[f.key] = input.value; });
      } else {
        input = h("textarea", { id, class: "gc-ta", rows: "2", placeholder: theirs || "" });
        input.value = ed.values[f.key] || "";
        input.addEventListener("input", () => { ed.values[f.key] = input.value; });
      }
      const sub = theirs != null && theirs !== "" ? "Client said: " + (f.type === "post" ? POST_LABEL[theirs] || theirs : String(theirs)) : "Client: not given";
      grid.appendChild(h("div", { class: "gc-ed" + (f.type === "text" ? " wide" : "") }, h("label", { for: id, text: f.label }), input, h("div", { class: "gc-meta", text: sub })));
    });
    const note = h("textarea", { id: "rs-note", class: "gc-ta", rows: "2", placeholder: "For example: rainy fortnight, the Instagram reel did most of the work" });
    note.value = ed.note || "";
    note.addEventListener("input", () => { ed.note = note.value; });
    grid.appendChild(h("div", { class: "gc-ed wide" }, h("label", { for: "rs-note", text: "Your note (goes into the prompt with the numbers)" }), note));
    box.appendChild(h("div", { class: "gc-meta", text: "Leave a field empty to use the client's answer. What you type replaces hers in the prompt; her own answer is kept." }));
    box.appendChild(grid);

    const msg = s.msg[campaignId];
    const save = h("button", { type: "button", class: "btn-copy", disabled: !!s.busy[campaignId], on: { click: () => {
      const values = {};
      const bad = [];
      s.data.fields.forEach((f) => {
        const v = ed.values[f.key];
        if (v === undefined || v === null || v === "") return;
        if (f.type === "int") { if (!/^\d+$/.test(String(v))) bad.push(f.label); else values[f.key] = parseInt(v, 10); }
        else values[f.key] = v;
      });
      if (bad.length) { s.msg[campaignId] = { cls: "err", text: "Whole numbers only: " + bad.join(", ") }; ctx.rerender(client.id); return; }
      s.busy[campaignId] = true;
      ctx.rerender(client.id);
      api("/admin/results/" + encodeURIComponent(client.id) + "/" + encodeURIComponent(campaignId), { method: "PUT", body: { values, note: ed.note || "" } }).then((r) => {
        s.busy[campaignId] = false;
        if (r.ok && r.d) {
          const i = s.data.items.findIndex((x) => x.campaignId === campaignId);
          if (i > -1) s.data.items[i] = r.d.item;
          s.msg[campaignId] = { cls: "ok", text: "Results saved. They go into the next campaign's prompt." };
        } else s.msg[campaignId] = { cls: "err", text: (r.d && r.d.errors && r.d.errors.join("; ")) || "Could not save the results." };
        ctx.rerender(client.id);
      });
    } } }, "Save results");
    box.appendChild(h("div", { class: "gc-brain-tools" }, save));
    if (msg) box.appendChild(h("div", { class: "gc-msg " + msg.cls, role: "status", text: msg.text }));
    box.appendChild(chart(s.data));
    pane.appendChild(box);
  }

  return { renderBox, load, reload: (id) => load(id, true) };
}
