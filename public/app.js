const roleNames = { owner: "Dirijor principal", conductor: "Dirijor", member: "Membru" };
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
const state = { user: null, issuedCode: "", pendingLegalUser: null, attendanceMembers: [] };
const accentThemeNames = {
  ocean: "Ocean", violet: "Violet", emerald: "Smarald", rose: "Roz închis",
  amber: "Chihlimbar", teal: "Turcoaz", slate: "Ardezie", berry: "Fructe de pădure"
};
const attendanceStatusNames = {
  present: "Prezent", absent: "Absent", excused: "Motivat", late: "Întârziat"
};

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
function applyAccentTheme(theme) {
  const selected = Object.prototype.hasOwnProperty.call(accentThemeNames, theme) ? theme : "ocean";
  document.documentElement.dataset.accentTheme = selected;
  const radio = document.querySelector('#preferences-form input[name="accentTheme"][value="' + selected + '"]');
  if (radio) radio.checked = true;
}
async function loadAccountPreferences() {
  try {
    const data = await requestJSON("/api/account/preferences");
    applyAccentTheme(data.accentTheme);
  } catch (error) {
    setMessage("#preferences-message", error.message, "error");
  }
}
function renderAttendanceRoster(members) {
  const container = $("#attendance-roster");
  container.replaceChildren();
  if (!members.length) {
    addText(container, "p", "muted compact", "Nu există membri activi în cor.");
    return;
  }
  for (const member of members) {
    const row = document.createElement("div");
    row.className = "attendance-row";
    const details = document.createElement("div");
    details.className = "attendance-member-details";
    addText(details, "span", "attendance-member-name", member.displayName);
    const metadata = (roleNames[member.role] || member.role) +
      (member.voicePart ? " · " + (voiceNames[member.voicePart] || member.voicePart) : "");
    addText(details, "span", "attendance-member-meta muted", metadata);
    const select = document.createElement("select");
    select.required = true;
    select.dataset.membershipId = member.membershipId;
    select.setAttribute("aria-label", "Prezență pentru " + member.displayName);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Alege statusul";
    select.append(placeholder);
    for (const [value, label] of Object.entries(attendanceStatusNames)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    row.append(details, select);
    container.append(row);
  }
}
async function loadAttendanceRoster() {
  setMessage("#attendance-message", "Se încarcă lista membrilor…");
  $("#attendance-roster").replaceChildren();
  try {
    const data = await requestJSON("/api/conductor/members");
    state.attendanceMembers = Array.isArray(data.members)
      ? data.members.filter((member) => member.membershipId && member.role)
      : [];
    renderAttendanceRoster(state.attendanceMembers);
    setMessage("#attendance-message", state.attendanceMembers.length
      ? "Alege un status pentru fiecare persoană, apoi salvează."
      : "Nu există membri activi în cor.");
  } catch (error) {
    setMessage("#attendance-message", error.message, "error");
  }
}
function initializeAttendanceDates() {
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") +
    "-" + String(now.getDate()).padStart(2, "0");
  if (!$("#attendance-date").value) $("#attendance-date").value = today;
  if (!$("#attendance-from").value) $("#attendance-from").value = today.slice(0, 7) + "-01";
  if (!$("#attendance-to").value) $("#attendance-to").value = today;
}
function xmlEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function excelColumn(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function joinBytes(chunks) {
  const length = chunks.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
function zipStored(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + filename.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, filename.length, true);
    lv.setUint16(28, 0, true);
    local.set(filename, 30);
    local.set(data, 30 + filename.length);
    localParts.push(local);

    const central = new Uint8Array(46 + filename.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, filename.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(filename, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralDirectory = joinBytes(centralParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, centralParts.length, true);
  ev.setUint16(10, centralParts.length, true);
  ev.setUint32(12, centralDirectory.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return joinBytes([...localParts, centralDirectory, end]);
}
function buildAttendanceMatrix(data) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const members = Array.isArray(data.members) ? data.members : [];
  const records = Array.isArray(data.records) ? data.records : [];
  const statusByMemberSession = new Map(records.map((record) => [
    record.membershipId + "|" + record.sessionId, attendanceStatusNames[record.status] || "—"
  ]));
  const header = ["Nume", "Rol", "Voce", ...sessions.map((session) => session.date + " — " + session.title)];
  const rows = members.map((member) => [
    member.displayName,
    roleNames[member.role] || member.role,
    voiceNames[member.voicePart] || "—",
    ...sessions.map((session) => statusByMemberSession.get(member.membershipId + "|" + session.id) || "—")
  ]);
  return { header, rows, sessions, members, from: data.from, to: data.to };
}
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadAttendanceXlsx(matrix) {
  const allRows = [matrix.header, ...matrix.rows];
  const lastColumn = excelColumn(matrix.header.length - 1);
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) =>
      '<c r="' + excelColumn(columnIndex) + (rowIndex + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlEscape(value) + "</t></is></c>"
    ).join("");
    return '<row r="' + (rowIndex + 1) + '">' + cells + "</row>";
  }).join("");
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      "</Types>",
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Prezență" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      "</Relationships>",
    "xl/worksheets/sheet1.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + sheetRows + '</sheetData><autoFilter ref="A1:' + lastColumn + allRows.length + '"/></worksheet>'
  };
  const archive = zipStored(files);
  downloadBlob("prezenta-" + matrix.from + "-pana-la-" + matrix.to + ".xlsx",
    new Blob([archive], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
function downloadAttendanceMarkdown(matrix) {
  const escapeCell = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [
    "# Prezență — Corul Tabor",
    "",
    "Interval: " + matrix.from + " – " + matrix.to,
    "",
    "| " + matrix.header.map(escapeCell).join(" | ") + " |",
    "| " + matrix.header.map(() => "---").join(" | ") + " |",
    ...matrix.rows.map((row) => "| " + row.map(escapeCell).join(" | ") + " |"),
    ""
  ];
  downloadBlob("prezenta-" + matrix.from + "-pana-la-" + matrix.to + ".md",
    new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }));
}
async function exportAttendance(format) {
  setMessage("#attendance-export-message", "Se pregătește raportul…");
  const from = $("#attendance-from").value;
  const to = $("#attendance-to").value;
  if (!from || !to || from > to) {
    setMessage("#attendance-export-message", "Alege un interval de date valid.", "error");
    return;
  }
  try {
    const data = await requestJSON("/api/conductor/attendance?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to));
    if (!Array.isArray(data.sessions) || data.sessions.length === 0) {
      setMessage("#attendance-export-message", "Nu există repetiții salvate în intervalul ales.", "error");
      return;
    }
    const matrix = buildAttendanceMatrix(data);
    if (format === "xlsx") downloadAttendanceXlsx(matrix);
    else downloadAttendanceMarkdown(matrix);
    setMessage("#attendance-export-message", "Raportul a fost generat și descărcat pe dispozitiv.", "success");
  } catch (error) {
    setMessage("#attendance-export-message", error.message, "error");
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
  loadAccountPreferences();
  initializeAttendanceDates();
  if (user.role === "owner" || user.role === "conductor") {
    showOnly("conductor");
    $("#conductor-role-badge").textContent = roleNames[user.role];
    loadSongs($("#conductor-voice").value, true);
    loadAttendanceRoster();
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
$("#preferences-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const selected = document.querySelector('#preferences-form input[name="accentTheme"]:checked');
  if (!selected) {
    setMessage("#preferences-message", "Alege o paletă de culori.", "error");
    return;
  }
  button.disabled = true;
  setMessage("#preferences-message", "Se salvează paleta…");
  try {
    const data = await requestJSON("/api/account/preferences", "POST", { accentTheme: selected.value });
    applyAccentTheme(data.accentTheme);
    setMessage("#preferences-message", data.message || "Paleta a fost salvată.", "success");
  } catch (error) {
    setMessage("#preferences-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
$("#phone-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#phone-message", "Se salvează numărul…");
  try {
    const data = await requestJSON("/api/account/phone", "POST", {
      phone: $("#account-phone").value,
      code: $("#account-phone-code").value,
      pin: $("#account-phone-pin").value
    });
    state.user.phoneNumber = data.phoneNumber;
    $("#account-phone").value = data.phoneNumber;
    $("#account-phone-pin").value = "";
    $("#account-phone-code").value = "";
    $("#account-current-phone").textContent = "Număr de telefon salvat: " + data.phoneNumber;
    setMessage("#phone-message", data.message || "Numărul a fost salvat.", "success");
  } catch (error) {
    setMessage("#phone-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#attendance-reload").addEventListener("click", loadAttendanceRoster);
$("#attendance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const selects = Array.from($("#attendance-roster").querySelectorAll("select[data-membership-id]"));
  if (!selects.length || selects.some((select) => !select.value)) {
    setMessage("#attendance-message", "Alege un status pentru fiecare persoană din listă.", "error");
    return;
  }
  button.disabled = true;
  setMessage("#attendance-message", "Se salvează prezența…");
  try {
    const data = await requestJSON("/api/conductor/attendance", "POST", {
      date: $("#attendance-date").value,
      title: $("#attendance-title").value,
      records: selects.map((select) => ({ membershipId: select.dataset.membershipId, status: select.value }))
    });
    setMessage("#attendance-message", data.message || "Prezența a fost salvată.", "success");
  } catch (error) {
    setMessage("#attendance-message", error.message, "error");
    if (error.code === "attendance_roster_changed") await loadAttendanceRoster();
  } finally {
    button.disabled = false;
  }
});
$("#attendance-export-xlsx").addEventListener("click", () => exportAttendance("xlsx"));
$("#attendance-export-md").addEventListener("click", () => exportAttendance("md"));
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
