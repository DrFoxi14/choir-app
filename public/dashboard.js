const $ = (selector) => document.querySelector(selector);
const actionNames = {
  "conductor.song.created": "A creat o cântare",
  "conductor.song.published": "A publicat o cântare",
  "conductor.song.deleted": "A șters / arhivat o cântare",
  "conductor.song.delete_reauthentication_failed": "PIN greșit la tentativa de ștergere",
  "owner.audit_dashboard.viewed": "A deschis jurnalul de audit",
  "conductor.media.upload_started": "A început încărcarea unui fișier",
  "conductor.media.upload_completed": "A finalizat încărcarea unui fișier",
  "conductor.media.connection_diagnosed": "A testat conexiunea la stocare",
  "media.asset.download_link_issued": "A solicitat un link de descărcare",
  "conductor.attendance.saved": "A salvat prezența",
  "conductor.attendance.report_viewed": "A consultat raportul de prezență",
  "activation_code.created": "A creat o invitație",
  "activation_code.revoked": "A revocat o invitație",
  "account.reset_code.created": "A generat un cod de resetare",
  "account.login_code.renewed": "A reînnoit codul de conectare",
  "conductor.member_contacts.viewed": "A consultat lista privată de contacte",
  "account.preferences.updated": "A modificat preferințele contului",
  "legal.terms.accepted": "A acceptat documentele aplicației"
};
const detailNames = {
  title: "Cântare",
  sessionDate: "Data repetiției",
  date: "Data",
  voicePart: "Voce",
  format: "Format",
  resultingStatus: "Stare",
  mediaObjectsRetained: "Fișierele B2 au rămas stocate",
  memberCount: "Membri",
  sessionCount: "Repetiții",
  returnedCount: "Evenimente afișate",
  reason: "Motiv",
  corsPass: "CORS",
  signatureStatus: "Verificare semnătură",
  from: "De la",
  to: "Până la",
  role: "Rol"
};
let allLogs = [];

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "—" : date.toLocaleString("ro-RO", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}
function detailText(metadata) {
  if (!metadata || typeof metadata !== "object") return "—";
  const pairs = Object.entries(metadata).filter(([, value]) =>
    value !== null && ["string", "number", "boolean"].includes(typeof value)
  );
  if (!pairs.length) return "—";
  return pairs.map(([key, value]) => {
    const rendered = typeof value === "boolean" ? (value ? "Da" : "Nu") : String(value);
    return (detailNames[key] || key) + ": " + rendered;
  }).join(" · ");
}
function targetText(log) {
  const metaTitle = log.metadata && typeof log.metadata.title === "string" ? log.metadata.title : "";
  if (metaTitle) return metaTitle;
  if (!log.targetType) return "—";
  const typeNames = { song: "Cântare", song_asset: "Fișier", user: "Cont", choir: "Cor", attendance_session: "Repetiție", media_upload: "Upload" };
  const target = log.targetId ? " · " + String(log.targetId).slice(0, 8) : "";
  return (typeNames[log.targetType] || log.targetType) + target;
}
function renderLogs(logs) {
  const tbody = $("#audit-log-list");
  tbody.replaceChildren();
  if (!logs.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "Nu există evenimente care să corespundă căutării.";
    row.append(cell);
    tbody.append(row);
    return;
  }
  for (const log of logs) {
    const row = document.createElement("tr");
    const time = document.createElement("td");
    time.textContent = formatDate(log.createdAt);
    const actor = document.createElement("td");
    actor.textContent = (log.actorName || "Cont indisponibil") +
      (log.actorRole ? " · " + log.actorRole : "");
    const action = document.createElement("td");
    action.className = "audit-event";
    action.textContent = actionNames[log.action] || log.action || "Eveniment";
    const target = document.createElement("td");
    target.textContent = targetText(log);
    const details = document.createElement("td");
    details.className = "audit-details";
    details.textContent = detailText(log.metadata);
    row.append(time, actor, action, target, details);
    tbody.append(row);
  }
}
function applySearch() {
  const term = $("#audit-search").value.trim().toLocaleLowerCase("ro-RO");
  const visible = !term ? allLogs : allLogs.filter((log) => [
    log.actorName, log.actorRole, log.action, actionNames[log.action], targetText(log),
    detailText(log.metadata), log.createdAt
  ].join(" ").toLocaleLowerCase("ro-RO").includes(term));
  renderLogs(visible);
  $("#audit-loaded").textContent = String(visible.length);
}
async function loadLogs() {
  const button = $("#audit-refresh");
  button.disabled = true;
  $("#audit-status").textContent = "Se încarcă jurnalul…";
  try {
    const response = await fetch("/api/dashboard/logs?limit=200", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    let data = {};
    try { data = await response.json(); } catch { /* handled by status below */ }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        $("#audit-status").textContent = "Acces refuzat sau sesiune expirată. Revino la aplicație și conectează-te cu contul autorizat.";
      } else {
        $("#audit-status").textContent = data.message || "Nu am putut încărca jurnalul.";
      }
      allLogs = [];
      renderLogs([]);
      $("#audit-total").textContent = "—";
      $("#audit-loaded").textContent = "0";
      return;
    }
    allLogs = Array.isArray(data.logs) ? data.logs : [];
    $("#audit-total").textContent = String(data.totalCount ?? allLogs.length);
    $("#audit-status").textContent = "Jurnal încărcat. Înregistrările sunt numai pentru citire.";
    applySearch();
  } catch {
    $("#audit-status").textContent = "Eroare de rețea. Verifică conexiunea și reîncearcă.";
  } finally {
    button.disabled = false;
  }
}
$("#audit-refresh").addEventListener("click", loadLogs);
$("#audit-search").addEventListener("input", applySearch);
void loadLogs();
