const $ = (selector) => document.querySelector(selector);
const state = { attendanceMembers: [] };
const roleNames = { owner: "Dirijor principal", conductor: "Dirijor", member: "Membru" };
const voiceNames = { S: "Sopran", A: "Alto", T: "Tenor", B: "Bas" };
const attendanceStatusNames = { present: "Prezent", absent: "Absent", excused: "Motivat", late: "Întârziat" };

async function requestJSON(path, method = "GET", body = undefined) {
  const headers = { Accept: "application/json" };
  const options = { method, headers, credentials: "same-origin" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch { /* Non-JSON error response. */ }
  if (!response.ok) {
    const error = new Error(data.message || "Cererea nu a putut fi procesată.");
    error.status = response.status;
    error.code = data.error || "request_failed";
    throw error;
  }
  return data;
}
function setMessage(selector, message, kind = "") {
  const element = $(selector);
  element.textContent = message || "";
  element.classList.toggle("message-error", kind === "error");
  element.classList.toggle("message-success", kind === "success");
}
function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value == null ? "" : String(value);
  parent.append(element);
  return element;
}
function pageNotice(message, kind = "info") {
  const element = $("#attendance-page-notice");
  element.textContent = message;
  element.hidden = false;
  element.classList.remove("error", "success");
  if (kind === "error") element.classList.add("error");
  if (kind === "success") element.classList.add("success");
}
async function applySavedAccentTheme() {
  try {
    const data = await requestJSON("/api/account/preferences");
    const allowed = ["ocean", "violet", "emerald", "rose", "amber", "teal", "slate", "berry"];
    document.documentElement.dataset.accentTheme = allowed.includes(data.accentTheme) ? data.accentTheme : "ocean";
  } catch { /* Keep the default accent when preferences are unavailable. */ }
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

$("#attendance-reload").addEventListener("click", loadAttendanceRoster);
$("#attendance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
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

async function startAttendancePage() {
  try {
    const session = await requestJSON("/api/session");
    if (!session.authenticated || !session.user || session.legalAcceptanceRequired) {
      window.location.replace("/");
      return;
    }
    if (session.user.role !== "owner" && session.user.role !== "conductor") {
      $("#attendance-page-loading").hidden = true;
      pageNotice("Pagina de prezență este disponibilă numai dirijorilor.", "error");
      return;
    }
    await applySavedAccentTheme();
    $("#attendance-page-loading").hidden = true;
    $("#attendance-content").hidden = false;
    $("#attendance-user-line").textContent = session.user.displayName + " · " +
      (roleNames[session.user.role] || session.user.role);
    initializeAttendanceDates();
    await loadAttendanceRoster();
  } catch {
    $("#attendance-page-loading").hidden = true;
    pageNotice("Nu am putut verifica sesiunea. Conectează-te din nou din pagina principală.", "error");
  }
}
startAttendancePage();
