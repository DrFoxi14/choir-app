const $ = (selector) => document.querySelector(selector);
const roleNames = { owner: "Dirijor principal", conductor: "Dirijor", member: "Membru" };
const voiceNames = { S: "Sopran", A: "Alto", T: "Tenor", B: "Bas" };
const state = { user: null, members: [], invitations: [], issuedCode: "" };

async function requestJSON(path, method = "GET", body) {
  const headers = { Accept: "application/json" };
  const options = { method, headers, credentials: "same-origin" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch { /* The server did not return JSON. */ }
  if (!response.ok) {
    const error = new Error(data.message || "Cererea nu a putut fi procesată.");
    error.status = response.status;
    error.code = data.error || "request_failed";
    throw error;
  }
  return data;
}
function setNotice(message, kind = "info") {
  const element = $("#page-notice");
  element.textContent = message || "";
  element.classList.remove("error", "success");
  if (kind === "error") element.classList.add("error");
  if (kind === "success") element.classList.add("success");
  element.hidden = !message;
}
function setMessage(selector, message, kind = "") {
  const element = $(selector);
  element.textContent = message || "";
  element.classList.toggle("message-error", kind === "error");
  element.classList.toggle("message-success", kind === "success");
}
function showPanel(id) {
  for (const name of ["login-panel", "unlock-panel", "forbidden-panel", "dashboard-panel"]) {
    const element = $("#" + name);
    if (element) element.hidden = name !== id;
  }
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ro-RO", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}
function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value == null ? "" : String(value);
  parent.append(element);
  return element;
}
function phoneForWhatsApp(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = "40" + digits.slice(1);
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}
function renderContacts() {
  const list = $("#contact-list");
  const query = $("#contact-search").value.trim().toLocaleLowerCase("ro-RO");
  const members = state.members.filter((member) =>
    String(member.displayName || "").toLocaleLowerCase("ro-RO").includes(query) ||
    String(member.phoneNumber || "").toLocaleLowerCase("ro-RO").includes(query)
  );
  list.replaceChildren();
  $("#contacts-message").textContent = members.length
    ? "Afișați " + members.length + " din " + state.members.length + " conturi active."
    : "Nu există persoane care să corespundă căutării.";

  for (const member of members) {
    const phone = String(member.phoneNumber || "").trim();
    const verified = Boolean(Number(member.phoneVerified));
    const canManage = Boolean(state.user) && (state.user.role === "owner" || member.role === "member");
    const card = document.createElement("article");
    card.className = "contact-card";
    const main = document.createElement("div");
    const titleLine = document.createElement("div");
    titleLine.className = "contact-title-line";
    addText(titleLine, "h3", "contact-name", member.displayName);
    if (phone && verified) {
      const badge = document.createElement("span");
      badge.className = "verified-badge";
      badge.title = "Numărul a fost confirmat manual de un dirijor";
      const check = document.createElement("span");
      check.className = "verified-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      badge.append(check, document.createTextNode("Număr verificat"));
      titleLine.append(badge);
    } else if (phone) {
      addText(titleLine, "span", "unverified-badge", "Neverificat");
    }
    main.append(titleLine);

    const detailParts = [roleNames[member.role] || member.role];
    if (member.voicePart) detailParts.push(voiceNames[member.voicePart] || member.voicePart);
    addText(main, "p", "muted compact contact-meta", detailParts.join(" · "));
    addText(main, "p", "contact-phone", phone || "Număr de telefon nesetat");
    if (verified && member.phoneVerifiedBy) {
      const when = member.phoneVerifiedAt ? " · " + formatDate(member.phoneVerifiedAt) : "";
      addText(main, "p", "muted compact contact-meta", "Verificat de " + member.phoneVerifiedBy + when);
    }
    card.append(main);

    if (phone) {
      const actions = document.createElement("div");
      actions.className = "contact-actions";

      if (canManage) {
        const verifyButton = document.createElement("button");
        verifyButton.type = "button";
        verifyButton.className = verified ? "secondary-button" : "primary-button";
        verifyButton.textContent = verified ? "Elimină bifa" : "Confirmă numărul";
        verifyButton.addEventListener("click", () => openPhoneVerificationForm(member, actions, verifyButton));
        actions.append(verifyButton);
      }

      if (verified) {
        const waNumber = phoneForWhatsApp(phone);
        if (waNumber) {
          const whatsApp = document.createElement("a");
          whatsApp.className = "primary-button";
          whatsApp.href = "https://wa.me/" + waNumber + "?text=" + encodeURIComponent(
            "Salut! Îți scriu în legătură cu Corul Tabor."
          );
          whatsApp.target = "_blank";
          whatsApp.rel = "noopener noreferrer";
          whatsApp.textContent = "Scrie pe WhatsApp";
          actions.append(whatsApp);
        }
        const copy = document.createElement("button");
        copy.className = "secondary-button";
        copy.type = "button";
        copy.textContent = "Copiază numărul";
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(phone);
            copy.textContent = "Copiat";
          } catch {
            setNotice("Nu am putut copia automat numărul. Selectează-l manual.", "error");
          }
        });
        actions.append(copy);
      } else {
        addText(actions, "p", "contact-warning",
          "WhatsApp este dezactivat până când dirijorul confirmă numărul printr-un canal separat.");
      }

      if (canManage) {
        const resetButton = document.createElement("button");
        resetButton.className = "secondary-button";
        resetButton.type = "button";
        resetButton.textContent = "Cod resetare PIN";
        resetButton.addEventListener("click", () => runMemberAction(member, "reset"));

        const renewButton = document.createElement("button");
        renewButton.className = "secondary-button";
        renewButton.type = "button";
        renewButton.textContent = "Cod cont nou";
        renewButton.addEventListener("click", () => runMemberAction(member, "renew-login-code"));

        const changePhoneButton = document.createElement("button");
        changePhoneButton.className = "secondary-button";
        changePhoneButton.type = "button";
        changePhoneButton.textContent = "Schimbă numărul";
        changePhoneButton.addEventListener("click", () => runPhoneChangeAction(member));

        actions.append(resetButton, renewButton, changePhoneButton);
      }
      card.append(actions);
    } else if (state.user && (state.user.role === "owner" || member.role === "member")) {
      const actions = document.createElement("div");
      actions.className = "contact-actions";
      const changePhoneButton = document.createElement("button");
      changePhoneButton.className = "secondary-button";
      changePhoneButton.type = "button";
      changePhoneButton.textContent = "Setează numărul";
      changePhoneButton.addEventListener("click", () => runPhoneChangeAction(member));
      actions.append(changePhoneButton);
      card.append(actions);
    }
    list.append(card);
  }
}

function openPhoneVerificationForm(member, actions, trigger) {
  const existing = actions.querySelector(".verification-form");
  if (existing) return;
  trigger.hidden = true;

  const form = document.createElement("form");
  form.className = "verification-form form-stack";
  const label = document.createElement("label");
  label.textContent = "Confirmă cu PIN-ul tău din 6 cifre";
  const pinInput = document.createElement("input");
  pinInput.type = "password";
  pinInput.inputMode = "numeric";
  pinInput.pattern = "[0-9]{6}";
  pinInput.minLength = 6;
  pinInput.maxLength = 6;
  pinInput.autocomplete = "current-password";
  pinInput.required = true;
  label.htmlFor = "verification-pin-" + member.id;
  pinInput.id = label.htmlFor;
  const note = addText(form, "p", "muted compact",
    Boolean(Number(member.phoneVerified))
      ? "Bifa va fi eliminată. WhatsApp va fi ascuns până la o nouă verificare."
      : "Confirmă doar după ce ai verificat direct cu persoana că numărul îi aparține. Aceasta este o confirmare manuală a dirijorului.");
  const message = addText(form, "p", "form-message", "");
  message.setAttribute("role", "status");
  const actionsRow = document.createElement("div");
  actionsRow.className = "contact-actions";
  const submit = document.createElement("button");
  submit.className = "primary-button";
  submit.type = "submit";
  submit.textContent = Boolean(Number(member.phoneVerified)) ? "Elimină bifa" : "Confirmă numărul";
  const cancel = document.createElement("button");
  cancel.className = "secondary-button";
  cancel.type = "button";
  cancel.textContent = "Anulează";
  cancel.addEventListener("click", () => {
    form.remove();
    trigger.hidden = false;
  });
  actionsRow.append(submit, cancel);
  form.append(label, pinInput, note, actionsRow, message);
  actions.append(form);
  pinInput.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    setMessage("#contacts-message", "Se salvează starea verificării…");
    try {
      const nextVerified = !Boolean(Number(member.phoneVerified));
      const data = await requestJSON(
        "/api/conductor/members/" + encodeURIComponent(member.id) + "/phone-verification",
        "POST",
        { verified: nextVerified, pin: pinInput.value }
      );
      const target = state.members.find((item) => item.id === member.id);
      if (target) Object.assign(target, data);
      renderContacts();
      setNotice(data.message, "success");
    } catch (error) {
      setMessage(".verification-form .form-message", error.message, "error");
    } finally {
      submit.disabled = false;
      pinInput.value = "";
    }
  });
}

async function runMemberAction(member, action) {
  const explanation = action === "reset"
    ? "Cod de resetare PIN pentru " + member.displayName
    : "Noul cod de conectare pentru " + member.displayName;
  try {
    const response = await requestJSON(
      "/api/conductor/members/" + encodeURIComponent(member.id) + "/" + action,
      "POST", {}
    );
    showIssuedCode(response.code, response.message || explanation, explanation);
  } catch (error) {
    setNotice(error.message, "error");
  }
}
async function runPhoneChangeAction(member) {
  const phone = window.prompt("Introdu numărul de telefon nou pentru " + member.displayName + " (de ex. 0754 322 323):");
  if (phone === null || !phone.trim()) return;
  try {
    const response = await requestJSON(
      "/api/conductor/members/" + encodeURIComponent(member.id) + "/phone-change-code",
      "POST", { phone }
    );
    showIssuedCode(response.code, response.message, "Cod schimbare telefon · " + member.displayName);
  } catch (error) {
    setNotice(error.message, "error");
  }
}
async function unlockContacts(pin) {
  try {
    const data = await requestJSON("/api/conductor/contacts", "POST", { pin });
    state.members = Array.isArray(data.members) ? data.members : [];
    state.user = { ...(state.user || {}), role: data.actorRole || (state.user && state.user.role) };
    showPanel("dashboard-panel");
    $("#conductor-option").hidden = state.user.role !== "owner";
    if (state.user.role !== "owner" && $("#invitation-role").value === "conductor") {
      $("#invitation-role").value = "member";
    }
    renderContacts();
    await refreshInvitations();
    setNotice("Contactele au fost deblocate pentru această vizită.", "success");
  } catch (error) {
    if (error.status === 403) {
      showPanel("forbidden-panel");
      return;
    }
    showPanel("unlock-panel");
    setMessage("#unlock-message", error.message, "error");
  }
}
async function refreshInvitations() {
  try {
    const data = await requestJSON("/api/conductor/invitations");
    state.invitations = Array.isArray(data.invitations) ? data.invitations : [];
    renderInvitations();
  } catch (error) {
    setMessage("#invitations-message", error.message, "error");
  }
}
function renderInvitations() {
  const list = $("#invitation-list");
  list.replaceChildren();
  $("#invitations-message").textContent = state.invitations.length
    ? "Invitații nefolosite: " + state.invitations.length
    : "Nu există invitații active.";
  for (const invite of state.invitations) {
    const card = document.createElement("article");
    card.className = "contact-card";
    const main = document.createElement("div");
    const title = invite.role === "conductor"
      ? "Invitație pentru dirijor"
      : "Invitație pentru membru · " + (voiceNames[invite.voicePart] || invite.voicePart || "voce nealocată");
    addText(main, "h3", "contact-name", title);
    addText(main, "p", "muted compact contact-meta",
      "Creată de " + (invite.createdBy || "un dirijor") + " · expiră " + formatDate(invite.expiresAt));
    card.append(main);
    if (state.user.role === "owner" || invite.role === "member") {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "secondary-button";
      revoke.textContent = "Revocă";
      revoke.addEventListener("click", async () => {
        if (!confirm("Revoci această invitație? Codul nu va mai putea fi folosit.")) return;
        try {
          await requestJSON("/api/conductor/invitations/" + encodeURIComponent(invite.id) + "/revoke", "POST", {});
          await refreshInvitations();
          setMessage("#invite-message", "Invitație revocată.", "success");
        } catch (error) {
          setMessage("#invite-message", error.message, "error");
        }
      });
      card.append(revoke);
    }
    list.append(card);
  }
}
function updateInvitationForm() {
  const role = $("#invitation-role").value;
  $("#voice-group").hidden = role !== "member";
}
function showIssuedCode(code, message, heading) {
  state.issuedCode = code;
  $("#issued-code-title").textContent = heading || "Cod de invitație";
  $("#issued-code-value").textContent = code;
  $("#issued-code-description").textContent = message || "";
  $("#issued-code").hidden = false;
}
function clearIssuedCode() {
  state.issuedCode = "";
  $("#issued-code-value").textContent = "";
  $("#issued-code").hidden = true;
}
async function openForbiddenAfterLogin() {
  try { await requestJSON("/api/auth/logout", "POST", {}); } catch { /* Best effort cleanup. */ }
  state.user = null;
  showPanel("forbidden-panel");
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#login-message", "Se verifică datele…");
  const loginCode = $("#login-code").value.trim();
  const pin = $("#login-pin").value;
  try {
    const data = await requestJSON("/api/auth/login", "POST", { loginCode, pin });
    state.user = data.user || null;
    $("#login-pin").value = "";
    if (!state.user || !["owner", "conductor"].includes(state.user.role)) {
      await openForbiddenAfterLogin();
      return;
    }
    await unlockContacts(pin);
  } catch (error) {
    setMessage("#login-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  const pin = $("#unlock-pin").value;
  $("#unlock-pin").value = "";
  setMessage("#unlock-message", "Se verifică PIN-ul…");
  try {
    await unlockContacts(pin);
  } finally {
    button.disabled = false;
  }
});
$("#invitation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  clearIssuedCode();
  setMessage("#invite-message", "Se generează invitația…");
  const role = $("#invitation-role").value;
  try {
    const data = await requestJSON("/api/conductor/invitations", "POST", {
      role,
      voicePart: role === "member" ? $("#invitation-voice").value : null,
      phone: $("#invitation-phone").value
    });
    $("#invitation-phone").value = "";
    showIssuedCode(data.code, data.message,
      role === "conductor" ? "Cod de invitație pentru dirijor" : "Cod de invitație pentru membru");
    await refreshInvitations();
    setMessage("#invite-message", "Invitație creată.", "success");
  } catch (error) {
    setMessage("#invite-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#invitation-role").addEventListener("change", updateInvitationForm);
$("#contact-search").addEventListener("input", renderContacts);
$("#refresh-contacts").addEventListener("click", () => {
  state.members = [];
  $("#contact-list").replaceChildren();
  $("#contacts-message").textContent = "";
  showPanel("unlock-panel");
  $("#unlock-pin").value = "";
  $("#unlock-pin").focus();
});
$("#refresh-invitations").addEventListener("click", refreshInvitations);
$("#copy-code").addEventListener("click", async () => {
  if (!state.issuedCode) return;
  try {
    await navigator.clipboard.writeText(state.issuedCode);
    $("#copy-code").textContent = "Copiat";
  } catch {
    setMessage("#invite-message", "Selectează și copiază manual codul afișat.", "error");
  }
});
$("#hide-code").addEventListener("click", clearIssuedCode);
$("#logout-button").addEventListener("click", async () => {
  try { await requestJSON("/api/auth/logout", "POST", {}); } catch { /* Clear local view regardless. */ }
  state.user = null;
  state.members = [];
  state.invitations = [];
  clearIssuedCode();
  showPanel("login-panel");
  $("#login-code").value = "";
  $("#login-pin").value = "";
  setNotice("Te-ai deconectat.", "success");
});
$("#unlock-logout").addEventListener("click", async () => {
  try { await requestJSON("/api/auth/logout", "POST", {}); } catch { /* Clear local view regardless. */ }
  state.user = null;
  showPanel("login-panel");
});
async function start() {
  let status = {};
  let session = {};
  try { status = await requestJSON("/api/setup/status"); } catch { /* Show sign-in with status note below. */ }
  try { session = await requestJSON("/api/session"); } catch { /* An error will be displayed below. */ }

  if (!status.authenticationConfigured || !status.ownerExists) {
    showPanel("login-panel");
    if (!status.authenticationConfigured) {
      setNotice("Autentificarea nu este configurată complet. Pagina de contacte rămâne blocată până la finalizarea configurării serverului.", "error");
    } else if (status.setupAvailable) {
      setNotice("Configurarea inițială trebuie făcută înainte ca dirijorii să poată intra.", "error");
    } else {
      setNotice("Contul principal nu este încă activ. Contactează administratorul aplicației.", "error");
    }
    return;
  }
  if (session.authenticated && session.user) {
    state.user = session.user;
    if (!["owner", "conductor"].includes(session.user.role)) {
      showPanel("forbidden-panel");
      return;
    }
    showPanel("unlock-panel");
    return;
  }
  showPanel("login-panel");
}
start();
