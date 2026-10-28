const $ = (selector) => document.querySelector(selector);
const roleNames = { owner: "Dirijor principal", conductor: "Dirijor", member: "Membru" };

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
function showNotice(message, kind = "info") {
  const notice = $("#account-notice");
  notice.textContent = message;
  notice.hidden = false;
  notice.classList.remove("error", "success");
  if (kind === "error") notice.classList.add("error");
  if (kind === "success") notice.classList.add("success");
}
function applyAccentTheme(theme) {
  const allowed = ["ocean", "violet", "emerald", "rose", "amber", "teal", "slate", "berry"];
  const selected = allowed.includes(theme) ? theme : "ocean";
  document.documentElement.dataset.accentTheme = selected;
  const radio = document.querySelector('#preferences-form input[name="accentTheme"][value="' + selected + '"]');
  if (radio) radio.checked = true;
}
async function loadPreferences() {
  try {
    const data = await requestJSON("/api/account/preferences");
    applyAccentTheme(data.accentTheme);
  } catch (error) {
    setMessage("#preferences-message", error.message, "error");
  }
}
$("#preferences-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
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
$("#phone-change-toggle").addEventListener("click", () => {
  const panel = $("#phone-change-panel");
  const open = panel.hidden;
  panel.hidden = !open;
  $("#phone-change-toggle").setAttribute("aria-expanded", String(open));
  $("#phone-change-toggle").textContent = open ? "Anulează schimbarea" : "Schimbă numărul";
  if (open) $("#account-phone").focus();
});
$("#phone-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setMessage("#phone-message", "Se salvează numărul…");
  try {
    const data = await requestJSON("/api/account/phone", "POST", {
      phone: $("#account-phone").value,
      code: $("#account-phone-code").value,
      pin: $("#account-phone-pin").value
    });
    $("#account-current-phone").textContent = "Număr de telefon salvat: " + data.phoneNumber;
    $("#phone-form").reset();
    $("#phone-change-panel").hidden = true;
    $("#phone-change-toggle").setAttribute("aria-expanded", "false");
    $("#phone-change-toggle").textContent = "Schimbă numărul";
    showNotice(data.message || "Numărul a fost schimbat.", "success");
  } catch (error) {
    setMessage("#phone-message", error.message, "error");
  } finally {
    button.disabled = false;
  }
});
async function startAccountPage() {
  try {
    const session = await requestJSON("/api/session");
    if (!session.authenticated || !session.user || session.legalAcceptanceRequired) {
      window.location.replace("/");
      return;
    }
    $("#account-loading").hidden = true;
    $("#account-content").hidden = false;
    $("#account-user-line").textContent =
      session.user.displayName + " · " + (roleNames[session.user.role] || session.user.role);
    $("#account-current-phone").textContent = session.user.phoneNumber
      ? "Număr de telefon salvat: " + session.user.phoneNumber
      : "Număr de telefon: încă nesetat";
    await loadPreferences();
  } catch {
    $("#account-loading").hidden = true;
    showNotice("Nu am putut verifica sesiunea. Conectează-te din nou din pagina principală.", "error");
  }
}
startAccountPage();
