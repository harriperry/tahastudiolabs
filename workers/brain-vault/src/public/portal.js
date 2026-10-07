/* TAHA Studio Labs Growth Department: client onboarding portal.
   Screens: Sign in, Consent, Business profile, Uploads, Review and submit, Status, and from
   V2 phase G2a Photos we need (photo requests from the campaign's Visual Pack).
   All wording comes from /grow/i18n.json. Every answer is saved to the Brain Vault as the
   client types (debounced) and on leaving each field, so closing the browser loses nothing.
   No AI runs here and no API key is ever involved: the portal only stores business information. */
(function () {
  "use strict";

  var API = "/api/vault";
  var DICT = null;
  var L = "sv";
  var META = { productName: "TAHA Studio Labs Growth Department", contactEmail: "" };
  var ME = null;
  var S = null;
  var draft = null;
  var dirty = false;
  var saving = false;
  var saveAgain = false;
  var saveTimer = null;
  var consentErr = false;
  var signinSent = false;
  var showMissing = false;
  var msgs = {};
  var PR = [];
  var PAGES = [];
  var LEADS = [];
  var REPORT = { cp: "", data: null, loading: false, error: false };
  var confirmDel = "";
  var CAMPS = [];
  /* V2 Part D: "How did it go?" */
  var RES = { niche: "other", fields: [], postChannels: [], items: [] };
  var RF = { cp: "", values: {}, busy: false, msg: null, bad: {} };
  var CV = { cp: "", data: null, loading: false, error: false, answers: {}, busy: false, msg: null };
  var app = document.getElementById("app");

  var PIC_TYPES = ["image/jpeg", "image/png", "image/webp"];
  var MB = 1024 * 1024;
  var TONES = ["warm", "playful", "expert", "premium", "direct"];
  var STATUS_ORDER = ["invited", "profile_in_progress", "submitted", "brain_ready", "campaign_in_production", "campaign_delivered"];
  var REQUIRED = [
    ["profile", "companyName"], ["profile", "location"], ["profile", "productService"],
    ["profile", "targetAudience"], ["profile", "brandVoice"], ["profile", "usp"], ["profile", "campaignLanguage"]
  ];

  /* ---------- helpers ---------- */
  function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] != null ? vars[k] : m;
    });
  }
  function t(path, vars) {
    var v = path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, DICT ? DICT[L] : null);
    if (v == null) return path;
    return typeof v === "string" ? fill(v, vars) : v;
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
      else if (k === "checked") el.checked = !!v;
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
  function svg(path, color) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg");
    s.setAttribute("width", "18");
    s.setAttribute("height", "18");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", color || "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", path);
    s.appendChild(p);
    return s;
  }
  var SHIELD = "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z";
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    if (opts.json !== undefined) {
      opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      opts.body = JSON.stringify(opts.json);
      delete opts.json;
    }
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }, function () { return { ok: r.ok, status: r.status, data: {} }; });
    }, function () { return { ok: false, status: 0, data: { networkError: true } }; });
  }
  function both(m) {
    return m && typeof m === "object" ? m[L] || m.sv : t("networkError");
  }
  function toast(text, isErr) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var el = h("div", { class: "toast" + (isErr ? " err" : ""), role: "status", text: text });
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(L === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return iso;
    }
  }
  function extOf(name) {
    var m = /\.([a-z0-9]{1,5})$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function isVideo(file) {
    return /^video\//i.test(file.type || "") || ["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "3gp", "mpeg", "mpg"].indexOf(extOf(file.name)) > -1;
  }
  function fileName(id) {
    var f = (S.files || []).filter(function (x) { return x.id === id; })[0];
    return f ? f.name : id;
  }

  /* ---------- language ---------- */
  function setLang(next, persist) {
    L = next === "en" ? "en" : "sv";
    document.documentElement.lang = L;
    try { localStorage.setItem("tv_lang", L); } catch (e) {}
    document.querySelectorAll("[data-lang]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === L));
    });
    document.getElementById("signOut").textContent = t("signOut");
    if (persist && ME && ME.role === "client") api("/me/language", { method: "PUT", json: { language: L } });
  }
  function initialLang() {
    var stored = null;
    try { stored = localStorage.getItem("tv_lang"); } catch (e) {}
    if (stored === "sv" || stored === "en") return stored;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    if (/^sv/i.test(nav)) return "sv";
    if (/^en/i.test(nav)) return "en";
    return "sv";
  }

  /* ---------- saving ---------- */
  function cleaned() {
    var p = JSON.parse(JSON.stringify(draft.profile));
    var u = JSON.parse(JSON.stringify(draft.uploads));
    p.offers = p.offers.filter(function (o) { return (o.offer || o.priceOrDiscount || o.validUntil); });
    p.competitors = p.competitors.filter(function (c) { return (c.name || c.website); });
    p.reviews.pasted = p.reviews.pasted.map(function (s) { return s.trim(); }).filter(Boolean);
    u.previousPosts = u.previousPosts.filter(function (x) { return x.value && String(x.value).trim(); });
    u.faqs.rows = u.faqs.rows.filter(function (r) { return (r.q || r.a); });
    return { answerLanguage: L, campaignLanguage: draft.campaignLanguage || "", profile: p, uploads: u };
  }
  function setSaveState(kind) {
    var el = document.getElementById("saveState");
    if (!el) return;
    el.className = "savestate" + (kind === "err" ? " err" : "");
    el.textContent = kind === "saving" ? t("saving") : kind === "err" ? t("saveFailed") : kind === "saved" ? t("saved") : "";
  }
  function markDirty(now) {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, now ? 0 : 900);
  }
  function save() {
    clearTimeout(saveTimer);
    if (!dirty) return Promise.resolve(true);
    if (saving) {
      saveAgain = true;
      return Promise.resolve(true);
    }
    saving = true;
    dirty = false;
    setSaveState("saving");
    return api("/intake", { method: "PUT", json: cleaned() }).then(function (r) {
      saving = false;
      if (!r.ok) {
        dirty = true;
        setSaveState("err");
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 5000);
        return false;
      }
      if (S.client.status === "invited") S.client.status = "profile_in_progress";
      setSaveState("saved");
      if (saveAgain) {
        saveAgain = false;
        dirty = true;
        return save();
      }
      return true;
    });
  }
  window.addEventListener("pagehide", function () {
    if (dirty && draft) {
      try {
        fetch(API + "/intake", { method: "PUT", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cleaned()) });
      } catch (e) {}
    }
  });

  /* ---------- shell ---------- */
  function shell(step) {
    var prog = document.getElementById("progress");
    var steps = ["profile", "uploads", "review"];
    var idx = steps.indexOf(step);
    prog.classList.toggle("hidden", idx < 0);
    if (idx > -1) {
      document.getElementById("stepLabel").textContent = t("steps." + step);
      var bars = prog.querySelectorAll(".bars span");
      bars.forEach(function (b, i) { b.className = i < idx ? "done" : i === idx ? "cur" : ""; });
    }
    document.getElementById("signOut").classList.toggle("hidden", !ME);
    var foot = document.getElementById("foot");
    foot.textContent = "";
    add(foot, [t("help") + " "]);
    if (META.contactEmail) add(foot, h("a", { href: "mailto:" + META.contactEmail, text: META.contactEmail }));
  }
  function render() {
    var y = window.scrollY;
    var active = document.activeElement && document.activeElement.id;
    app.textContent = "";
    var view = currentView();
    shell(view);
    var fn = { signin: viewSignin, admin: viewAdmin, consent: viewConsent, profile: viewProfile, uploads: viewUploads, review: viewReview, status: viewStatus, photos: viewPhotos, enquiries: viewEnquiries, report: viewReport, campaign: viewCampaign, content: viewContent, results: viewResults }[view];
    add(app, fn());
    if (active && document.getElementById(active)) document.getElementById(active).focus({ preventScroll: true });
    window.scrollTo(0, y);
  }
  function go(hash) {
    if (location.hash === "#" + hash) {
      render();
    } else {
      location.hash = hash;
    }
    window.scrollTo(0, 0);
  }
  function currentView() {
    if (!ME) return "signin";
    if (ME.role === "admin") return "admin";
    if (!S.consent.accepted) return "consent";
    var hsh = location.hash.replace("#", "");
    if (["profile", "uploads", "review", "status", "photos", "enquiries"].indexOf(hsh) > -1) return hsh;
    if (/^report-cp_[a-z0-9_]{2,40}$/.test(hsh)) return "report";
    if (/^campaign-cp_[a-z0-9_]{2,40}$/.test(hsh)) return "campaign";
    if (hsh === "content" || /^content-cp_[a-z0-9_]{2,40}$/.test(hsh)) return "content";
    if (/^results-cp_[a-z0-9_]{2,40}$/.test(hsh)) return "results";
    return S.latestIntakeVersion > 0 ? "status" : "profile";
  }
  window.addEventListener("hashchange", function () {
    if (draft) save();
    render();
    window.scrollTo(0, 0);
  });

  /* ---------- sign in ---------- */
  function viewSignin() {
    var email = h("input", { type: "email", id: "email", autocomplete: "email", placeholder: t("signin.ph"), required: true });
    var msg = h("div", { class: "msg", role: "status", "aria-live": "polite" });
    var out = [h("div", { class: "head" }, h("div", { class: "kicker", text: t("signin.kicker") }), h("h1", { text: t("signin.title") }), h("p", { class: "lead", text: t("signin.lead") }))];
    if (!signinSent) {
      var form = h("form", { class: "card", novalidate: true, onSubmit: function (ev) {
        ev.preventDefault();
        var v = email.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
          email.classList.add("invalid");
          msg.className = "msg err";
          msg.textContent = t("signin.err");
          return;
        }
        var btn = form.querySelector("button");
        btn.disabled = true;
        api("/auth/request-link", { method: "POST", json: { email: v, lang: L } }).then(function (r) {
          btn.disabled = false;
          if (r.ok) {
            signinSent = true;
            render();
          } else {
            msg.className = "msg err";
            msg.textContent = both(r.data.message);
          }
        });
      } },
        h("div", { class: "field" }, h("label", { for: "email", text: t("signin.label") }), email),
        msg,
        h("button", { type: "submit", class: "btn", text: t("signin.button") }),
        h("div", { class: "hint", text: t("signin.note") }));
      out.push(form);
    } else {
      out.push(h("div", { class: "card" },
        h("h2", { text: t("signin.sentTitle") }),
        h("p", { class: "lead", text: t("signin.sentBody") }),
        h("button", { type: "button", class: "btn secondary", text: t("signin.again"), onClick: function () { signinSent = false; render(); } })));
    }
    out.push(h("div", { class: "note" }, svg(SHIELD, "#1F6B4E"), h("span", { text: t("signin.invite", { product: META.productName }) })));
    return out;
  }

  function viewAdmin() {
    return h("div", { class: "card" },
      h("h1", { text: t("signin.adminTitle") }),
      h("p", { class: "lead", text: t("signin.adminBody") }),
      h("a", { class: "btn", href: "/api/vault/console", text: t("signin.adminLink") }));
  }

  /* ---------- consent ---------- */
  function viewConsent() {
    var c = S.consent;
    var vars = { email: c.contactEmail, months: c.retentionMonths };
    var box = h("input", { type: "checkbox", id: "agree" });
    var label = h("label", { class: "check" + (consentErr ? " err" : ""), for: "agree" }, box,
      h("span", {}, h("b", { text: t("consent.agree") }), h("br"), t("consent.check")));
    var err = h("div", { class: "msg err", role: "alert", text: consentErr ? t("consent.err") : "" });
    var btn = h("button", { type: "button", class: "btn", text: t("consent.button"), onClick: function () {
      if (!box.checked) {
        consentErr = true;
        render();
        return;
      }
      btn.disabled = true;
      api("/consent", { method: "POST", json: { accepted: true, language: L } }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) return toast(both(r.data.message), true);
        S.consent.accepted = true;
        consentErr = false;
        go("profile");
      });
    } });
    box.addEventListener("change", function () {
      if (box.checked && consentErr) {
        consentErr = false;
        label.classList.remove("err");
        err.textContent = "";
      }
    });
    return [
      h("div", { class: "head" }, h("div", { class: "kicker", text: t("consent.kicker") }), h("h1", { text: t("consent.title") }), h("p", { class: "lead", text: t("consent.lead") })),
      h("div", { class: "card" },
        h("div", { class: "points" }, t("consent.points").map(function (p) {
          return h("div", { class: "point" }, h("h3", { text: fill(p.h, vars) }), h("p", { text: fill(p.b, vars) }));
        })),
        h("a", { href: c.privacyUrl, target: "_blank", rel: "noopener", text: t("consent.policy") })),
      label, err, btn,
      h("div", { class: "hint", text: t("consent.version", { version: c.currentVersion }) })
    ];
  }

  /* ---------- form building blocks ---------- */
  function hintBlock(key) {
    return h("div", { class: "hint" }, t("profile.fields." + key + ".hint"), h("br"), h("b", { text: t("example") + " " }), t("profile.fields." + key + ".ex"));
  }
  function labelFor(id, key, required) {
    return h("label", { for: id }, t("profile.fields." + key + ".label") + " ", h("span", { class: "req", text: required ? t("required") : t("optional") }));
  }
  function isEmpty(v) {
    return v == null || (typeof v === "string" && !v.trim());
  }
  function textField(key, get, set, opts) {
    opts = opts || {};
    var id = "f_" + key;
    var attrs = { id: id, value: get() || "", onInput: function (e) { set(e.target.value); markDirty(); }, onBlur: function () { markDirty(true); } };
    if (opts.maxlength) attrs.maxlength = opts.maxlength;
    var input = opts.multiline ? h("textarea", Object.assign({ rows: 4 }, attrs)) : h("input", Object.assign({ type: opts.type || "text" }, attrs));
    if (showMissing && opts.required && isEmpty(get())) input.classList.add("invalid");
    return h("div", { class: "field" }, labelFor(id, key, opts.required), input, hintBlock(key));
  }
  function rowInput(id, value, label, onSet, type, placeholder) {
    return h("input", { type: type || "text", id: id, value: value || "", "aria-label": label, placeholder: placeholder || "", onInput: function (e) { onSet(e.target.value); markDirty(); }, onBlur: function () { markDirty(true); } });
  }
  function tagInput(listName, cls) {
    var list = draft.profile.brandWords[listName];
    var id = "tag_" + listName;
    var wrap = h("div", { class: "tags" }, h("span", { class: "tlabel " + cls, text: t("profile.fields.brandWords." + listName) }));
    list.forEach(function (word, i) {
      add(wrap, h("span", { class: "tag" }, word, h("button", { type: "button", "aria-label": t("remove") + " " + word, text: "×", onClick: function () {
        list.splice(i, 1);
        markDirty(true);
        render();
      } })));
    });
    var input = h("input", { type: "text", id: id, "aria-label": t("profile.fields.brandWords." + listName), placeholder: t("profile.fields.brandWords." + listName + "Ph"), maxlength: 200 });
    function commit() {
      var v = input.value.replace(/,$/, "").trim();
      if (v && list.indexOf(v) < 0 && list.length < 50) {
        list.push(v);
        markDirty(true);
      }
      input.value = "";
      render();
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      }
    });
    input.addEventListener("blur", function () { if (input.value.trim()) commit(); });
    add(wrap, input);
    return wrap;
  }
  function fileUploadButton(id, label, accept, multiple, onFiles) {
    var input = h("input", { type: "file", id: id, accept: accept, multiple: multiple || null, "aria-label": label });
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = "";
      onFiles(files);
    });
    return h("span", { class: "btn secondary small filebtn" }, svg("M12 16V4M6 10l6-6 6 6M4 20h16"), label, input);
  }
  function msgLine(key) {
    var m = msgs[key];
    return h("div", { class: "msg" + (m && m.err ? " err" : m ? " ok" : ""), role: "status", "aria-live": "polite", text: m ? m.text : "" });
  }
  function setMsg(key, text, err) {
    msgs[key] = text ? { text: text, err: !!err } : null;
    render();
  }
  function fileLine(id, onRemove) {
    return h("div", { class: "fileline" }, h("span", { text: t("uploads.attached") + " " + fileName(id) }),
      h("button", { type: "button", class: "btn link", text: t("remove"), onClick: onRemove }));
  }

  /* ---------- uploads ---------- */
  function resizeImage(file) {
    if (!window.createImageBitmap) return Promise.resolve({ blob: file, name: file.name, type: file.type });
    return createImageBitmap(file).then(function (bmp) {
      var max = Math.max(bmp.width, bmp.height);
      if (max <= 2000) return { blob: file, name: file.name, type: file.type };
      var scale = 2000 / max;
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (blob && blob.type === file.type) return resolve({ blob: blob, name: file.name, type: file.type });
          canvas.toBlob(function (jpg) {
            resolve({ blob: jpg, name: file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", type: "image/jpeg" });
          }, "image/jpeg", 0.88);
        }, file.type, 0.88);
      });
    }, function () {
      return { blob: file, name: file.name, type: file.type };
    });
  }
  function uploadBlob(section, item) {
    return fetch(API + "/uploads?section=" + encodeURIComponent(section), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": item.type || "application/octet-stream", "X-File-Name": encodeURIComponent(item.name) },
      body: item.blob
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; }, function () { return { ok: false, data: {} }; });
    }, function () { return { ok: false, data: {} }; });
  }
  /* Checks a file in the browser first; the Vault checks again. */
  function precheck(file, section, msgKey) {
    var rule = S.limits[section];
    if (isVideo(file)) {
      setMsg(msgKey, t("uploads.noVideo"), true);
      return false;
    }
    if (rule.ext.indexOf(extOf(file.name)) < 0) {
      setMsg(msgKey, t("uploads.wrongType", { name: file.name }), true);
      return false;
    }
    if (file.size > rule.maxBytes) {
      setMsg(msgKey, t("uploads.tooBig", { name: file.name, mb: Math.round(rule.maxBytes / MB) }), true);
      return false;
    }
    return true;
  }
  function uploadFiles(files, section, msgKey, isImage, onDone, limitLeft) {
    var queue = files.slice();
    var errors = [];
    function next() {
      if (!queue.length) {
        setMsg(msgKey, errors.join(" "), errors.length > 0);
        markDirty(true);
        render();
        return;
      }
      var file = queue.shift();
      if (limitLeft() <= 0) {
        errors.push(t("uploads.maxReached"));
        queue = [];
        return next();
      }
      if (!precheck(file, section, msgKey)) {
        errors.push(msgs[msgKey].text);
        return next();
      }
      setMsg(msgKey, t("uploads.uploading", { name: file.name }), false);
      var prep = isImage ? resizeImage(file) : Promise.resolve({ blob: file, name: file.name, type: file.type || "application/octet-stream" });
      prep.then(function (item) { return uploadBlob(section, item); }).then(function (r) {
        if (r.ok) {
          S.files.push(r.data.file);
          onDone(r.data.file);
        } else {
          errors.push(r.data && r.data.message ? both(r.data.message) + " (" + file.name + ")" : t("uploads.uploadFailed", { name: file.name }));
        }
        next();
      });
    }
    next();
  }
  function removeFile(id, after) {
    api("/files/" + id, { method: "DELETE" }).then(function (r) {
      if (!r.ok && r.status !== 404) return toast(t("networkError"), true);
      S.files = S.files.filter(function (f) { return f.id !== id; });
      after();
      markDirty(true);
      render();
    });
  }

  /* ---------- profile ---------- */
  function viewProfile() {
    var p = draft.profile;
    var f = function (key, opts) {
      return textField(key, function () { return p[key]; }, function (v) { p[key] = v; }, opts);
    };
    var chips = h("div", { class: "chips" }, TONES.map(function (k) {
      var on = p.brandVoice.toneChips.indexOf(k) > -1;
      return h("button", { type: "button", class: "chip", "aria-pressed": String(on), text: t("profile.chips." + k), onClick: function () {
        if (on) p.brandVoice.toneChips = p.brandVoice.toneChips.filter(function (x) { return x !== k; });
        else p.brandVoice.toneChips.push(k);
        markDirty(true);
        render();
      } });
    }));
    var voice = textField("brandVoice", function () { return p.brandVoice.text; }, function (v) { p.brandVoice.text = v; }, { multiline: true, required: true, maxlength: 5000 });
    add(voice, [h("div", { class: "hint", text: t("profile.fields.brandVoice.chips") }), chips]);

    if (!p.offers.length) p.offers.push({ offer: "", priceOrDiscount: "", validUntil: "" });
    var offers = h("div", { class: "field" }, h("div", { class: "flabel" }, t("profile.fields.offers.label") + " ", h("span", { class: "req", text: t("optional") })),
      p.offers.map(function (o, i) {
        return h("div", { class: "rowbox" },
          rowInput("offer_" + i, o.offer, t("profile.fields.offers.offer"), function (v) { o.offer = v; }, "text", t("profile.fields.offers.ex")),
          h("div", { class: "row" },
            rowInput("price_" + i, o.priceOrDiscount, t("profile.fields.offers.price"), function (v) { o.priceOrDiscount = v; }, "text", t("profile.fields.offers.priceEx")),
            rowInput("until_" + i, o.validUntil, t("profile.fields.offers.until"), function (v) { o.validUntil = v; }, "date")),
          p.offers.length > 1 ? h("button", { type: "button", class: "btn link rm", text: t("remove"), onClick: function () { p.offers.splice(i, 1); markDirty(true); render(); } }) : null);
      }),
      p.offers.length < 20 ? h("button", { type: "button", class: "btn dashed", text: "+ " + t("profile.fields.offers.add"), onClick: function () { p.offers.push({ offer: "", priceOrDiscount: "", validUntil: "" }); render(); } }) : null,
      h("div", { class: "hint", text: t("profile.fields.offers.hint") }));

    if (!p.competitors.length) p.competitors.push({ name: "", website: "" });
    var comps = h("div", { class: "field" }, h("div", { class: "flabel" }, t("profile.fields.competitors.label") + " ", h("span", { class: "req", text: t("optional") })),
      p.competitors.map(function (c, i) {
        return h("div", { class: "rowbox" },
          h("div", { class: "row" },
            rowInput("cname_" + i, c.name, t("profile.fields.competitors.name"), function (v) { c.name = v; }, "text", t("profile.fields.competitors.ex")),
            rowInput("cweb_" + i, c.website, t("profile.fields.competitors.website"), function (v) { c.website = v; }, "url", "https://")),
          p.competitors.length > 1 ? h("button", { type: "button", class: "btn link rm", text: t("remove"), onClick: function () { p.competitors.splice(i, 1); markDirty(true); render(); } }) : null);
      }),
      p.competitors.length < 20 ? h("button", { type: "button", class: "btn dashed", text: "+ " + t("profile.fields.competitors.add"), onClick: function () { p.competitors.push({ name: "", website: "" }); render(); } }) : null,
      h("div", { class: "hint", text: t("profile.fields.competitors.hint") }));

    var reviews = h("div", { class: "field" }, labelFor("f_reviews", "reviews", false),
      h("textarea", { id: "f_reviews", rows: 5, value: p.reviews.pasted.join("\n"), onInput: function (e) { p.reviews.pasted = e.target.value.split("\n"); markDirty(); }, onBlur: function () { markDirty(true); } }),
      hintBlock("reviews"),
      p.reviews.fileIds.map(function (id) {
        return fileLine(id, function () { removeFile(id, function () { p.reviews.fileIds = p.reviews.fileIds.filter(function (x) { return x !== id; }); }); });
      }),
      p.reviews.fileIds.length < 5 ? fileUploadButton("up_reviews", t("profile.fields.reviews.upload"), ".txt,.csv,.pdf,text/plain,text/csv,application/pdf", true, function (files) {
        uploadFiles(files, "reviews", "reviews", false, function (file) { p.reviews.fileIds.push(file.id); }, function () { return 5 - p.reviews.fileIds.length; });
      }) : null,
      msgLine("reviews"));

    var words = h("div", { class: "field" }, h("div", { class: "flabel" }, t("profile.fields.brandWords.label") + " ", h("span", { class: "req", text: t("optional") })),
      tagInput("use", "use"), tagInput("avoid", "avoid"), hintBlock("brandWords"));

    var langOpts = h("div", { class: "field" }, h("div", { class: "hint", text: t("profile.fields.campaignLanguage.hint") }),
      ["sv", "en", "both"].map(function (k) {
        var on = draft.campaignLanguage === k;
        return h("label", { class: "radio" + (on ? " on" : "") + (showMissing && !draft.campaignLanguage ? " invalid" : "") },
          h("input", { type: "radio", name: "campaignLanguage", value: k, checked: on, onChange: function () { draft.campaignLanguage = k; markDirty(true); render(); } }),
          h("span", { text: t("profile.langs." + k) }));
      }));

    return [
      h("div", { class: "head" }, h("h1", { text: t("profile.title") }), h("p", { class: "lead", text: t("profile.lead") })),
      h("section", { class: "card" }, h("h2", { text: t("profile.cardA") }),
        f("companyName", { required: true, maxlength: 200 }),
        f("website", { type: "url", maxlength: 500 }),
        f("location", { required: true, maxlength: 300 }),
        f("productService", { required: true, multiline: true, maxlength: 5000 })),
      h("section", { class: "card" }, h("h2", { text: t("profile.cardB") }),
        f("targetAudience", { required: true, multiline: true, maxlength: 5000 }),
        voice,
        f("usp", { required: true, multiline: true, maxlength: 3000 })),
      h("section", { class: "card" }, h("h2", { text: t("profile.cardC") }), offers, comps, reviews, words),
      h("section", { class: "card" }, h("h2", {}, t("profile.fields.campaignLanguage.label") + " ", h("span", { class: "req", text: t("required") })), langOpts),
      h("button", { type: "button", class: "btn", text: t("profile.next"), onClick: function () { save(); go("uploads"); } })
    ];
  }

  /* ---------- uploads view ---------- */
  function viewUploads() {
    var u = draft.uploads;
    var pics = h("section", { class: "card" }, h("h2", { text: t("uploads.pics") }),
      h("div", { class: "hint", text: t("uploads.picsHint") }),
      u.pictures.length ? h("div", { class: "thumbs" }, u.pictures.map(function (pic) {
        return h("div", { class: "thumb" }, h("img", { src: API + "/files/" + pic.fileId, alt: pic.name, loading: "lazy" }),
          h("button", { type: "button", "aria-label": t("remove") + " " + pic.name, text: "×", onClick: function () {
            removeFile(pic.fileId, function () { u.pictures = u.pictures.filter(function (x) { return x.fileId !== pic.fileId; }); });
          } }));
      })) : null,
      u.pictures.length < 20 ? fileUploadButton("up_pics", t("uploads.picsBtn"), "image/jpeg,image/png,image/webp", true, function (files) {
        uploadFiles(files, "pictures", "pics", true, function (file) { u.pictures.push({ fileId: file.id, name: file.name, mime: file.mime }); }, function () { return 20 - u.pictures.length; });
      }) : null,
      h("div", { class: "hint", text: t("uploads.picsRule") }),
      msgLine("pics"));

    var fs = u.founderStory;
    var story = h("section", { class: "card" }, h("h2", { text: t("uploads.story") }),
      h("div", { class: "hint", text: t("uploads.storyHint") }),
      h("ul", { class: "qlist" }, h("li", { text: t("uploads.q1") }), h("li", { text: t("uploads.q2") }), h("li", { text: t("uploads.q3") })),
      h("textarea", { id: "f_story", rows: 8, maxlength: 20000, "aria-label": t("uploads.story"), placeholder: t("uploads.storyPh"), value: fs.text, onInput: function (e) { fs.text = e.target.value; markDirty(); }, onBlur: function () { markDirty(true); } }),
      fs.fileId ? fileLine(fs.fileId, function () { var id = fs.fileId; removeFile(id, function () { fs.fileId = null; }); })
        : fileUploadButton("up_story", t("uploads.storyUp"), ".txt,.pdf,.docx", false, function (files) {
          uploadFiles(files.slice(0, 1), "founderStory", "story", false, function (file) { fs.fileId = file.id; }, function () { return fs.fileId ? 0 : 1; });
        }),
      msgLine("story"));

    var posts = u.previousPosts;
    var postsCard = h("section", { class: "card" }, h("h2", { text: t("uploads.posts") }),
      h("div", { class: "hint", text: t("uploads.postsHint") }),
      posts.map(function (pp, i) {
        var body;
        if (pp.type === "image") {
          body = h("div", { class: "thumbs" }, h("div", { class: "thumb" }, h("img", { src: API + "/files/" + pp.value, alt: t("uploads.postImage") })));
        } else if (pp.type === "text") {
          body = h("textarea", { id: "post_" + i, rows: 3, "aria-label": t("uploads.postText"), value: pp.value, onInput: function (e) { pp.value = e.target.value; markDirty(); }, onBlur: function () { markDirty(true); } });
        } else {
          body = rowInput("post_" + i, pp.value, t("uploads.postLink"), function (v) { pp.value = v; }, "url", "https://");
        }
        return h("div", { class: "rowbox" }, body, h("button", { type: "button", class: "btn link rm", text: t("remove"), onClick: function () {
          if (pp.type === "image") removeFile(pp.value, function () { posts.splice(posts.indexOf(pp), 1); });
          else { posts.splice(i, 1); markDirty(true); render(); }
        } }));
      }),
      posts.length < 15 ? h("div", { class: "actions" },
        h("button", { type: "button", class: "btn dashed", text: "+ " + t("uploads.addLink"), onClick: function () { posts.push({ type: "link", value: "" }); render(); } }),
        h("button", { type: "button", class: "btn dashed", text: "+ " + t("uploads.addText"), onClick: function () { posts.push({ type: "text", value: "" }); render(); } }),
        fileUploadButton("up_posts", t("uploads.shots"), "image/jpeg,image/png,image/webp", true, function (files) {
          uploadFiles(files, "previousPosts", "posts", true, function (file) { posts.push({ type: "image", value: file.id }); }, function () { return 15 - posts.length; });
        })) : null,
      msgLine("posts"));

    var fq = u.faqs;
    if (!fq.rows.length) fq.rows.push({ q: "", a: "" });
    var faq = h("section", { class: "card" }, h("h2", { text: t("uploads.faq") }),
      h("div", { class: "hint", text: t("uploads.faqHint") }),
      fq.rows.map(function (r, i) {
        return h("div", { class: "rowbox" },
          rowInput("faq_q_" + i, r.q, t("uploads.q"), function (v) { r.q = v; }, "text", t("uploads.qEx")),
          h("textarea", { id: "faq_a_" + i, rows: 2, "aria-label": t("uploads.a"), placeholder: t("uploads.aEx"), value: r.a, onInput: function (e) { r.a = e.target.value; markDirty(); }, onBlur: function () { markDirty(true); } }),
          fq.rows.length > 1 ? h("button", { type: "button", class: "btn link rm", text: t("remove"), onClick: function () { fq.rows.splice(i, 1); markDirty(true); render(); } }) : null);
      }),
      fq.rows.length < 30 ? h("button", { type: "button", class: "btn dashed", text: "+ " + t("uploads.addQ"), onClick: function () { fq.rows.push({ q: "", a: "" }); render(); } }) : null,
      fq.fileId ? fileLine(fq.fileId, function () { var id = fq.fileId; removeFile(id, function () { fq.fileId = null; }); })
        : fileUploadButton("up_faq", t("uploads.faqUp"), ".txt,.pdf,.docx,.csv", false, function (files) {
          uploadFiles(files.slice(0, 1), "faqs", "faq", false, function (file) { fq.fileId = file.id; }, function () { return fq.fileId ? 0 : 1; });
        }),
      msgLine("faq"));

    return [
      h("div", { class: "head" }, h("h1", { text: t("uploads.title") }), h("p", { class: "lead", text: t("uploads.lead") })),
      pics, story, postsCard, faq,
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn secondary", text: t("back"), onClick: function () { save(); go("profile"); } }),
        h("button", { type: "button", class: "btn", text: t("uploads.next"), onClick: function () { save(); go("review"); } }))
    ];
  }

  /* ---------- review ---------- */
  function missingFields() {
    var p = draft.profile;
    var out = [];
    if (isEmpty(p.companyName)) out.push("companyName");
    if (isEmpty(p.location)) out.push("location");
    if (isEmpty(p.productService)) out.push("productService");
    if (isEmpty(p.targetAudience)) out.push("targetAudience");
    if (isEmpty(p.brandVoice.text)) out.push("brandVoice");
    if (isEmpty(p.usp)) out.push("usp");
    if (!draft.campaignLanguage) out.push("campaignLanguage");
    return out;
  }
  function short(s) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > 120 ? s.slice(0, 117) + "..." : s;
  }
  function viewReview() {
    var p = draft.profile;
    var u = draft.uploads;
    var missing = missingFields();
    function row(label, value, required) {
      var empty = value == null || value === "" || (Array.isArray(value) && !value.length);
      var cls = empty ? (required ? "miss" : "opt") : "ok";
      var text = empty ? (required ? t("review.missing") : t("review.empty")) : Array.isArray(value) ? value.join(", ") : value;
      return h("div", { class: "revrow" }, h("span", { text: label }), h("b", { class: cls, text: short(text) }));
    }
    function group(title, hash, rows) {
      return h("section", { class: "card" },
        h("div", { class: "cardhead" }, h("h2", { text: title }), h("a", { href: "#" + hash, text: t("review.edit") })),
        rows);
    }
    var F = function (k) { return t("profile.fields." + k + ".label"); };
    var postsCount = u.previousPosts.filter(function (x) { return x.value; }).length;
    var reviewsCount = p.reviews.pasted.filter(function (x) { return x.trim(); }).length + p.reviews.fileIds.length;
    var btn = h("button", { type: "button", class: "btn", text: t("review.submit"), onClick: function () {
      if (missing.length) {
        showMissing = true;
        toast(t("review.fixFirst"), true);
        return;
      }
      btn.disabled = true;
      btn.textContent = t("review.submitting");
      dirty = true;
      save().then(function () {
        return api("/intake/submit", { method: "POST", json: {} });
      }).then(function (r) {
        btn.disabled = false;
        btn.textContent = t("review.submit");
        if (!r.ok) return toast(r.data && r.data.message ? both(r.data.message) : t("review.submitFailed"), true);
        return loadState().then(function () { go("status"); });
      });
    } });
    return [
      h("div", { class: "head" }, h("h1", { text: t("review.title") }), h("p", { class: "lead", text: t("review.lead") })),
      group(t("profile.cardA"), "profile", [
        row(F("companyName"), p.companyName, true), row(F("website"), p.website), row(F("location"), p.location, true), row(F("productService"), p.productService, true)]),
      group(t("profile.cardB"), "profile", [
        row(F("targetAudience"), p.targetAudience, true),
        row(F("brandVoice"), p.brandVoice.text, true),
        row(t("profile.fields.brandVoice.chips").replace(/:$/, ""), p.brandVoice.toneChips.map(function (k) { return t("profile.chips." + k); })),
        row(F("usp"), p.usp, true)]),
      group(t("profile.cardC"), "profile", [
        row(F("offers"), p.offers.filter(function (o) { return o.offer; }).map(function (o) { return o.offer; })),
        row(F("competitors"), p.competitors.filter(function (c) { return c.name; }).map(function (c) { return c.name; })),
        row(F("reviews"), reviewsCount ? String(reviewsCount) : ""),
        row(F("brandWords"), p.brandWords.use.concat(p.brandWords.avoid.map(function (w) { return "-" + w; }))),
        row(F("campaignLanguage"), draft.campaignLanguage ? t("profile.langs." + draft.campaignLanguage) : "", true)]),
      group(t("uploads.title"), "uploads", [
        row(t("uploads.pics"), u.pictures.length ? t("review.files", { n: u.pictures.length }) : ""),
        row(t("uploads.story"), u.founderStory.text || (u.founderStory.fileId ? fileName(u.founderStory.fileId) : "")),
        row(t("uploads.posts"), postsCount ? String(postsCount) : ""),
        row(t("uploads.faq"), u.faqs.rows.filter(function (r) { return r.q; }).length ? String(u.faqs.rows.filter(function (r) { return r.q; }).length) : (u.faqs.fileId ? fileName(u.faqs.fileId) : ""))]),
      missing.length ? h("div", { class: "msg err", role: "alert", text: t("review.fixFirst") }) : null,
      h("div", { class: "note" }, svg(SHIELD, "#1F6B4E"), h("span", { text: t("review.note") })),
      h("div", { class: "note" }, svg(SHIELD, "#1F6B4E"), h("span", { text: t("review.pub") })),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn secondary", text: t("back"), onClick: function () { go("uploads"); } }),
        btn)
    ];
  }

  /* ---------- status ---------- */
  function viewStatus() {
    var status = S.client.status;
    var curIdx = STATUS_ORDER.indexOf(status);
    var last = {};
    S.history.forEach(function (h0) { last[h0.status] = h0.at; });
    var submitted = S.latestIntakeVersion > 0;
    var now = t("status.now." + status);
    var steps = h("div", { class: "card steps" }, STATUS_ORDER.map(function (st, i) {
      var done = i < curIdx || (i === curIdx && i === STATUS_ORDER.length - 1);
      var cur = i === curIdx && !done;
      var meta = last[st] ? fmtDate(last[st]) : i > curIdx ? t("status.coming") : "";
      if (st === "submitted" && S.latestIntakeVersion && last[st]) meta += " · " + t("status.version", { n: S.latestIntakeVersion });
      return h("div", { class: "step" + (i > curIdx ? " future" : "") },
        h("span", { class: "dot" + (done ? " done" : cur ? " cur" : ""), text: done ? "✓" : String(i + 1) }),
        h("div", {}, h("div", { class: "sl", text: t("statuses." + st) }), h("div", { class: "sm", text: meta })));
    }));
    return [
      h("div", { class: "head" }, h("div", { class: "kicker", text: t("status.kicker") }),
        h("h1", { text: submitted ? t("status.titleDone") : t("status.titleOpen") }),
        h("p", { class: "lead", text: t("status.lead") })),
      h("div", { class: "now" }, h("div", { class: "kicker", text: t("status.nowLabel") }), h("h2", { text: now.t }), h("p", { text: now.b })),
      resultsCards(),
      campCards(),
      photoCard(),
      pageCards(),
      steps,
      h("div", { class: "note" }, svg(SHIELD, "#1F6B4E"), h("span", { text: t("review.pub") })),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn" + (submitted ? " secondary" : ""), text: submitted ? t("status.edit") : t("status.continue"), onClick: function () { go("profile"); } }))
    ];
  }

  /* ---------- photos we need (V2 phase G2a) ---------- */
  function openPhotos() {
    return PR.filter(function (r) { return r.state === "open"; });
  }
  function photoCard() {
    if (!PR.length) return null;
    var n = openPhotos().length;
    if (!n) return h("div", { class: "card photo-card done" }, h("div", { class: "kicker", text: t("photos.kicker") }), h("p", { text: t("photos.cardDone") }));
    return h("div", { class: "card photo-card" },
      h("div", { class: "kicker", text: t("photos.kicker") }),
      h("h2", { text: t("photos.cardTitle", { n: n, word: n === 1 ? t("photos.one") : t("photos.many") }) }),
      h("button", { type: "button", class: "btn", text: t("photos.open"), onClick: function () { go("photos"); } }));
  }
  function loadPhotos() {
    return api("/portal/photo-requests").then(function (r) {
      PR = r.ok && r.data && r.data.requests ? r.data.requests : [];
    });
  }
  function uploadForRequest(req, file) {
    var key = "pr_" + req.id;
    if (!precheck(file, "pictures", key)) return render();
    setMsg(key, t("uploads.uploading", { name: file.name }), false);
    render();
    resizeImage(file).then(function (item) {
      return fetch(API + "/uploads?section=pictures&request=" + encodeURIComponent(req.id), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": item.type || "application/octet-stream", "X-File-Name": encodeURIComponent(item.name) },
        body: item.blob
      }).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, data: d }; }, function () { return { ok: false, data: {} }; });
      }, function () { return { ok: false, data: {} }; });
    }).then(function (r) {
      if (r.ok) {
        S.files.push(r.data.file);
        req.state = "received";
        req.fileId = r.data.file.id;
        req.receivedAt = new Date().toISOString();
        setMsg(key, t("photos.thanks"), false);
      } else {
        setMsg(key, r.data && r.data.message ? both(r.data.message) : t("uploads.uploadFailed", { name: file.name }), true);
      }
      render();
    });
  }
  function viewPhotos() {
    var list = PR.slice().sort(function (a, b) { return (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1); });
    var items = list.map(function (req) {
      var text = (L === "sv" ? req.text.sv : req.text.en) || req.text.en || req.text.sv;
      var done = req.state === "received";
      var id = "up_pr_" + req.id;
      var input = h("input", { type: "file", id: id, accept: "image/jpeg,image/png,image/webp", class: "sr-file" });
      input.addEventListener("change", function () { if (input.files && input.files[0]) uploadForRequest(req, input.files[0]); });
      return h("div", { class: "card photo-req" + (done ? " done" : "") },
        h("div", { class: "pr-head" },
          h("span", { class: "pr-badge" + (done ? " ok" : ""), text: done ? t("photos.received", { date: fmtDate(req.receivedAt) }) : t("photos.waiting") }),
          req.placement ? h("span", { class: "muted small", text: t("photos.for", { placement: req.placement }) }) : null),
        h("p", { class: "pr-text", text: text }),
        req.campaignName ? h("div", { class: "muted small", text: t("photos.campaign", { name: req.campaignName }) }) : null,
        done ? null : h("div", { class: "pr-actions" }, input, h("label", { for: id, class: "btn", text: t("photos.upload") }), h("span", { class: "muted small", text: t("photos.rule") })),
        msgLine("pr_" + req.id));
    });
    return [
      h("div", { class: "head" }, h("div", { class: "kicker", text: t("photos.kicker") }), h("h1", { text: t("photos.title") }), h("p", { class: "lead", text: t("photos.lead") })),
      items.length ? items : h("div", { class: "card" }, h("p", { text: t("photos.none") })),
      h("div", { class: "note" }, h("span", { text: t("photos.tips") })),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn secondary", text: t("photos.back"), onClick: function () { go("status"); } }))
    ];
  }

  /* ---------- campaign pages, enquiries and report (V2 phase G2b) ---------- */
  function loadPages() {
    return Promise.all([api("/portal/pages"), api("/portal/leads")]).then(function (rs) {
      PAGES = rs[0].ok && rs[0].data && rs[0].data.pages ? rs[0].data.pages : [];
      LEADS = rs[1].ok && rs[1].data && rs[1].data.leads ? rs[1].data.leads : [];
    });
  }
  function newLeads() {
    return LEADS.filter(function (x) { return x.state === "new"; }).length;
  }
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
  }
  function pageCards() {
    if (!PAGES.length) return LEADS.length ? enquiryLinkCard() : null;
    var n = newLeads();
    return PAGES.map(function (pg, i) {
      var links = h("div", { class: "actions" },
        h("a", { class: "btn", href: pg.url, target: "_blank", rel: "noopener", text: t("pages.open") }),
        h("button", { type: "button", class: "btn secondary", text: t("pages.copy"), onClick: function (ev) {
          var b = ev.target;
          copyText(pg.url, function () { b.textContent = t("pages.copied"); });
        } }));
      var more = h("div", { class: "actions" },
        h("button", { type: "button", class: "btn secondary", text: t("pages.report"), onClick: function () { go("report-" + pg.campaignId); } }),
        i === 0 && (pg.formOn || LEADS.length) ? h("button", { type: "button", class: "btn secondary", text: t("pages.enquiries") + (n ? " (" + t("pages.newOnes", { n: n }) + ")" : ""), onClick: function () { go("enquiries"); } }) : null);
      return h("div", { class: "card page-card" },
        h("div", { class: "kicker", text: t("pages.kicker") }),
        h("h2", { text: pg.ended ? t("pages.titleEnded") : t("pages.title") }),
        pg.campaignName ? h("p", { class: "muted small", text: pg.campaignName }) : null,
        h("a", { class: "page-url", href: pg.url, target: "_blank", rel: "noopener", text: pg.url.replace(/^https?:\/\//, "") }),
        h("p", { class: "small", text: pg.ended ? t("pages.ended", { date: fmtDay(pg.offerEnd) }) : t("pages.until", { date: fmtDay(pg.offerEnd) }) }),
        links, more);
    });
  }
  function enquiryLinkCard() {
    var n = newLeads();
    return h("div", { class: "card page-card" }, h("div", { class: "kicker", text: t("enquiries.kicker") }),
      h("button", { type: "button", class: "btn", text: t("pages.enquiries") + (n ? " (" + t("pages.newOnes", { n: n }) + ")" : ""), onClick: function () { go("enquiries"); } }));
  }
  function fmtDay(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "";
    try {
      return new Date(iso + "T12:00:00Z").toLocaleDateString(L === "en" ? "en-GB" : "sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    } catch (e) { return iso; }
  }
  function chLabel(c) {
    return t("report.ch." + c) === "report.ch." + c ? c : t("report.ch." + c);
  }
  function setLeadState(lead, state) {
    api("/portal/leads/" + lead.id, { method: "PATCH", json: { state: state } }).then(function (r) {
      if (r.ok) lead.state = state;
      else toast(both(r.data && r.data.message) || t("networkError"), true);
      render();
    });
  }
  function removeLead(lead) {
    api("/portal/leads/" + lead.id, { method: "DELETE" }).then(function (r) {
      confirmDel = "";
      if (r.ok) {
        LEADS = LEADS.filter(function (x) { return x.id !== lead.id; });
        toast(t("enquiries.deleted"));
      } else toast(both(r.data && r.data.message) || t("networkError"), true);
      render();
    });
  }
  function viewEnquiries() {
    var items = LEADS.map(function (l) {
      var contact = [];
      if (l.phone) contact.push(h("a", { href: "tel:" + l.phone.replace(/[^\d+]/g, ""), text: l.phone }));
      if (l.email) contact.push(h("a", { href: "mailto:" + l.email, text: l.email }));
      var acts = confirmDel === l.id
        ? h("div", { class: "actions" },
            h("button", { type: "button", class: "btn small", text: t("enquiries.confirmDelete"), onClick: function () { removeLead(l); } }),
            h("button", { type: "button", class: "btn small secondary", text: t("enquiries.cancel"), onClick: function () { confirmDel = ""; render(); } }))
        : h("div", { class: "actions" },
            h("button", { type: "button", class: "btn small secondary", text: l.state === "new" ? t("enquiries.markContacted") : t("enquiries.markNew"), onClick: function () { setLeadState(l, l.state === "new" ? "contacted" : "new"); } }),
            h("button", { type: "button", class: "btn small link", text: t("enquiries.delete"), onClick: function () { confirmDel = l.id; render(); } }));
      return h("div", { class: "card lead" + (l.state === "new" ? " new" : "") },
        h("div", { class: "pr-head" },
          h("span", { class: "pr-badge" + (l.state === "new" ? "" : " ok"), text: l.state === "new" ? t("enquiries.new") : t("enquiries.contacted") }),
          h("span", { class: "muted small", text: fmtDate(l.at) })),
        h("h2", { class: "lead-name", text: l.name }),
        h("div", { class: "lead-contact" }, contact.map(function (x, i) { return i ? [" · ", x] : x; })),
        l.message ? h("p", { class: "pr-text", text: l.message }) : null,
        h("div", { class: "muted small", text: [l.futureOffers ? t("enquiries.wantsOffers") : t("enquiries.noOffers"), l.channel ? t("enquiries.from", { channel: chLabel(l.channel) }) : "", l.campaignName ? t("enquiries.campaign", { name: l.campaignName }) : ""].filter(Boolean).join(" · ") }),
        acts);
    });
    return [
      h("div", { class: "head" }, h("div", { class: "kicker", text: t("enquiries.kicker") }), h("h1", { text: t("enquiries.title") }), h("p", { class: "lead", text: t("enquiries.lead") })),
      items.length ? items : h("div", { class: "card" }, h("p", { text: t("enquiries.none") })),
      h("div", { class: "actions" },
        LEADS.length ? h("a", { class: "btn secondary", href: API + "/portal/leads.csv", download: "enquiries.csv", text: t("enquiries.csv") }) : null,
        h("button", { type: "button", class: "btn secondary", text: t("enquiries.back"), onClick: function () { go("status"); } }))
    ];
  }
  function loadReport(cp) {
    REPORT = { cp: cp, data: null, loading: true, error: false };
    api("/portal/report/" + cp).then(function (r) {
      REPORT.loading = false;
      if (r.ok) REPORT.data = r.data;
      else REPORT.error = true;
      render();
    });
  }
  function pctText(v) {
    if (v == null) return "";
    return (v > 0 ? "+" : "") + Math.round(v * 100) + " %";
  }
  function viewReport() {
    var cp = location.hash.replace("#report-", "");
    if (REPORT.cp !== cp) loadReport(cp);
    var back = h("div", { class: "actions no-print" }, h("button", { type: "button", class: "btn secondary", text: t("report.back"), onClick: function () { go("status"); } }));
    if (REPORT.loading) return [h("p", { class: "muted", text: t("loading") })];
    if (REPORT.error || !REPORT.data) return [h("div", { class: "card" }, h("p", { text: t("networkError") })), back];
    var d = REPORT.data;
    var tile = function (n, label) { return h("div", { class: "tile" }, h("b", { text: String(n) }), h("span", { text: label })); };
    var tiles = h("div", { class: "tiles" }, tile(d.visits, t("report.visits")), tile(d.visitors, t("report.visitors")), tile(d.clicks, t("report.clicks")), tile(d.enquiries, t("report.enquiries")), d.scans ? tile(d.scans, t("report.scans")) : null);
    var chRows = d.channels.filter(function (c) { return c.visits || c.clicks || c.enquiries || c.scans; }).map(function (c) {
      return h("tr", {}, h("td", { text: chLabel(c.channel) }), h("td", { text: String(c.visits + c.scans) }), h("td", { text: String(c.clicks) }), h("td", { text: String(c.enquiries) }));
    });
    var btnKeys = Object.keys(d.buttons || {});
    var metricKeys = Object.keys(d.before || {}).concat(Object.keys(d.after || {})).filter(function (k, i, a) { return a.indexOf(k) === i && !/^redemptions-/.test(k); });
    var ba = metricKeys.length ? h("table", { class: "rtable" },
      h("thead", {}, h("tr", {}, h("th", { text: "" }), h("th", { text: t("report.before") }), h("th", { text: t("report.after") }), h("th", { text: t("report.change") }))),
      h("tbody", {}, metricKeys.map(function (k) {
        var label = t("report.metrics." + k) === "report.metrics." + k ? k.replace(/_/g, " ") : t("report.metrics." + k);
        var b = d.before[k], a = d.after[k];
        return h("tr", {}, h("td", { text: label }), h("td", { text: b == null ? "" : String(b) }), h("td", { text: a == null ? "" : String(a) }), h("td", { text: pctText(d.change[k]) }));
      }))) : h("p", { class: "muted small", text: t("report.noNumbers") });
    return [
      h("div", { class: "head" }, h("div", { class: "kicker", text: t("report.kicker") }), h("h1", { text: t("report.title", { name: d.campaignName || "" }) }), h("p", { class: "lead", text: t("report.lead") })),
      h("div", { class: "card" }, tiles, d.bestChannel ? h("p", { class: "best", text: t("report.best", { channel: chLabel(d.bestChannel) }) }) : null,
        h("p", { class: "muted small", text: d.ended ? t("pages.ended", { date: fmtDay(d.offerEnd) }) : t("pages.until", { date: fmtDay(d.offerEnd) }) })),
      chRows.length ? h("div", { class: "card" }, h("h2", { text: t("report.byChannel") }), h("table", { class: "rtable" },
        h("thead", {}, h("tr", {}, h("th", { text: t("report.channel") }), h("th", { text: t("report.visits") }), h("th", { text: t("report.clicks") }), h("th", { text: t("report.enquiries") }))),
        h("tbody", {}, chRows))) : null,
      btnKeys.length ? h("div", { class: "card" }, h("h2", { text: t("report.buttons") }), h("div", { class: "tiles" }, btnKeys.map(function (k) { return tile(d.buttons[k], t("report.btn." + k)); }))) : null,
      h("div", { class: "card" }, h("h2", { text: t("report.beforeAfter") }), d.baselinePeriod ? h("p", { class: "muted small", text: t("report.period", { period: d.baselinePeriod }) }) : null, ba),
      h("div", { class: "actions no-print" }, h("button", { type: "button", class: "btn", text: t("report.print"), onClick: function () { window.print(); } }),
        h("button", { type: "button", class: "btn secondary", text: t("report.back"), onClick: function () { go("status"); } }))
    ];
  }

  /* ---------- How did it go? (V2 Part D) ---------- */
  function loadResults() {
    return api("/portal/results").then(function (r) {
      if (r.ok && r.data) RES = r.data;
    });
  }
  function resultItem(cp) {
    return RES.items.filter(function (i) { return i.campaignId === cp; })[0] || null;
  }
  function resultsCards() {
    return RES.items.filter(function (i) { return i.ask; }).slice(0, 2).map(function (i) {
      return h("div", { class: "card camp-card todo res-card" },
        h("div", { class: "kicker", text: t("results.kicker") }),
        h("h2", { text: t("results.cardTitle", { name: i.name }) }),
        h("p", { text: t("results.cardLead") }),
        h("button", { type: "button", class: "btn", text: t("results.open"), onClick: function () { go("results-" + i.campaignId); } }));
    });
  }
  function fieldLabel(f) {
    if (f.key === "newCustomers" && RES.niche === "salon") return t("results.fields.newClients");
    return t("results.fields." + f.key);
  }
  function viewResults() {
    var cp = location.hash.replace("#results-", "");
    var item = resultItem(cp);
    var back = h("button", { type: "button", class: "btn secondary", text: t("results.back"), onClick: function () { go("status"); } });
    if (!item) return [h("div", { class: "card" }, h("p", { text: t("networkError") })), h("div", { class: "actions" }, back)];
    if (RF.cp !== cp) RF = { cp: cp, values: Object.assign({}, item.values), busy: false, msg: null, bad: {} };
    var form = h("form", { class: "card res-form", novalidate: true, onSubmit: function (ev) { ev.preventDefault(); sendResults(item, false); } });
    RES.fields.forEach(function (f) {
      var id = "res_" + f.key;
      var v = RF.values[f.key];
      var input;
      if (f.type === "int") {
        input = h("input", { type: "text", id: id, inputmode: "numeric", pattern: "[0-9]*", autocomplete: "off", value: v == null ? "" : String(v), onInput: function (e) { RF.values[f.key] = e.target.value.trim(); } });
        if (RF.bad[f.key]) input.classList.add("invalid");
      } else if (f.type === "post") {
        var chans = item.channels.concat(["landing_page", "other"]).filter(function (c, i, a) { return a.indexOf(c) === i; });
        input = h("select", { id: id, onChange: function (e) { RF.values[f.key] = e.target.value; } },
          h("option", { value: "", text: t("results.notSure") }),
          chans.map(function (c) { var o = h("option", { value: c, text: t("results.posts." + c) }); if (v === c) o.selected = true; return o; }));
      } else {
        input = h("textarea", { id: id, rows: 3, maxlength: 1000, onInput: function (e) { RF.values[f.key] = e.target.value; } });
        input.value = v || "";
      }
      add(form, h("div", { class: "field" }, h("label", { for: id }, fieldLabel(f) + " ", h("span", { class: "req", text: t("optional") })), input,
        f.key === "said" ? h("div", { class: "hint", text: t("results.saidHint") }) : null,
        RF.bad[f.key] ? h("div", { class: "msg err", text: t("results.badNumber") }) : null));
    });
    add(form, h("div", { class: "msg" + (RF.msg ? (RF.msg.err ? " err" : " ok") : ""), role: "status", "aria-live": "polite", text: RF.msg ? RF.msg.text : "" }));
    add(form, h("div", { class: "actions" },
      h("button", { type: "submit", class: "btn", disabled: RF.busy, text: item.answered ? t("results.update") : t("results.send") }),
      !item.answered && !item.skipped ? h("button", { type: "button", class: "btn secondary", disabled: RF.busy, text: t("results.skip"), onClick: function () { sendResults(item, true); } }) : null));
    return [
      h("div", { class: "head" }, h("div", { class: "kicker", text: t("results.kicker") }), h("h1", { text: t("results.title", { name: item.name }) }),
        h("p", { class: "lead", text: item.answered ? t("results.answered") : t("results.lead") })),
      form,
      h("div", { class: "actions" }, back)
    ];
  }
  function sendResults(item, skip) {
    var values = {};
    RF.bad = {};
    if (!skip) {
      RES.fields.forEach(function (f) {
        var v = RF.values[f.key];
        if (v === undefined || v === null || v === "") return;
        if (f.type === "int") {
          if (!/^\d+$/.test(String(v))) { RF.bad[f.key] = true; return; }
          values[f.key] = parseInt(v, 10);
        } else values[f.key] = v;
      });
      if (Object.keys(RF.bad).length) { RF.msg = { err: true, text: t("results.badNumber") }; render(); return; }
    }
    RF.busy = true;
    render();
    api("/portal/results/" + item.campaignId, { method: "PUT", json: skip ? { skip: true } : { values: values } }).then(function (r) {
      RF.busy = false;
      if (r.ok) {
        RF.msg = { err: false, text: skip ? t("results.skipped") : t("results.thanks") };
        loadResults().then(render);
      } else {
        RF.msg = { err: true, text: both(r.data && r.data.message) || t("networkError") };
        render();
      }
    });
  }

  /* ---------- review and Your content (V2 Parts A and B) ---------- */
  function loadCamps() {
    return api("/portal/campaigns").then(function (r) {
      CAMPS = r.ok && r.data && r.data.campaigns ? r.data.campaigns : [];
    });
  }
  function campCards() {
    if (!CAMPS.length) return null;
    var cards = CAMPS.slice(0, 3).map(function (c) {
      var st = c.delivered ? "delivered" : c.reviewState;
      var btn = null;
      if (c.delivered) btn = h("button", { type: "button", class: "btn", text: t("camp.contentBtn"), onClick: function () { go("content-" + c.campaignId); } });
      else if (c.reviewState === "waiting") btn = h("button", { type: "button", class: "btn", text: t("camp.reviewBtn"), onClick: function () { go("campaign-" + c.campaignId); } });
      else btn = h("button", { type: "button", class: "btn secondary", text: t("camp.viewBtn"), onClick: function () { go("campaign-" + c.campaignId); } });
      return h("div", { class: "card camp-card" + (c.reviewState === "waiting" && !c.delivered ? " todo" : "") },
        h("div", { class: "kicker", text: t("camp.kicker") }),
        h("h2", { text: c.name }),
        h("span", { class: "pr-badge" + (st === "approved" || st === "delivered" ? " ok" : ""), text: t("camp." + st) }),
        btn);
    });
    return cards;
  }
  function loadCampaign(cp) {
    CV = { cp: cp, data: null, loading: true, error: false, answers: {}, busy: false, msg: null };
    api("/portal/campaign/" + cp).then(function (r) {
      CV.loading = false;
      if (r.ok) {
        CV.data = r.data;
        var rv = r.data.review;
        if (rv) rv.items.forEach(function (i) { CV.answers[i.key] = { verdict: i.verdict, comment: i.comment }; });
      } else CV.error = true;
      render();
    });
  }
  function sendReview(approve) {
    var rv = CV.data.review;
    var items = rv.view.cards.filter(function (c) { return CV.answers[c.key]; }).map(function (c) {
      var a = CV.answers[c.key];
      return { key: c.key, verdict: a.verdict, comment: a.comment || "" };
    });
    var missing = items.filter(function (i) { return i.verdict === "change" && !i.comment.trim(); });
    if (missing.length) {
      CV.msg = { err: true, text: t("approve.needComment") };
      render();
      return;
    }
    CV.busy = true;
    render();
    api("/portal/review/" + CV.cp, { method: "POST", json: { items: items, approve: !!approve, send: !approve } }).then(function (r) {
      CV.busy = false;
      if (r.ok) {
        rv.state = r.data.state;
        rv.decidedAt = new Date().toISOString();
        CV.msg = { err: false, text: r.data.state === "approved" ? t("approve.thanksApproved") : t("approve.thanksChanges") };
        loadCamps().then(render);
      } else {
        CV.msg = { err: true, text: both(r.data && r.data.message) || t("networkError") };
      }
      render();
      window.scrollTo(0, 0);
    });
  }
  function viewCampaign() {
    var cp = location.hash.replace("#campaign-", "");
    if (CV.cp !== cp) loadCampaign(cp);
    var back = h("div", { class: "actions" }, h("button", { type: "button", class: "btn secondary", text: t("approve.back"), onClick: function () { go("status"); } }));
    if (CV.loading) return [h("p", { class: "muted", text: t("loading") })];
    if (CV.error || !CV.data || !CV.data.review) return [h("div", { class: "card" }, h("p", { text: t("networkError") })), back];
    var rv = CV.data.review;
    var open = rv.state === "waiting";
    var cards = rv.view.cards;
    var changes = cards.filter(function (c) { return CV.answers[c.key] && CV.answers[c.key].verdict === "change"; }).length;
    var answered = cards.filter(function (c) { return CV.answers[c.key]; }).length;
    var head = h("div", { class: "head" }, h("div", { class: "kicker", text: t("approve.kicker") + " · " + t("camp.round", { n: rv.round }) }), h("h1", { text: CV.data.name }),
      h("p", { class: "lead", text: open ? t("approve.lead") : rv.state === "approved" ? t("approve.stateApproved", { date: fmtDate(rv.decidedAt) }) : t("approve.stateChanges", { date: fmtDate(rv.decidedAt) }) }));
    var list = cards.map(function (c) {
      var a = CV.answers[c.key];
      var title = (L === "en" ? c.title.en : c.title.sv) || c.title.en;
      var body = [h("div", { class: "rc-title" }, h("h2", { text: title }), a ? h("span", { class: "pr-badge" + (a.verdict === "ok" ? " ok" : ""), text: a.verdict === "ok" ? t("approve.ok") : t("approve.change") }) : null),
        h("p", { class: "rc-text", text: c.text })];
      if (c.link) body.push(h("p", { class: "muted small", text: t("approve.link") + ": " + (c.offerCode ? c.offerCode + " · " : "") + c.link }));
      if (open) {
        body.push(h("div", { class: "actions" },
          h("button", { type: "button", class: "btn small" + (a && a.verdict === "ok" ? "" : " secondary"), "aria-pressed": a && a.verdict === "ok" ? "true" : "false", text: t("approve.ok"), onClick: function () { CV.answers[c.key] = { verdict: "ok", comment: "" }; CV.msg = null; render(); } }),
          h("button", { type: "button", class: "btn small" + (a && a.verdict === "change" ? "" : " secondary"), "aria-pressed": a && a.verdict === "change" ? "true" : "false", text: t("approve.change"), onClick: function () { CV.answers[c.key] = { verdict: "change", comment: (a && a.comment) || "" }; CV.msg = null; render(); } })));
        if (a && a.verdict === "change") {
          var id = "rc_" + c.key.replace(/\W/g, "_");
          var ta = h("textarea", { id: id, maxlength: "1000", placeholder: t("approve.whatPh") });
          ta.value = a.comment || "";
          ta.addEventListener("input", function () { a.comment = ta.value; });
          body.push(h("label", { for: id, class: "small", text: t("approve.what") }), ta);
        }
      } else if (a && a.comment) body.push(h("p", { class: "muted small", text: "“" + a.comment + "”" }));
      return h("div", { class: "card review-card" }, body);
    });
    var foot = [];
    if (CV.msg) foot.push(h("p", { class: "msg " + (CV.msg.err ? "err" : "ok"), role: "status", text: CV.msg.text }));
    if (open) {
      foot.push(h("p", { class: "muted small", text: t("approve.answered", { a: answered, b: cards.length }) }));
      if (changes) foot.push(h("p", { class: "small", text: t("approve.blocked") }));
      foot.push(h("div", { class: "actions" },
        h("button", { type: "button", class: "btn", disabled: CV.busy || changes > 0, text: t("approve.approveAll"), onClick: function () { sendReview(true); } }),
        changes ? h("button", { type: "button", class: "btn secondary", disabled: CV.busy, text: t("approve.sendChanges", { n: changes }), onClick: function () { sendReview(false); } }) : null));
    }
    return [head, CV.msg && !open ? h("p", { class: "msg ok", role: "status", text: CV.msg.text }) : null, list, foot, back];
  }

  /* Your content */
  var CT = { cp: "", data: null, loading: false, zipping: false };
  function loadContent(cp) {
    CT = { cp: cp, data: null, loading: true, zipping: false };
    api("/portal/campaign/" + cp).then(function (r) {
      CT.loading = false;
      CT.data = r.ok ? r.data : null;
      render();
    });
  }
  function fmtSize(n) {
    return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function loadJsZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.src = "/grow/jszip.js";
      sc.onload = function () { res(window.JSZip); };
      sc.onerror = rej;
      document.head.appendChild(sc);
    });
  }
  function esc(x) {
    return String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function zipAll() {
    var d = CT.data;
    CT.zipping = true;
    render();
    var big = 50 * 1048576;
    loadJsZip().then(function (JSZip) {
      var zip = new JSZip();
      var html = "<!doctype html><html lang=\"" + d.content.view.language + "\"><head><meta charset=\"utf-8\"><title>" + esc(d.name) + "</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;line-height:1.55;color:#1d1c1a}h2{margin-top:32px;font-size:19px}pre{white-space:pre-wrap;font:inherit;background:#f6f4ef;padding:14px;border-radius:8px}</style></head><body><h1>" + esc(t("content.zipTitle", { name: d.name })) + "</h1>" +
        d.content.view.cards.map(function (c) { return "<h2>" + esc(L === "en" ? c.title.en : c.title.sv) + "</h2><pre>" + esc(c.copyText) + "</pre>"; }).join("") + "</body></html>";
      zip.file("texts.html", html);
      var files = d.content.files.filter(function (f) { return f.size <= big; });
      return Promise.all(files.map(function (f, i) {
        return fetch(f.url, { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("file"); return r.blob(); }).then(function (b) {
          var ext = (f.name.match(/\.[a-z0-9]{2,5}$/i) || [""])[0] || "." + (f.mime.split("/")[1] || "bin");
          zip.file((i + 1 < 10 ? "0" : "") + (i + 1) + "-" + (f.title || f.name || "file").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\w\- ]+/g, "_").slice(0, 60) + ext, b);
        });
      })).then(function () { return zip.generateAsync({ type: "blob" }); });
    }).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (d.name || "campaign").replace(/[^\w\- ]+/g, "_") + ".zip";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      CT.zipping = false;
      render();
    }, function () {
      CT.zipping = false;
      toast(t("networkError"), true);
      render();
    });
  }
  function viewContent() {
    var hsh = location.hash.replace("#", "");
    var delivered = CAMPS.filter(function (c) { return c.delivered; });
    var cp = hsh.indexOf("content-") === 0 ? hsh.slice(8) : (delivered[0] && delivered[0].campaignId) || "";
    var head = h("div", { class: "head" }, h("div", { class: "kicker", text: t("content.kicker") }), h("h1", { text: t("content.title") }), h("p", { class: "lead", text: t("content.lead") }));
    var back = h("div", { class: "actions" }, h("button", { type: "button", class: "btn secondary", text: t("approve.back"), onClick: function () { go("status"); } }));
    if (!cp) return [head, h("div", { class: "card" }, h("p", { text: t("content.none") })), back];
    if (CT.cp !== cp) loadContent(cp);
    if (CT.loading) return [head, h("p", { class: "muted", text: t("loading") })];
    var d = CT.data;
    if (!d || !d.content) return [head, h("div", { class: "card" }, h("p", { text: t("content.none") })), back];
    var c = d.content;
    var out = [head, h("h2", { class: "camp-name", text: d.name })];
    if (c.pageUrl) {
      out.push(h("div", { class: "card page-card" }, h("div", { class: "kicker", text: t("content.page") }),
        c.shortUrl ? h("div", {}, h("span", { class: "muted small", text: t("content.short") + " " }), h("a", { class: "page-url", href: c.shortUrl, target: "_blank", rel: "noopener", text: c.shortUrl.replace(/^https?:\/\//, "") })) : null,
        h("div", { class: "actions" },
          c.shortUrl ? h("button", { type: "button", class: "btn secondary", text: t("content.copy"), onClick: function (ev) { var b = ev.target; copyText(c.shortUrl, function () { b.textContent = t("content.copied"); }); } }) : null,
          h("a", { class: "btn secondary", href: c.pageUrl, target: "_blank", rel: "noopener", text: t("pages.open") }))));
    }
    out.push(h("div", { class: "actions" }, h("button", { type: "button", class: "btn", disabled: CT.zipping, text: CT.zipping ? t("content.zipping") : t("content.all"), onClick: zipAll })));
    if (c.files.some(function (f) { return f.size > 50 * 1048576; })) out.push(h("p", { class: "muted small", text: t("content.bigLeftOut") }));
    if (c.files.length) {
      out.push(h("h2", { text: t("content.files") }));
      out.push(h("div", { class: "files-grid" }, c.files.map(function (f) {
        return h("div", { class: "card file-card" },
          f.kind === "image" ? h("img", { src: f.url, alt: f.title || f.name, loading: "lazy" }) : h("div", { class: "file-icon", text: f.kind === "video" ? "VIDEO" : "PDF" }),
          h("div", { class: "small", text: (f.title || f.name) }),
          h("div", { class: "muted small", text: fmtSize(f.size) + (f.aiImage ? " · " + t("content.aiImage") : "") }),
          h("a", { class: "btn small secondary", href: f.url, download: "", text: t("content.download") }));
      })));
      out.push(h("p", { class: "muted small", text: t("content.expire", { m: c.linksExpireMinutes }) }));
    }
    out.push(h("h2", { text: t("content.texts") }));
    c.view.cards.forEach(function (card) {
      out.push(h("div", { class: "card review-card" },
        h("div", { class: "rc-title" }, h("h2", { text: L === "en" ? card.title.en : card.title.sv }),
          h("button", { type: "button", class: "btn small", text: t("content.copy"), onClick: function (ev) { var b = ev.target; copyText(card.copyText, function () { b.textContent = t("content.copied"); setTimeout(function () { b.textContent = t("content.copy"); }, 2500); }); } })),
        h("p", { class: "rc-text", text: card.copyText })));
    });
    var others = delivered.filter(function (x) { return x.campaignId !== cp; });
    if (others.length) {
      out.push(h("h2", { text: t("content.history") }));
      out.push(others.map(function (x) { return h("button", { type: "button", class: "btn secondary", text: x.name + " · " + x.month, onClick: function () { go("content-" + x.campaignId); } }); }));
    }
    out.push(back);
    return out;
  }

  /* ---------- boot ---------- */
  function loadState() {
    return api("/portal/state").then(function (r) {
      if (!r.ok) throw new Error("state");
      S = r.data;
      draft = S.draft;
      META.productName = S.productName || META.productName;
      META.contactEmail = S.consent.contactEmail || META.contactEmail;
      return S;
    });
  }

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () {
      setLang(b.getAttribute("data-lang"), true);
      render();
    });
  });
  document.getElementById("signOut").addEventListener("click", function () {
    var go2 = function () { api("/auth/logout", { method: "POST", json: {} }).then(function () { location.href = "/grow/"; }); };
    if (dirty) save().then(go2);
    else go2();
  });

  fetch("/grow/i18n.json").then(function (r) { return r.json(); }).then(function (d) {
    DICT = d;
    setLang(initialLang(), false);
    return api("/portal/meta");
  }).then(function (m) {
    if (m.ok) {
      META.productName = m.data.productName || META.productName;
      META.contactEmail = m.data.contactEmail || "";
    }
    return api("/auth/me");
  }).then(function (r) {
    if (!r.ok || !r.data.role) {
      ME = null;
      render();
      return;
    }
    ME = r.data;
    if (ME.role !== "client") {
      render();
      return;
    }
    return loadState().then(loadPhotos).then(loadPages).then(loadCamps).then(loadResults).then(function () {
      var stored = null;
      try { stored = localStorage.getItem("tv_lang"); } catch (e) {}
      if (S.client.language && !stored) setLang(S.client.language, false);
      render();
    });
  }).catch(function () {
    app.textContent = "";
    add(app, h("p", { class: "msg err", text: "Nätverksfel, ladda om sidan. / Network error, please reload the page." }));
  });
})();
