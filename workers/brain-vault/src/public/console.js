/* Phase 1 test console for the Brain Vault.
   Lets anyone request a login link, shows who is signed in and in which role,
   and gives the admin an invite form and a client list. The real client portal
   (phase 2) and the ScriptForge Growth Clients panel (phase 3) replace this page. */
(function () {
  var API = "/api/vault";
  var T = {
    sv: {
      product: "Growth Department",
      loading: "Laddar...",
      signinTitle: "Logga in",
      signinIntro: "Skriv din e-postadress så skickar vi en inloggningslänk.",
      email: "E-postadress",
      sendLink: "Skicka inloggningslänk",
      signedIn: "Du är inloggad",
      roleClient: "Kund",
      roleAdmin: "Admin",
      viaVault: "Inloggad med magisk länk.",
      viaScriptforge: "Inloggad via ScriptForge.",
      clientOf: "Kundkonto: ",
      logout: "Logga ut",
      inviteTitle: "Bjud in en kund",
      clientName: "Namn",
      language: "Språk",
      invite: "Skicka inbjudan",
      clients: "Kunder",
      status: "Status",
      lastLogin: "Senast inloggad",
      resend: "Skicka igen",
      invited: "Inbjudan skickad till ",
      inviteFailed: "Kunden skapades men mejlet kunde inte skickas. Kontrollera e-postinställningarna.",
      invalidEmail: "Skriv en giltig e-postadress.",
      missingName: "Skriv kundens namn.",
      error: "Något gick fel. Försök igen.",
      never: "Aldrig",
      noClients: "Inga kunder än.",
      phaseNote: "Brain Vault. Kundportalen finns på /grow/. Hela kundpanelen kommer i ScriptForge i fas 3.",
      view: "Visa profil",
      version: "Version {v}, inskickad {d}",
      draftOnly: "Inte inskickad än, visar utkastet.",
      noIntake: "Kunden har inte börjat fylla i profilen.",
      openFile: "Öppna",
      F: { companyName: "Företagsnamn", website: "Webbplats", location: "Ort och område", productService: "Produkt eller tjänst", targetAudience: "Målgrupp", brandVoice: "Varumärkesröst", toneChips: "Tonord", usp: "USP", offers: "Erbjudanden", competitors: "Konkurrenter", reviews: "Kundomdömen", brandUse: "Ord att använda", brandAvoid: "Ord att undvika", campaignLanguage: "Kampanjspråk", answerLanguage: "Svarsspråk", pictures: "Bilder", founderStory: "Grundarens berättelse", previousPosts: "Tidigare inlägg", faqs: "Vanliga frågor", files: "Filer", consent: "Samtycke" }
    },
    en: {
      product: "Growth Department",
      loading: "Loading...",
      signinTitle: "Sign in",
      signinIntro: "Enter your email address and we will send you a login link.",
      email: "Email address",
      sendLink: "Send me a login link",
      signedIn: "You are signed in",
      roleClient: "Client",
      roleAdmin: "Admin",
      viaVault: "Signed in with a magic link.",
      viaScriptforge: "Signed in through ScriptForge.",
      clientOf: "Client account: ",
      logout: "Sign out",
      inviteTitle: "Invite a client",
      clientName: "Name",
      language: "Language",
      invite: "Send invite",
      clients: "Clients",
      status: "Status",
      lastLogin: "Last login",
      resend: "Resend",
      invited: "Invite sent to ",
      inviteFailed: "The client was created but the email could not be sent. Check the email settings.",
      invalidEmail: "Enter a valid email address.",
      missingName: "Enter the client's name.",
      error: "Something went wrong. Please try again.",
      never: "Never",
      noClients: "No clients yet.",
      phaseNote: "Brain Vault. The client portal is at /grow/. The full client panel arrives in ScriptForge in phase 3.",
      view: "View profile",
      version: "Version {v}, submitted {d}",
      draftOnly: "Not submitted yet, showing the draft.",
      noIntake: "The client has not started the profile.",
      openFile: "Open",
      F: { companyName: "Company name", website: "Website", location: "Location", productService: "Product or service", targetAudience: "Target audience", brandVoice: "Brand voice", toneChips: "Tone words", usp: "USP", offers: "Offers", competitors: "Competitors", reviews: "Reviews", brandUse: "Words to use", brandAvoid: "Words to avoid", campaignLanguage: "Campaign language", answerLanguage: "Answer language", pictures: "Pictures", founderStory: "Founder story", previousPosts: "Previous posts", faqs: "FAQs", files: "Files", consent: "Consent" }
    }
  };

  var lang = "sv";
  try {
    lang = localStorage.getItem("tv_lang") || "";
  } catch (e) {}
  if (lang !== "sv" && lang !== "en") lang = /^en/i.test(navigator.language || "") ? "en" : "sv";
  var current = null;

  function $(id) {
    return document.getElementById(id);
  }
  function t(k) {
    return T[lang][k] || k;
  }
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-lang]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang));
    });
    if (current) renderMe(current);
    if (current && current.role === "admin") loadClients();
  }
  function msg(id, text, cls) {
    var el = $(id);
    el.textContent = text;
    el.className = "msg " + (cls || "");
  }
  function both(m) {
    return m ? m[lang] || m.sv : t("error");
  }
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(
        function (d) {
          return { status: r.status, ok: r.ok, d: d };
        },
        function () {
          return { status: r.status, ok: false, d: {} };
        }
      );
    });
  }
  function show(id, on) {
    $(id).classList.toggle("hidden", !on);
  }
  function validEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  function renderMe(me) {
    $("meEmail").textContent = me.email;
    var role = $("meRole");
    role.textContent = me.role === "admin" ? t("roleAdmin") : t("roleClient");
    role.className = "badge " + (me.role === "admin" ? "admin" : "");
    var detail = me.via === "scriptforge" ? t("viaScriptforge") : t("viaVault");
    if (me.client) detail += " " + t("clientOf") + me.client.name + " (" + both(me.client.statusLabel) + ")";
    $("meDetail").textContent = detail;
  }

  function loadMe() {
    api("/auth/me").then(function (r) {
      show("loading", false);
      if (r.ok && r.d.role === "client") {
        location.replace("/grow/");
        return;
      }
      if (r.ok && r.d.role) {
        current = r.d;
        renderMe(r.d);
        show("me", true);
        show("signin", false);
        show("admin", r.d.role === "admin");
        if (r.d.role === "admin") loadClients();
      } else {
        current = null;
        show("me", false);
        show("admin", false);
        show("signin", true);
      }
    });
  }

  function cell(text) {
    var td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  function loadClients() {
    api("/admin/clients").then(function (r) {
      var body = $("clientRows");
      body.textContent = "";
      if (!r.ok) return;
      if (!r.d.clients.length) {
        var tr = document.createElement("tr");
        var td = cell(t("noClients"));
        td.colSpan = 5;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      r.d.clients.forEach(function (c) {
        var tr = document.createElement("tr");
        tr.appendChild(cell(c.name));
        tr.appendChild(cell(c.email));
        tr.appendChild(cell(both(c.statusLabel)));
        tr.appendChild(cell(c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString(lang === "sv" ? "sv-SE" : "en-GB") : t("never")));
        var td = document.createElement("td");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "ghost";
        b.textContent = t("resend");
        b.addEventListener("click", function () {
          b.disabled = true;
          api("/admin/clients/" + encodeURIComponent(c.id) + "/invite", { method: "POST", body: "{}" }).then(function (x) {
            b.disabled = false;
            msg("inviteMsg", x.ok && x.d.emailSent ? t("invited") + c.email : x.ok ? t("inviteFailed") : both(x.d.message), x.ok && x.d.emailSent ? "ok" : "err");
          });
        });
        td.appendChild(b);
        var vb = document.createElement("button");
        vb.type = "button";
        vb.className = "ghost";
        vb.textContent = t("view");
        vb.addEventListener("click", function () { viewIntake(c.id); });
        td.appendChild(vb);
        tr.appendChild(td);
        body.appendChild(tr);
      });
    });
  }


  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function fieldRow(label, value) {
    var wrap = el("div", null, "irow");
    wrap.appendChild(el("div", label, "ilabel"));
    var v = el("div", value == null || value === "" ? "-" : String(value), "ivalue");
    wrap.appendChild(v);
    return wrap;
  }
  function viewIntake(id) {
    api("/admin/intake/" + encodeURIComponent(id)).then(function (r) {
      var card = $("intakeCard");
      var body = $("intakeBody");
      body.textContent = "";
      card.classList.remove("hidden");
      if (!r.ok) {
        $("intakeTitle").textContent = t("error");
        return;
      }
      var d = r.d;
      var F = T[lang].F;
      $("intakeTitle").textContent = d.client.name;
      $("intakeMeta").textContent = d.source === "submitted"
        ? t("version").replace("{v}", d.version).replace("{d}", new Date(d.submittedAt).toLocaleString(lang === "sv" ? "sv-SE" : "en-GB"))
        : d.source === "draft" ? t("draftOnly") : t("noIntake");
      if (!d.intake) return;
      var p = d.intake.profile, u = d.intake.uploads;
      var join = function (a) { return (a || []).filter(Boolean).join(", "); };
      [
        [F.companyName, p.companyName], [F.website, p.website], [F.location, p.location], [F.productService, p.productService],
        [F.targetAudience, p.targetAudience], [F.brandVoice, p.brandVoice.text], [F.toneChips, join(p.brandVoice.toneChips)], [F.usp, p.usp],
        [F.offers, (p.offers || []).map(function (o) { return [o.offer, o.priceOrDiscount, o.validUntil].filter(Boolean).join(" | "); }).join("\n")],
        [F.competitors, (p.competitors || []).map(function (c) { return [c.name, c.website].filter(Boolean).join(" | "); }).join("\n")],
        [F.reviews, (p.reviews.pasted || []).join("\n")], [F.brandUse, join(p.brandWords.use)], [F.brandAvoid, join(p.brandWords.avoid)],
        [F.campaignLanguage, d.intake.campaignLanguage], [F.answerLanguage, d.intake.answerLanguage],
        [F.founderStory, u.founderStory.text],
        [F.previousPosts, (u.previousPosts || []).filter(function (x) { return x.type !== "image"; }).map(function (x) { return x.value; }).join("\n")],
        [F.faqs, (u.faqs.rows || []).map(function (q) { return "Q: " + q.q + "\nA: " + q.a; }).join("\n\n")],
        [F.consent, d.intake.consent ? d.intake.consent.version + ", " + d.intake.consent.acceptedAt : ""]
      ].forEach(function (row) { body.appendChild(fieldRow(row[0], row[1])); });
      var pics = d.files.filter(function (f) { return /^image\//.test(f.mime); });
      if (pics.length) {
        body.appendChild(el("div", F.pictures, "ilabel"));
        var grid = el("div", null, "igrid");
        pics.forEach(function (f) {
          var a = document.createElement("a");
          a.href = f.url;
          a.target = "_blank";
          a.rel = "noopener";
          var img = document.createElement("img");
          img.src = f.url;
          img.alt = f.name || "";
          img.loading = "lazy";
          a.appendChild(img);
          grid.appendChild(a);
        });
        body.appendChild(grid);
      }
      var docs = d.files.filter(function (f) { return !/^image\//.test(f.mime); });
      if (docs.length) {
        body.appendChild(el("div", F.files, "ilabel"));
        docs.forEach(function (f) {
          var a = document.createElement("a");
          a.href = f.url;
          a.textContent = (f.name || f.id) + " (" + f.section + ")";
          a.className = "ifile";
          body.appendChild(a);
        });
      }
      card.scrollIntoView({ behavior: "smooth" });
    });
  }

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () {
      lang = b.getAttribute("data-lang");
      try {
        localStorage.setItem("tv_lang", lang);
      } catch (e) {}
      applyLang();
    });
  });

  $("signinForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var email = $("email").value.trim();
    if (!validEmail(email)) return msg("signinMsg", t("invalidEmail"), "err");
    var btn = ev.target.querySelector("button");
    btn.disabled = true;
    api("/auth/request-link", { method: "POST", body: JSON.stringify({ email: email, lang: lang }) }).then(function (r) {
      btn.disabled = false;
      msg("signinMsg", both(r.d.message), r.ok ? "ok" : "err");
    });
  });

  $("logout").addEventListener("click", function () {
    api("/auth/logout", { method: "POST", body: "{}" }).then(function () {
      loadMe();
    });
  });

  $("inviteForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var name = $("cName").value.trim();
    var email = $("cEmail").value.trim();
    if (!name) return msg("inviteMsg", t("missingName"), "err");
    if (!validEmail(email)) return msg("inviteMsg", t("invalidEmail"), "err");
    var btn = ev.target.querySelector("button");
    btn.disabled = true;
    api("/admin/clients", {
      method: "POST",
      body: JSON.stringify({ name: name, email: email, language: $("cLang").value })
    }).then(function (r) {
      btn.disabled = false;
      if (r.ok) {
        msg("inviteMsg", r.d.emailSent ? t("invited") + email : t("inviteFailed"), r.d.emailSent ? "ok" : "err");
        $("cName").value = "";
        $("cEmail").value = "";
        loadClients();
      } else {
        msg("inviteMsg", both(r.d.message), "err");
      }
    });
  });

  applyLang();
  loadMe();
})();
