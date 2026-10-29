const roleNames = { owner: "Dirijor", conductor: "Dirijor", member: "Membru" };
const voiceNames = { S: "Sopran", A: "Alto", T: "Tenor", B: "Bas" };
const $ = (selector) => document.querySelector(selector);

const screens = {
  setup: $("#setup-screen"),
  auth: $("#auth-screen"),
  member: $("#member-screen"),
  conductor: $("#conductor-screen"),
  legal: $("#legal-acceptance-screen"),
  code: $("#credentials-notice")
};
const state = { user: null, issuedCode: "", pendingLegalUser: null, mediaSongs: [] };

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
async function applySavedAccentTheme() {
  try {
    const data = await requestJSON("/api/account/preferences");
    const allowed = ["ocean", "violet", "emerald", "rose", "amber", "teal", "slate", "berry"];
    document.documentElement.dataset.accentTheme = allowed.includes(data.accentTheme) ? data.accentTheme : "ocean";
  } catch { /* Keep the accessible default accent when preferences are unavailable. */ }
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
function makeAssetButton(label, asset) {
  if (!asset) {
    const span = document.createElement("span");
    span.className = "asset-link disabled";
    span.textContent = label + " · indisponibil";
    span.setAttribute("aria-label", label + " indisponibil");
    return span;
  }
  const link = document.createElement("a");
  link.className = "asset-link";
  link.textContent = label;
  link.href = "/api/assets/" + encodeURIComponent(asset.id) + "/download";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "Deschide " + label + " pentru această cântare");
  return link;
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
    const assets = Array.isArray(song.assets) ? song.assets : [];
    const available = (format) => assets.find((asset) => asset.format === format && asset.voicePart === voice);
    const actions = document.createElement("div");
    actions.className = "asset-actions";
    actions.append(
      makeAssetButton("PDF", available("pdf")),
      makeAssetButton("Audio", available("audio")),
      makeAssetButton("Video", available("video"))
    );
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
      ? "Repertoriul pentru " + (voiceNames[voice] || voice) + ". Deschide fișierele publicate pentru verificare."
      : "Vocea ta: " + (voiceNames[data.voice] || voice) + ". Sunt disponibile numai materialele publicate pentru vocea ta.");
    renderSongs(listSelector, songs, data.voice || voice);
  } catch (error) {
    setMessage(messageSelector, error.message, "error");
  }
}
function mediaFormatName(format) {
  return format === "pdf" ? "PDF" : format === "audio" ? "Audio" : "Video";
}
function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "";
  const value = Number(bytes);
  if (value < 1024 * 1024) return Math.round(value / 1024) + " KB";
  if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + " MB";
  return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}
function renderConductorMediaSongs() {
  const container = $("#media-song-list");
  const select = $("#media-song-select");
  const selectedValue = select.value;
  container.replaceChildren();
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Alege o cântare";
  select.append(placeholder);
  for (const song of state.mediaSongs) {
    if (song.status !== "archived") {
      const option = document.createElement("option");
      option.value = song.id;
      option.textContent = song.title + (song.status === "draft" ? " · draft" : "");
      select.append(option);
    }
    const card = document.createElement("article");
    card.className = "song-card media-song-card";
    const heading = document.createElement("div");
    heading.className = "media-song-heading";
    addText(heading, "h4", "", song.title);
    addText(heading, "span", "media-status " + (song.status === "published" ? "published" : song.status === "archived" ? "archived" : "draft"),
      song.status === "published" ? "Publicată" : song.status === "archived" ? "Arhivată" : "Draft");
    card.append(heading);
    if (song.description) addText(card, "p", "muted compact", song.description);
    const assets = Array.isArray(song.assets) ? song.assets : [];
    if (assets.length) {
      const items = document.createElement("div");
      items.className = "media-asset-list";
      for (const asset of assets) {
        const row = document.createElement("div");
        row.className = "media-asset-row";
        const statusName = asset.status === "published" ? "publicat" : "draft";
        const name = (voiceNames[asset.voicePart] || asset.voicePart) + " · " + mediaFormatName(asset.format) +
          " · " + statusName + (asset.fileName ? " · " + asset.fileName : "") +
          (asset.sizeBytes ? " · " + formatFileSize(asset.sizeBytes) : "");
        addText(row, "span", "media-asset-name", name);
        if (asset.status !== "archived") {
          const open = document.createElement("a");
          open.className = "media-open-link";
          open.href = "/api/assets/" + encodeURIComponent(asset.id) + "/download";
          open.target = "_blank";
          open.rel = "noopener noreferrer";
          open.textContent = "Deschide";
          row.append(open);
        }
        items.append(row);
      }
      card.append(items);
    } else {
      addText(card, "p", "muted compact", "Niciun fișier încărcat.");
    }
    if (song.status !== "archived") {
      const adminActions = document.createElement("div");
      adminActions.className = "song-admin-actions";
      const deleteToggle = document.createElement("button");
      deleteToggle.className = "danger-button";
      deleteToggle.type = "button";
      deleteToggle.textContent = "Șterge cântarea";
      const deleteForm = document.createElement("form");
      deleteForm.className = "song-delete-form hidden";
      addText(deleteForm, "p", "warning-text",
        "Cântarea va fi scoasă din repertoriu. Fișierele din Backblaze B2 nu sunt șterse fizic.");
      const pinLabel = document.createElement("label");
      pinLabel.textContent = "Confirmă cu PIN-ul tău de dirijor (6 cifre)";
      const pinInput = document.createElement("input");
      pinInput.type = "password";
      pinInput.inputMode = "numeric";
      pinInput.pattern = "[0-9]{6}";
      pinInput.minLength = 6;
      pinInput.maxLength = 6;
      pinInput.autocomplete = "current-password";
      pinInput.required = true;
      const controls = document.createElement("div");
      controls.className = "inline-actions";
      const confirmDelete = document.createElement("button");
      confirmDelete.className = "danger-button";
      confirmDelete.type = "submit";
      confirmDelete.textContent = "Confirmă ștergerea";
      const cancelDelete = document.createElement("button");
      cancelDelete.className = "secondary-button";
      cancelDelete.type = "button";
      cancelDelete.textContent = "Anulează";
      cancelDelete.addEventListener("click", () => {
        pinInput.value = "";
        deleteForm.classList.add("hidden");
        deleteToggle.classList.remove("hidden");
      });
      deleteToggle.addEventListener("click", () => {
        deleteToggle.classList.add("hidden");
        deleteForm.classList.remove("hidden");
        pinInput.focus();
      });
      deleteForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        confirmDelete.disabled = true;
        setMessage("#media-upload-message", "Se confirmă identitatea și se scoate cântarea din repertoriu…");
        try {
          const result = await requestJSON(
            "/api/conductor/songs/" + encodeURIComponent(song.id) + "/delete",
            "POST",
            { pin: pinInput.value }
          );
          pinInput.value = "";
          setMessage("#media-upload-message", result.message || "Cântarea a fost scoasă din repertoriu.", "success");
          await loadConductorMedia();
          await loadSongs($("#conductor-voice").value, true);
        } catch (error) {
          setMessage("#media-upload-message", error.message, "error");
        } finally {
          confirmDelete.disabled = false;
        }
      });
      deleteForm.append(pinLabel, pinInput, controls);
      controls.append(confirmDelete, cancelDelete);
      adminActions.append(deleteToggle, deleteForm);
      card.append(adminActions);
    }
    if (song.status === "draft") {
      const publish = document.createElement("button");
      publish.className = "secondary-button media-publish-button";
      publish.type = "button";
      publish.textContent = "Publică cântarea";
      publish.disabled = assets.length === 0;
      publish.addEventListener("click", async () => {
        publish.disabled = true;
        setMessage("#media-upload-message", "Se publică materialele…");
        try {
          const result = await requestJSON("/api/conductor/songs/" + encodeURIComponent(song.id) + "/publish", "POST", {});
          setMessage("#media-upload-message", result.message || "Cântarea a fost publicată.", "success");
          await loadConductorMedia();
          await loadSongs($("#conductor-voice").value, true);
        } catch (error) {
          setMessage("#media-upload-message", error.message, "error");
          publish.disabled = false;
        }
      });
      card.append(publish);
    }
    container.append(card);
  }
  if (selectedValue && state.mediaSongs.some((song) => song.id === selectedValue && song.status !== "archived")) {
    select.value = selectedValue;
  }
  if (!state.mediaSongs.length) {
    addText(container, "p", "muted compact", "Nu există încă nicio cântare. Creează una mai sus.");
  }
}
async function runBackblazeDiagnostic() {
  const button = $("#media-storage-diagnose");
  button.disabled = true;
  setMessage("#media-diagnose-message", "Se testează semnătura și cele două variante CORS…");
  try {
    const result = await requestJSON("/api/conductor/media/diagnose");
    const signature = result.signature || {};
    const cors = result.cors || {};
    const methodOnly = cors.methodOnly || {};
    const withContentType = cors.withContentType || {};
    const parts = [
      "Semnătură: " + (signature.ok ? "OK" : "EȘEC") +
        " (HTTP " + signature.status + (signature.code ? ", " + signature.code : "") + ").",
      "CORS fără antet custom: " + (methodOnly.ok ? "OK" : "EȘEC") +
        " (HTTP " + methodOnly.status + (methodOnly.code ? ", " + methodOnly.code : "") + ").",
      "CORS cu content-type: " + (withContentType.ok ? "OK" : "EȘEC") +
        " (HTTP " + withContentType.status + (withContentType.code ? ", " + withContentType.code : "") + ").",
      methodOnly.allowOrigin ? "Origin (test 1): " + methodOnly.allowOrigin + "." : "Origin (test 1): lipsește.",
      methodOnly.allowMethods ? "Metode permise: " + methodOnly.allowMethods + "." : "Metode permise: lipsesc.",
      withContentType.allowHeaders ? "Antete permise: " + withContentType.allowHeaders + "." : "Antete permise: lipsesc."
    ];
    setMessage("#media-diagnose-message", parts.join(" "), signature.ok && cors.ok ? "success" : "error");
  } catch (error) {
    setMessage("#media-diagnose-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
}
$("#media-storage-diagnose").addEventListener("click", runBackblazeDiagnostic);

async function loadConductorMedia() {
  try {
    const data = await requestJSON("/api/conductor/songs");
    state.mediaSongs = Array.isArray(data.songs) ? data.songs : [];
    if (data.configured) {
      setMessage("#media-storage-status", "Backblaze B2 este configurat. Fișierele se încarcă direct în bucket-ul privat.", "success");
      $("#media-upload-form").querySelector('button[type="submit"]').disabled = false;
    } else {
      setMessage("#media-storage-status", "Backblaze B2 nu este configurat încă. Administratorul trebuie să adauge endpoint-ul, regiunea, bucket-ul și Application Key ca variabile/secrete în Cloudflare Workers.", "error");
      $("#media-upload-form").querySelector('button[type="submit"]').disabled = true;
    }
    renderConductorMediaSongs();
  } catch (error) {
    setMessage("#media-storage-status", error.message, "error");
    setMessage("#media-upload-message", "Nu am putut încărca biblioteca.", "error");
  }
}
$("#media-library-reload").addEventListener("click", loadConductorMedia);
$("#media-song-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setMessage("#media-song-create-message", "Se creează cântarea…");
  try {
    const result = await requestJSON("/api/conductor/songs", "POST", {
      title: $("#media-song-title").value,
      description: $("#media-song-description").value
    });
    form.reset();
    setMessage("#media-song-create-message", result.message || "Cântarea a fost creată.", "success");
    await loadConductorMedia();
    $("#media-song-select").value = result.song.id;
  } catch (error) {
    setMessage("#media-song-create-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#media-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const file = $("#media-file-input").files?.[0];
  const songId = $("#media-song-select").value;
  if (!file || !songId) {
    setMessage("#media-upload-message", "Alege cântarea și fișierul de încărcat.", "error");
    return;
  }
  button.disabled = true;
  setMessage("#media-upload-message", "Se pregătește încărcarea…");
  try {
    const upload = await requestJSON("/api/conductor/songs/" + encodeURIComponent(songId) + "/assets/upload-url", "POST", {
      voicePart: $("#media-voice-select").value,
      format: $("#media-format-select").value,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size
    });
    setMessage("#media-upload-message", "Se încarcă direct în Backblaze B2…");
    let uploadResponse;
    try {
      uploadResponse = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": upload.contentType },
        body: file
      });
    } catch {
      throw new Error("Browserul nu a putut citi răspunsul Backblaze. Poate fi preflight CORS, o semnătură respinsă sau o problemă de rețea. Apasă „Testează conexiunea B2” în Biblioteca de fișiere pentru a separa cauzele.");
    }
    if (!uploadResponse.ok) {
      throw new Error("Backblaze a respins fișierul (HTTP " + uploadResponse.status + "). Verifică CORS și permisiunile cheii pentru bucket.");
    }
    setMessage("#media-upload-message", "Fișierul a fost transferat. Se verifică integritatea…");
    const result = await requestJSON("/api/conductor/assets/complete", "POST", { uploadId: upload.uploadId });
    $("#media-file-input").value = "";
    setMessage("#media-upload-message", result.message || "Fișierul a fost încărcat.", "success");
    await loadConductorMedia();
    await loadSongs($("#conductor-voice").value, true);
  } catch (error) {
    setMessage("#media-upload-message", error.message, "error");
  } finally {
    const status = await requestJSON("/api/conductor/songs").catch(() => ({ configured: false }));
    button.disabled = !status.configured;
  }
});
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
  const adminDashboardLink = $("#admin-dashboard-link");
  if (adminDashboardLink) adminDashboardLink.classList.toggle("hidden", user.role !== "owner");
  hideNotice();
  $("#user-summary").textContent = user.displayName + " · " + (roleNames[user.role] || user.role);
  $("#user-summary").classList.remove("hidden");
  $("#logout-button").classList.remove("hidden");
  $("#account-settings-toggle").classList.remove("hidden");
  void applySavedAccentTheme();
  if (user.role === "owner" || user.role === "conductor") {
    showOnly("conductor");
    $("#conductor-role-badge").textContent = roleNames[user.role];
    loadSongs($("#conductor-voice").value, true);
    void loadConductorMedia();
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
  hideIssuedCode();
  showOnly("auth");
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
      pin,
      acceptedLegal: $("#setup-legal-accept").checked
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
      pin: $("#login-pin").value,
      acceptedLegal: $("#login-legal-accept").checked
    });
    $("#login-pin").value = "";
    setMessage("#login-message", "");
    enterApp(data.user);
  } catch (error) {
    if (error.code === "legal_acceptance_required") {
      $("#login-legal-accept-wrap").hidden = false;
      setMessage("#login-message", "Citește documentele și bifează acceptarea, apoi apasă din nou „Conectare”.", "error");
    } else {
      setMessage("#login-message", error.message, "error");
    }
  } finally {
    button.disabled = false;
  }
});
$("#activate-form").addEventListener("submit", async (event) => {
  const form = event.currentTarget;
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
      pin,
      acceptedLegal: $("#activation-legal-accept").checked
    });
    form.reset();
    enterApp(data.user);
    if (data.phoneLoginEnabled) {
      hideIssuedCode();
      showNotice("Cont activat. De acum te conectezi cu numărul de telefon și PIN-ul. Nu trebuie să memorezi niciun cod de cont.", "success");
    } else {
      showIssuedCode(data.loginCode, data.message, "Codul tău de conectare");
    }
  } catch (error) {
    setMessage("#activate-message", error.code === "legal_acceptance_required"
      ? "Bifează acceptarea Termenilor și confirmarea că ai citit Nota de informare."
      : error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#reset-form").addEventListener("submit", async (event) => {
  const form = event.currentTarget;
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
    form.reset();
    setMessage("#reset-message", data.message || "PIN actualizat. Conectează-te din nou.", "success");
    $("#login-code").value = $("#reset-login-code").value;
  } catch (error) {
    setMessage("#reset-message", error.message, "error");
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
$("#conductor-voice").addEventListener("change", () => loadSongs($("#conductor-voice").value, true));

$("#legal-acceptance-form").addEventListener("submit", async (event) => {
  const form = event.currentTarget;
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  if (!$("#existing-legal-accept").checked) return;
  button.disabled = true;
  setMessage("#legal-acceptance-message", "Se înregistrează acceptarea…");
  try {
    await requestJSON("/api/legal/accept", "POST", { acceptedLegal: true });
    const user = state.pendingLegalUser;
    state.pendingLegalUser = null;
    form.reset();
    if (user) enterApp(user);
    else await start();
  } catch (error) {
    setMessage("#legal-acceptance-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

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
    if (session.legalAcceptanceRequired) {
      state.pendingLegalUser = session.user;
      showOnly("legal");
      return;
    }
    enterApp(session.user);
    return;
  }
  showOnly("auth");
}
start();
