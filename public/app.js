const roleNames = { owner: "Dirijor principal", conductor: "Dirijor", member: "Membru" };
const voiceNames = { S: "Sopran", A: "Alto", T: "Tenor", B: "Bas" };
const $ = (selector) => document.querySelector(selector);

const screens = {
  setup: $("#setup-screen"),
  auth: $("#auth-screen"),
  member: $("#member-screen"),
  conductor: $("#conductor-screen"),
  code: $("#credentials-notice")
};
const state = { user: null, issuedCode: "" };

async function requestJSON(path, method = "GET", body = undefined) {
  const headers = { Accept: "application/json" };
  const options = { method, headers, credentials: "same-origin" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch { /* Response was not JSON. */ }
  if (!response.ok) {
    const error = new Error(data.message || "Cererea nu a putut fi procesată.");
    error.status = response.status;
    error.code = data.error || "request_failed";
    throw error;
  }
  return data;
}

function showNotice(message, kind = "info") {
  const notice = $("#configuration-notice");
  notice.textContent = message;
  notice.classList.remove("hidden", "notice-error", "notice-success");
  if (kind === "error") notice.classList.add("notice-error");
  if (kind === "success") notice.classList.add("notice-success");
}
function hideNotice() {
  $("#configuration-notice").classList.add("hidden");
}
function showOnly(screenName) {
  for (const [name, screen] of Object.entries(screens)) {
    if (name !== "code") screen.classList.toggle("hidden", name !== screenName);
  }
  if (screenName !== "setup" && screenName !== "auth") {
    $("#logout-button").classList.remove("hidden");
  } else {
    $("#logout-button").classList.add("hidden");
  }
}
function setMessage(selector, message, kind = "") {
  const element = $(selector);
  element.textContent = message || "";
  element.classList.toggle("message-error", kind === "error");
  element.classList.toggle("message-success", kind === "success");
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
function makeAssetButton(label) {
  const span = document.createElement("span");
  span.className = "asset-link disabled";
  span.textContent = label + " · indisponibil";
  span.setAttribute("aria-label", label + " indisponibil");
  return span;
}
function renderSongs(containerSelector, songs, voice) {
  const list = $(containerSelector);
  list.replaceChildren();
  if (!songs.length) return;
  for (const song of songs) {
    const card = document.createElement("article");
    card.className = "song-card";
    addText(card, "h3", "", song.title);
    if (song.description) addText(card, "p", "muted song-description", song.description);
    const actions = document.createElement("div");
    actions.className = "asset-actions";
    actions.append(makeAssetButton("PDF"), makeAssetButton("Audio"), makeAssetButton("Video"));
    card.append(actions);
    list.append(card);
  }
}
async function loadSongs(voice, conductor = false) {
  const messageSelector = conductor ? "#conductor-catalog-message" : "#catalog-message";
  const listSelector = conductor ? "#conductor-song-list" : "#song-list";
  setMessage(messageSelector, "Se încarcă repertoriul…");
  $(listSelector).replaceChildren();
  try {
    const data = await requestJSON("/api/songs" + (conductor ? "?voice=" + encodeURIComponent(voice) : ""));
    const songs = Array.isArray(data.songs) ? data.songs : [];
    if (!songs.length) {
      setMessage(messageSelector, "Nu există încă nicio cântare publicată.");
      return;
    }
    setMessage(messageSelector, conductor
      ? "Repertoriul pentru " + (voiceNames[voice] || voice) + ". Fișierele vor fi activate după configurarea livrării private."
      : "Vocea ta: " + (voiceNames[data.voice] || voice) + ". Fișierele vor apărea după publicarea materialelor.");
    renderSongs(listSelector, songs, data.voice || voice);
  } catch (error) {
    setMessage(messageSelector, error.message, "error");
  }
}
function showIssuedCode(code, message, label = "Notează acest cod") {
  state.issuedCode = code || "";
  $("#credentials-title").textContent = label;
  $("#issued-code-message").textContent = message || "Păstrează codul într-un loc sigur. Nu este stocat în clar și nu poate fi afișat din nou.";
  $("#issued-code").textContent = code || "";
  $("#copy-code-button").textContent = "Copiază codul";
  screens.code.classList.remove("hidden");
  screens.code.scrollIntoView({ behavior: "smooth", block: "center" });
}
function hideIssuedCode() {
  screens.code.classList.add("hidden");
  state.issuedCode = "";
}
function enterApp(user) {
  state.user = user;
  hideNotice();
  $("#user-summary").textContent = user.displayName + " · " + (roleNames[user.role] || user.role);
  $("#user-summary").classList.remove("hidden");
  $("#logout-button").classList.remove("hidden");
  $("#account-settings-toggle").classList.remove("hidden");
  $("#account-phone").value = user.phoneNumber || "";
  $("#account-current-phone").textContent = user.phoneNumber
    ? "Număr de telefon salvat: " + user.phoneNumber
    : "Număr de telefon: încă nesetat";
  $("#account-phone-pin").value = "";
  $("#phone-message").textContent = "";
  if (user.role === "owner" || user.role === "conductor") {
    showOnly("conductor");
    $("#conductor-role-badge").textContent = roleNames[user.role];
    $("#conductor-invite-option").hidden = user.role !== "owner";
    if (user.role !== "owner" && $("#invitation-role").value === "conductor") {
      $("#invitation-role").value = "member";
    }
    updateInvitationForm();
    refreshConductorData();
    loadSongs($("#conductor-voice").value, true);
  } else {
    showOnly("member");
    $("#voice-badge").textContent = voiceNames[user.voicePart] || "Voce nealocată";
    loadSongs(user.voicePart, false);
  }
  checkHealth();
}
function leaveApp() {
  state.user = null;
  $("#user-summary").classList.add("hidden");
  $("#logout-button").classList.add("hidden");
  $("#account-settings-toggle").classList.add("hidden");
  $("#account-settings-toggle").setAttribute("aria-expanded", "false");
  $("#account-settings").classList.add("hidden");
  hideIssuedCode();
  showOnly("auth");
}
function updateInvitationForm() {
  const isConductorInvite = $("#invitation-role").value === "conductor";
  $("#invitation-voice-group").classList.toggle("hidden", isConductorInvite);
  $("#invitation-voice").required = !isConductorInvite;
}
async function checkHealth() {
  try {
    const data = await requestJSON("/api/health");
    $("#app-status").textContent = data.databaseConfigured
      ? "Serviciul este disponibil"
      : "Configurare inițială în curs";
  } catch {
    $("#app-status").textContent = "Starea serviciului nu este disponibilă";
  }
}
async function refreshConductorData() {
  setMessage("#members-message", "Se încarcă membrii…");
  setMessage("#invitations-message", "Se încarcă invitațiile…");
  try {
    const data = await requestJSON("/api/conductor/members");
    renderMembers(data.members || [], data.actorRole || state.user.role);
    setMessage("#members-message", (data.members || []).length
      ? "Conturi active: " + data.members.length
      : "Nu există încă membri activați.");
  } catch (error) {
    setMessage("#members-message", error.message, "error");
  }
  try {
    const data = await requestJSON("/api/conductor/invitations");
    renderInvitations(data.invitations || [], data.actorRole || state.user.role);
    setMessage("#invitations-message", (data.invitations || []).length
      ? "Invitații nefolosite: " + data.invitations.length
      : "Nu există invitații active.");
  } catch (error) {
    setMessage("#invitations-message", error.message, "error");
  }
}
function renderMembers(members, actorRole) {
  const list = $("#member-list");
  list.replaceChildren();
  for (const member of members) {
    const card = document.createElement("article");
    card.className = "managed-card";
    const main = document.createElement("div");
    main.className = "managed-card-main";
    addText(main, "strong", "managed-name", member.displayName);
    const details = [roleNames[member.role] || member.role];
    if (member.voicePart) details.push(voiceNames[member.voicePart] || member.voicePart);
    details.push("Adăugat: " + formatDate(member.joinedAt));
    addText(main, "p", "muted compact", details.join(" · "));
    card.append(main);
    const canManage = actorRole === "owner" || member.role === "member";
    if (canManage) {
      const actions = document.createElement("div");
      actions.className = "managed-actions";
      const resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "secondary-button";
      resetButton.textContent = "Cod resetare PIN";
      resetButton.addEventListener("click", () => runMemberAction(member, "reset"));
      const renewButton = document.createElement("button");
      renewButton.type = "button";
      renewButton.className = "secondary-button";
      renewButton.textContent = "Cod cont nou";
      renewButton.addEventListener("click", () => runMemberAction(member, "renew-login-code"));
      actions.append(resetButton, renewButton);
      card.append(actions);
    }
    list.append(card);
  }
}
function renderInvitations(invitations, actorRole) {
  const list = $("#invitation-list");
  list.replaceChildren();
  for (const invite of invitations) {
    const card = document.createElement("article");
    card.className = "managed-card";
    const main = document.createElement("div");
    main.className = "managed-card-main";
    const inviteType = invite.role === "conductor"
      ? "Invitație pentru dirijor"
      : "Invitație pentru membru · " + (voiceNames[invite.voicePart] || invite.voicePart || "voce nealocată");
    addText(main, "strong", "managed-name", inviteType);
    addText(main, "p", "muted compact",
      "Creată de " + (invite.createdBy || "un dirijor") + " · expiră " + formatDate(invite.expiresAt));
    card.append(main);
    if (actorRole === "owner" || invite.role === "member") {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "secondary-button danger-button";
      revoke.textContent = "Revocă";
      revoke.addEventListener("click", async () => {
        if (!confirm("Revoci această invitație? Codul nu va mai putea fi folosit.")) return;
        try {
          await requestJSON("/api/conductor/invitations/" + encodeURIComponent(invite.id) + "/revoke", "POST", {});
          setMessage("#invitation-message", "Invitație revocată.", "success");
          await refreshConductorData();
        } catch (error) {
          setMessage("#invitation-message", error.message, "error");
        }
      });
      card.append(revoke);
    }
    list.append(card);
  }
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
    showNotice(error.message, "error");
  }
}

$("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const pin = $("#setup-pin").value;
  if (pin !== $("#setup-pin-confirm").value) {
    setMessage("#setup-message", "Cele două valori PIN nu coincid.", "error");
    return;
  }
  button.disabled = true;
  setMessage("#setup-message", "Se creează contul…");
  try {
    const data = await requestJSON("/api/setup/bootstrap", "POST", {
      displayName: $("#setup-name").value,
      setupKey: $("#setup-key").value,
      pin
    });
    $("#setup-key").value = "";
    $("#setup-pin").value = "";
    $("#setup-pin-confirm").value = "";
    enterApp(data.user);
    showIssuedCode(data.loginCode,
      "Acesta este codul tău de conectare. Notează-l înainte să închizi această fereastră; nu poate fi afișat din nou. După configurare, șterge secretul BOOTSTRAP_SETUP_KEY din Cloudflare Worker → Settings → Variables and Secrets.",
      "Codul contului principal");
  } catch (error) {
    setMessage("#setup-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#login-message", "Se verifică datele…");
  try {
    const data = await requestJSON("/api/auth/login", "POST", {
      loginCode: $("#login-code").value,
      pin: $("#login-pin").value
    });
    $("#login-pin").value = "";
    setMessage("#login-message", "");
    enterApp(data.user);
  } catch (error) {
    setMessage("#login-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#activate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = $("#activation-pin").value;
  if (pin !== $("#activation-pin-confirm").value) {
    setMessage("#activate-message", "Cele două valori PIN nu coincid.", "error");
    return;
  }
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#activate-message", "Se activează contul…");
  try {
    const data = await requestJSON("/api/auth/activate", "POST", {
      code: $("#activation-code").value,
      displayName: $("#activation-name").value,
      phone: $("#activation-phone").value,
      pin
    });
    event.currentTarget.reset();
    enterApp(data.user);
    if (data.phoneLoginEnabled) {
      hideIssuedCode();
      showNotice("Cont activat. De acum te conectezi cu numărul de telefon și PIN-ul. Nu trebuie să memorezi niciun cod de cont.", "success");
    } else {
      showIssuedCode(data.loginCode, data.message, "Codul tău de conectare");
    }
  } catch (error) {
    setMessage("#activate-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("#reset-pin").value !== $("#reset-pin-confirm").value) {
    setMessage("#reset-message", "Cele două valori PIN nu coincid.", "error");
    return;
  }
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#reset-message", "Se resetează PIN-ul…");
  try {
    const data = await requestJSON("/api/auth/reset-access", "POST", {
      loginCode: $("#reset-login-code").value,
      resetCode: $("#reset-code").value,
      pin: $("#reset-pin").value
    });
    event.currentTarget.reset();
    setMessage("#reset-message", data.message || "PIN actualizat. Conectează-te din nou.", "success");
    $("#login-code").value = $("#reset-login-code").value;
  } catch (error) {
    setMessage("#reset-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#account-settings-toggle").addEventListener("click", () => {
  const panel = $("#account-settings");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  $("#account-settings-toggle").setAttribute("aria-expanded", opening ? "true" : "false");
  if (opening) panel.scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#account-settings-close").addEventListener("click", () => {
  $("#account-settings").classList.add("hidden");
  $("#account-settings-toggle").setAttribute("aria-expanded", "false");
});
$("#phone-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#phone-message", "Se salvează numărul…");
  try {
    const data = await requestJSON("/api/account/phone", "POST", {
      phone: $("#account-phone").value,
      pin: $("#account-phone-pin").value
    });
    state.user.phoneNumber = data.phoneNumber;
    $("#account-phone").value = data.phoneNumber;
    $("#account-phone-pin").value = "";
    $("#account-current-phone").textContent = "Număr de telefon salvat: " + data.phoneNumber;
    setMessage("#phone-message", data.message || "Numărul a fost salvat.", "success");
  } catch (error) {
    setMessage("#phone-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#logout-button").addEventListener("click", async () => {
  try { await requestJSON("/api/auth/logout", "POST", {}); } catch { /* Always return to sign-in. */ }
  leaveApp();
  showNotice("Te-ai deconectat.", "success");
});
$("#copy-code-button").addEventListener("click", async () => {
  if (!state.issuedCode) return;
  try {
    await navigator.clipboard.writeText(state.issuedCode);
    $("#copy-code-button").textContent = "Copiat";
  } catch {
    setMessage("#issued-code-message", "Selectează și copiază manual codul afișat mai sus.");
  }
});
$("#hide-code-button").addEventListener("click", hideIssuedCode);
$("#invitation-role").addEventListener("change", updateInvitationForm);
$("#invitation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#invitation-message", "Se generează invitația…");
  const role = $("#invitation-role").value;
  try {
    const data = await requestJSON("/api/conductor/invitations", "POST", {
      role,
      voicePart: role === "member" ? $("#invitation-voice").value : null
    });
    setMessage("#invitation-message", "Invitație creată.", "success");
    showIssuedCode(data.code, data.message, role === "conductor" ? "Cod de invitație pentru dirijor" : "Cod de invitație pentru membru");
    await refreshConductorData();
  } catch (error) {
    setMessage("#invitation-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#refresh-members").addEventListener("click", refreshConductorData);
$("#refresh-invitations").addEventListener("click", refreshConductorData);
$("#conductor-voice").addEventListener("change", () => loadSongs($("#conductor-voice").value, true));

async function start() {
  await checkHealth();
  let status = {};
  let session = {};
  try { status = await requestJSON("/api/setup/status"); } catch { /* Shown below as configuration issue. */ }
  try { session = await requestJSON("/api/session"); } catch { /* Sign-in screen remains available. */ }

  if (!status.authenticationConfigured) {
    showOnly("auth");
    showNotice("Autentificarea nu este încă configurată pe server. Administratorul trebuie să configureze AUTH_SECRET și să aplice migrarea D1 înainte de activarea conturilor.", "error");
    return;
  }
  if (status.setupAvailable) {
    showOnly("setup");
    return;
  }
  if (!status.ownerExists) {
    showOnly("auth");
    showNotice("Contul principal nu este încă configurat. Administratorul trebuie să configureze cheia BOOTSTRAP_SETUP_KEY în Cloudflare pentru a porni sistemul.", "error");
    return;
  }
  if (session.authenticated && session.user) {
    enterApp(session.user);
    return;
  }
  showOnly("auth");
}
start();
