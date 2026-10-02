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
      phaseNote: "Brain Vault, fas 1. Kundportalen kommer i fas 2."
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
      phaseNote: "Brain Vault, phase 1. The client portal arrives in phase 2."
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
        tr.appendChild(td);
        body.appendChild(tr);
      });
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
