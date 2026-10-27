const VOICE_KEY = "choir-app.voice.v1";
const voiceNames = { S: "Soprano", A: "Alto", T: "Tenor", B: "Bass" };
const iconSvg = {
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>'
};

const voiceScreen = document.querySelector("#voice-screen");
const catalogScreen = document.querySelector("#catalog-screen");
const changeVoiceButton = document.querySelector("#change-voice");
const voiceBadge = document.querySelector("#voice-badge");
const songList = document.querySelector("#song-list");
const catalogMessage = document.querySelector("#catalog-message");
const appStatus = document.querySelector("#app-status");

function getSavedVoice() {
  try {
    const value = localStorage.getItem(VOICE_KEY);
    return Object.hasOwn(voiceNames, value) ? value : null;
  } catch {
    return null;
  }
}

function showVoicePicker() {
  voiceScreen.classList.remove("hidden");
  catalogScreen.classList.add("hidden");
  changeVoiceButton.classList.add("hidden");
}

function showCatalog(voice) {
  voiceScreen.classList.add("hidden");
  catalogScreen.classList.remove("hidden");
  changeVoiceButton.classList.remove("hidden");
  voiceBadge.textContent = voiceNames[voice];
  loadSongs(voice);
}

function makeAssetButton(asset, format) {
  const label = format === "pdf" ? "PDF" : format === "audio" ? "Audio" : "Video";
  if (!asset || !asset.url) {
    const disabled = document.createElement("span");
    disabled.className = "asset-link disabled";
    disabled.setAttribute("aria-label", label + " indisponibil");
    disabled.innerHTML = iconSvg[format] + "<span>" + label + "</span>";
    return disabled;
  }
  const link = document.createElement("a");
  link.className = "asset-link";
  link.href = asset.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerHTML = iconSvg[format] + "<span>" + label + "</span>";
  return link;
}

function renderSongs(songs, voice) {
  songList.replaceChildren();
  for (const song of songs) {
    const card = document.createElement("article");
    card.className = "song-card";
    const title = document.createElement("h3");
    title.textContent = song.title;
    const actions = document.createElement("div");
    actions.className = "asset-actions";
    const assets = song.assets?.[voice] ?? {};
    for (const format of ["pdf", "audio", "video"]) {
      actions.append(makeAssetButton(assets[format], format));
    }
    card.append(title, actions);
    songList.append(card);
  }
}

async function loadSongs(voice) {
  catalogMessage.textContent = "Se încarcă repertoriul…";
  songList.replaceChildren();
  try {
    const response = await fetch("/api/songs", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) {
      catalogMessage.textContent = data.message ?? "Catalogul nu este disponibil momentan.";
      return;
    }
    const songs = Array.isArray(data.songs) ? data.songs : [];
    if (songs.length === 0) {
      catalogMessage.textContent = "Catalogul nu conține încă nicio cântare publicată.";
      return;
    }
    catalogMessage.textContent = "";
    renderSongs(songs, voice);
  } catch {
    catalogMessage.textContent = "Nu am putut încărca repertoriul. Verifică conexiunea și încearcă din nou.";
  }
}

document.querySelectorAll("[data-voice]").forEach((button) => {
  button.addEventListener("click", () => {
    const voice = button.dataset.voice;
    if (!Object.hasOwn(voiceNames, voice)) return;
    try {
      localStorage.setItem(VOICE_KEY, voice);
    } catch {
      // Continue for this visit if local storage is disabled.
    }
    showCatalog(voice);
  });
});

changeVoiceButton.addEventListener("click", showVoicePicker);

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    appStatus.textContent = data.databaseConfigured
      ? "Serviciul este disponibil"
      : "Configurare inițială în curs";
  } catch {
    appStatus.textContent = "Starea serviciului nu este disponibilă";
  }
}

const savedVoice = getSavedVoice();
if (savedVoice) showCatalog(savedVoice);
else showVoicePicker();
checkHealth();
