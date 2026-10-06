/* ScriptForge Growth Clients panel: client review and delivery files (TAHA Growth Department V2,
   Parts A and B). Loaded by growth-campaign.js, admin only.

   Client review (Part A): Send to client for review freezes the saved campaign as the client
   sees it and emails her a link (no content). Her verdict and comment per card come back here
   and on each output card. Mark delivered needs her approval, or a reason that is logged.

   Delivery files (Part B): finished videos, images and PDFs for the campaign, up to 500 MB each,
   sent from this browser to the Vault in 8 MB parts. Images attached to Visual Pack briefs are
   listed here too. The client sees all of them in Your content after Mark delivered. */

const VAULT = "/api/vault";
const STATE = {
  waiting: { text: "Waiting for client", cls: "warn" },
  changes: { text: "Changes requested", cls: "err" },
  approved: { text: "Approved", cls: "ok" }
};
const ACCEPT = ".mp4,.mov,.pdf,.jpg,.jpeg,.png,.webp,video/mp4,video/quicktime,application/pdf,image/jpeg,image/png,image/webp";

export function createReviewUi(ctx) {
  const { h, api } = ctx;
  const when = ctx.when || ((x) => x || "");
  const state = {};
  const key = (c, cp) => c + "/" + cp;
  function st(clientId, campaignId) {
    const k = key(clientId, campaignId);
    if (!state[k]) state[k] = { loaded: false, loading: false, rounds: [], log: [], busy: false, msg: null, showOld: false, uploads: [], fmsg: null };
    return state[k];
  }

  function load(clientId, campaignId, force) {
    const s = st(clientId, campaignId);
    if ((s.loaded && !force) || s.loading) return s;
    s.loading = true;
    api("/admin/campaign/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId) + "/review").then((r) => {
      s.loading = false;
      s.loaded = true;
      if (r.ok && r.d) {
        s.rounds = r.d.rounds || [];
        s.log = r.d.log || [];
      }
      ctx.rerender(clientId);
    });
    return s;
  }

  function latest(clientId, campaignId) {
    const s = st(clientId, campaignId);
    return s.rounds.find((r) => r.state !== "withdrawn") || null;
  }

  /* The client's answers for one panel card (socialCopy covers every post, and so on). */
  function notesFor(clientId, campaignId, cardKey) {
    const r = latest(clientId, campaignId);
    if (!r) return [];
    return r.items
      .filter((i) => i.key === cardKey || i.key.startsWith(cardKey + "."))
      .map((i) => {
        const card = r.view.cards.find((c) => c.key === i.key);
        return { label: card ? card.title.en : i.key, verdict: i.verdict, comment: i.comment, round: r.round };
      });
  }

  async function send(info) {
    const s = st(info.client.id, info.campaignId);
    s.busy = true;
    s.msg = null;
    ctx.rerender(info.client.id);
    const r = await api("/admin/campaign/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId) + "/review", { method: "POST", body: {} });
    s.busy = false;
    if (r.ok && r.d) {
      s.rounds = r.d.rounds || [];
      s.log = r.d.log || [];
      s.msg = { cls: "ok", text: "Round " + s.rounds[0].round + " sent. She has an email with a link to the portal, and no campaign content in it." };
    } else s.msg = { cls: "err", text: (r.d && r.d.message && r.d.message.en) || "Could not send the campaign for review." };
    ctx.rerender(info.client.id);
  }

  function renderBox(pane, info) {
    const { client, campaignId, doc, dirty } = info;
    const s = load(client.id, campaignId);
    const r = latest(client.id, campaignId);
    const box = h("div", { class: "gc-box rv-box" });
    const badge = r ? STATE[r.state] : { text: "Not sent yet", cls: "" };
    box.appendChild(h("div", { class: "gc-bh" }, "Client review", h("span", { class: "gc-badge " + badge.cls, text: badge.text + (r ? " · round " + r.round + " · " + when(r.decidedAt || r.sentAt) : "") })));
    if (!s.loaded) {
      box.appendChild(h("div", { class: "gc-meta" }, h("span", { class: "spin" }), "Loading..."));
      pane.appendChild(box);
      return;
    }
    if (r) {
      const changes = r.items.filter((i) => i.verdict === "change");
      const ok = r.items.filter((i) => i.verdict === "ok").length;
      box.appendChild(h("div", { class: "gc-meta", text: r.view.cards.length + " cards · " + ok + " look good · " + changes.length + " to change" + (r.state === "waiting" ? " · she has not sent her answers yet" : "") }));
      changes.forEach((i) => {
        const card = r.view.cards.find((c) => c.key === i.key);
        box.appendChild(h("div", { class: "rv-change" }, h("b", { text: card ? card.title.en : i.key }), h("span", { text: "“" + i.comment + "”" })));
      });
    }
    const tools = h("div", { class: "gc-brain-tools" });
    const next = r ? r.round + 1 : 1;
    const label = !r ? "Send to client for review" : r.state === "approved" ? "Send a new round (" + next + ")" : "Send round " + next;
    tools.appendChild(h("button", { type: "button", class: !r || r.state === "changes" ? "gc-brain-btn" : "btn-ghost", disabled: s.busy || dirty, title: dirty ? "Save your changes first" : "", on: { click: () => send(info) } }, s.busy ? "Sending..." : label));
    if (r && r.state === "waiting") tools.appendChild(h("span", { class: "gc-meta", text: "Sending a new round replaces the one she has not answered." }));
    if (dirty) tools.appendChild(h("span", { class: "gc-meta", text: "Save your changes first; she sees the saved campaign." }));
    box.appendChild(tools);
    if (s.msg) box.appendChild(h("div", { class: "gc-msg " + s.msg.cls, role: "status", text: s.msg.text }));
    const older = s.rounds.filter((x) => x !== r);
    if (older.length || s.log.length) {
      box.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { s.showOld = !s.showOld; ctx.rerender(client.id); } } }, s.showOld ? "Hide history" : "History (" + (older.length) + " earlier rounds, " + s.log.length + " events)"));
      if (s.showOld) {
        older.forEach((x) => {
          box.appendChild(h("div", { class: "gc-meta", text: "Round " + x.round + ": " + (STATE[x.state] ? STATE[x.state].text : x.state) + " · sent " + when(x.sentAt) }));
          x.items.filter((i) => i.verdict === "change").forEach((i) => box.appendChild(h("div", { class: "gc-meta", text: "   " + i.key + ": “" + i.comment + "”" })));
        });
        s.log.forEach((l) => box.appendChild(h("div", { class: "gc-meta", text: when(l.at) + " · " + l.event.replace(/_/g, " ") + (l.detail ? ": " + l.detail : "") })));
      }
    }
    pane.appendChild(box);
  }

  /* ----- delivery files ----- */

  async function uploadFile(info, file, title, ai) {
    const s = st(info.client.id, info.campaignId);
    const base = VAULT + "/admin/upload/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId);
    const job = { name: file.name, done: 0, total: file.size, error: null };
    s.uploads.push(job);
    ctx.rerender(info.client.id);
    const jsonReq = async (url, method, body) => {
      const r = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && d.message && d.message.en) || "Upload failed (" + r.status + ").");
      return d;
    };
    let id = null;
    try {
      const start = await jsonReq(base + "/start", "POST", { name: file.name, size: file.size, mime: file.type, title, ai });
      id = start.uploadId;
      const parts = [];
      for (let n = 1, off = 0; off < file.size; n++, off += start.partBytes) {
        const chunk = file.slice(off, Math.min(file.size, off + start.partBytes));
        let tries = 0;
        for (;;) {
          try {
            const r = await fetch(base + "/" + id + "/part?n=" + n, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" }, body: chunk });
            const d = await r.json().catch(() => null);
            if (!r.ok) throw new Error((d && d.message && d.message.en) || "Part " + n + " failed.");
            parts.push({ partNumber: d.partNumber, etag: d.etag });
            break;
          } catch (e) {
            /* A dropped connection is tried again twice before giving up. */
            if (++tries > 2 || /match its type|too large/i.test(e.message)) throw e;
            await new Promise((res) => setTimeout(res, 1500 * tries));
          }
        }
        job.done = Math.min(file.size, off + start.partBytes);
        ctx.rerender(info.client.id);
      }
      await jsonReq(base + "/" + id + "/complete", "POST", { parts });
      s.uploads = s.uploads.filter((x) => x !== job);
      s.fmsg = { cls: "ok", text: file.name + " is added." };
      info.reloadDeliveries();
    } catch (e) {
      job.error = e.message;
      if (id) fetch(base + "/" + id, { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    }
    ctx.rerender(info.client.id);
  }

  async function remove(info, d) {
    const s = st(info.client.id, info.campaignId);
    const r = await api("/admin/delivery/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId) + "/" + encodeURIComponent(d.id), { method: "DELETE" });
    s.fmsg = r.ok ? { cls: "ok", text: "Removed." } : { cls: "err", text: "Could not remove it." };
    info.reloadDeliveries();
    ctx.rerender(info.client.id);
  }

  function fmtSize(n) {
    return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }

  function renderFiles(pane, info) {
    const { client, campaignId, deliveries, delivered } = info;
    const s = st(client.id, campaignId);
    const box = h("div", { class: "gc-box rv-box" });
    box.appendChild(h("div", { class: "gc-bh" }, "Delivery files", h("span", { text: (deliveries || []).length + ((deliveries || []).length === 1 ? " file · " : " files · ") + (delivered ? "the client sees them in Your content" : "the client sees them after Mark delivered") })));
    (deliveries || []).forEach((d) => {
      box.appendChild(h("div", { class: "rv-file" },
        d.kind === "image" ? h("img", { src: d.url, alt: "", loading: "lazy" }) : h("span", { class: "rv-kind", text: d.kind.toUpperCase() }),
        h("div", { class: "rv-file-t" }, h("b", { text: d.title || d.name || d.id }), h("span", { class: "gc-meta", text: fmtSize(d.size) + (d.visualId ? " · for brief " + d.visualId : "") + (d.aiImage ? " · made with AI" : "") })),
        h("button", { type: "button", class: "gc-link", on: { click: () => remove(info, d) } }, "Remove")));
    });
    s.uploads.forEach((u) => {
      const pct = u.total ? Math.round((u.done / u.total) * 100) : 0;
      box.appendChild(h("div", { class: "rv-up" + (u.error ? " err" : "") }, h("span", { text: u.name + (u.error ? ": " + u.error : " · " + pct + "%") }), u.error ? null : h("progress", { max: "100", value: String(pct) })));
    });
    const inputId = "rv-file-" + client.id;
    const titleId = "rv-title-" + client.id;
    const input = h("input", { type: "file", id: inputId, accept: ACCEPT, multiple: true, class: "gv-file" });
    const title = h("input", { type: "text", id: titleId, placeholder: "Title the client sees (optional)" });
    const ai = h("input", { type: "checkbox", id: "rv-ai-" + client.id });
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      input.value = "";
      files.forEach((f) => {
        if (f.size > 500 * 1024 * 1024) { s.fmsg = { cls: "err", text: f.name + " is over 500 MB." }; ctx.rerender(client.id); return; }
        uploadFile(info, f, title.value.trim() || f.name.replace(/\.[a-z0-9]+$/i, ""), ai.checked);
      });
    });
    box.appendChild(h("div", { class: "rv-add" },
      h("div", { class: "gc-ed" }, h("label", { for: titleId, text: "Title" }), title),
      h("label", { for: "rv-ai-" + client.id, class: "lp-tick" }, ai, h("span", { text: "Made with AI" })),
      input,
      h("label", { for: inputId, class: "btn-copy", text: "Add video, image or PDF" })));
    box.appendChild(h("div", { class: "gc-meta", text: "MP4, MOV, PDF, JPG, PNG or WebP, up to 500 MB each, sent in parts so a dropped connection only repeats one part." }));
    if (s.fmsg) box.appendChild(h("div", { class: "gc-msg " + s.fmsg.cls, role: "status", text: s.fmsg.text }));
    pane.appendChild(box);
  }

  return { renderBox, renderFiles, notesFor, latest, load };
}
