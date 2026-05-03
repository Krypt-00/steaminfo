/**
 * script.js — Lógica principal de SteamInfo
 * Maneja: consumo de la Steam Web API (via proxy CORS), caché en localStorage,
 * renderizado de vistas, paginación, filtros, exportación JSON y estado de la app.
 */

/* ═══════════════════════════════════════════════
   ESTADO GLOBAL
   ═══════════════════════════════════════════════ */
const STATE = {
  apiKey:        "",
  steamId:       "",
  playerData:    null,   // GetPlayerSummaries
  ownedGames:    [],     // GetOwnedGames
  recentGames:   [],     // GetRecentlyPlayedGames
  friends:       [],     // GetFriendList
  banInfo:       null,   // GetPlayerBans
  achievements:  [],     // GetPlayerAchievements (juego seleccionado)
  activeSection: "profile",
  gamesPage:     1,
  gamesFilter:   "",
  gamesSort:     "hours",
  achFilter:     "all",
  friendsPage:   1,
};

/* ═══════════════════════════════════════════════
   UTILIDADES DE CACHÉ (localStorage)
   ═══════════════════════════════════════════════ */
const Cache = {
  /** Guarda un valor con TTL. */
  set(key, data) {
    const entry = { data, ts: Date.now() };
    try {
      localStorage.setItem(CONFIG.CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (e) { /* cuota excedida, ignorar */ }
  },

  /** Retorna el valor cacheado si no expiró, o null. */
  get(key) {
    try {
      const raw = localStorage.getItem(CONFIG.CACHE_PREFIX + key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CONFIG.CACHE_TTL_MS) {
        localStorage.removeItem(CONFIG.CACHE_PREFIX + key);
        return null;
      }
      return data;
    } catch { return null; }
  },

  /** Elimina todas las entradas de caché de SteamInfo. */
  clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(CONFIG.CACHE_PREFIX))
      .forEach(k => localStorage.removeItem(k));
    showToast("Caché limpiada correctamente.", "success");
  },
};

/* ═══════════════════════════════════════════════
   API — LLAMADAS A STEAM
   ═══════════════════════════════════════════════ */

/**
 * Construye la URL final con proxy CORS y llama a la API de Steam.
 * @param {string} endpoint - Ruta del endpoint (ej: "/ISteamUser/GetPlayerSummaries/v2/")
 * @param {object} params   - Parámetros adicionales (sin key ni formato)
 */
async function steamFetch(endpoint, params = {}) {
  const url = new URL(CONFIG.STEAM_API_BASE + endpoint);
  url.searchParams.set("key", STATE.apiKey);
  url.searchParams.set("format", "json");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const proxied = CONFIG.CORS_PROXY + encodeURIComponent(url.toString());

  const res = await fetch(proxied);
  if (!res.ok) {
    if (res.status === 429) throw new Error(CONFIG.ERRORS.RATE_LIMIT);
    if (res.status === 403) throw new Error(CONFIG.ERRORS.API_ERROR);
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Resuelve una URL de vanidad (ej: "gaben") o devuelve el SteamID64 directo.
 * Un SteamID64 válido es un número de 17 dígitos que empieza con 7656.
 */
async function resolveSteamId(input) {
  input = input.trim();

  // Extraer id o nombre de vanity de URLs completas
  const urlMatch = input.match(/steamcommunity\.com\/(id|profiles)\/([^/]+)/i);
  if (urlMatch) {
    if (urlMatch[1] === "profiles") input = urlMatch[2];
    else input = urlMatch[2];
  }

  // Si ya parece un SteamID64 (17 dígitos empezando por 7656)
  if (/^7656\d{13}$/.test(input)) return input;

  // Intentar resolver como vanity URL
  const cacheKey = `vanity_${input}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  const data = await steamFetch(CONFIG.ENDPOINTS.RESOLVE_VANITY, { vanityurl: input });
  if (data?.response?.success === 1) {
    Cache.set(cacheKey, data.response.steamid);
    return data.response.steamid;
  }

  throw new Error(CONFIG.ERRORS.VANITY_NOT_FOUND);
}

/** Obtiene el resumen del jugador. */
async function fetchPlayerSummary(steamId) {
  const cacheKey = `summary_${steamId}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  const data = await steamFetch(CONFIG.ENDPOINTS.PLAYER_SUMMARIES, { steamids: steamId });
  const players = data?.response?.players;
  if (!players?.length) throw new Error(CONFIG.ERRORS.INVALID_STEAM_ID);

  Cache.set(cacheKey, players[0]);
  return players[0];
}

/** Obtiene los juegos del jugador. */
async function fetchOwnedGames(steamId) {
  const cacheKey = `owned_${steamId}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  const data = await steamFetch(CONFIG.ENDPOINTS.OWNED_GAMES, {
    steamid: steamId,
    include_appinfo: 1,
    include_played_free_games: 1,
  });
  const games = data?.response?.games || [];
  Cache.set(cacheKey, games);
  return games;
}

/** Obtiene los juegos jugados recientemente. */
async function fetchRecentGames(steamId) {
  const cacheKey = `recent_${steamId}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  const data = await steamFetch(CONFIG.ENDPOINTS.RECENT_GAMES, {
    steamid: steamId,
    count: 10,
  });
  const games = data?.response?.games || [];
  Cache.set(cacheKey, games);
  return games;
}

/** Obtiene la lista de amigos. */
async function fetchFriends(steamId) {
  const cacheKey = `friends_${steamId}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  const data = await steamFetch(CONFIG.ENDPOINTS.FRIEND_LIST, {
    steamid: steamId,
    relationship: "friend",
  });
  const friends = data?.friendslist?.friends || [];
  Cache.set(cacheKey, friends);
  return friends;
}

/** Obtiene los datos de amigos en batch (máx 100 por llamada). */
async function fetchFriendsSummaries(steamIds) {
  const cacheKey = `fsum_${steamIds.slice(0, 5).join("_")}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  // Steam API acepta hasta 100 IDs separados por coma
  const data = await steamFetch(CONFIG.ENDPOINTS.PLAYER_SUMMARIES, {
    steamids: steamIds.join(","),
  });
  const players = data?.response?.players || [];
  Cache.set(cacheKey, players);
  return players;
}

/** Obtiene información de baneos. */
async function fetchBans(steamId) {
  const cacheKey = `bans_${steamId}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  const data = await steamFetch(CONFIG.ENDPOINTS.PLAYER_BANS, { steamids: steamId });
  const ban = data?.players?.[0] || null;
  Cache.set(cacheKey, ban);
  return ban;
}

/** Obtiene los logros de un juego específico. */
async function fetchAchievements(steamId, appId) {
  const cacheKey = `ach_${steamId}_${appId}`;
  const cached = Cache.get(cacheKey);
  if (cached) return cached;

  // Obtener los logros del jugador y el schema del juego en paralelo
  const [playerData, schemaData] = await Promise.allSettled([
    steamFetch(CONFIG.ENDPOINTS.ACHIEVEMENTS, { steamid: steamId, appid: appId, l: "spanish" }),
    steamFetch(CONFIG.ENDPOINTS.GAME_SCHEMA, { appid: appId, l: "spanish" }),
  ]);

  if (playerData.status === "rejected") throw new Error(CONFIG.ERRORS.NO_ACHIEVEMENTS);

  const playerAchs = playerData.value?.playerstats?.achievements || [];
  const schemaAchs = schemaData.status === "fulfilled"
    ? (schemaData.value?.game?.availableGameStats?.achievements || [])
    : [];

  // Combinar datos del jugador con iconos y descripciones del schema
  const schemaMap = Object.fromEntries(schemaAchs.map(a => [a.name, a]));
  const combined = playerAchs.map(a => ({
    ...a,
    displayName:  schemaMap[a.apiname]?.displayName  || a.apiname,
    description:  schemaMap[a.apiname]?.description  || "",
    icon:         schemaMap[a.apiname]?.icon         || "",
    icongray:     schemaMap[a.apiname]?.icongray     || "",
  }));

  Cache.set(cacheKey, combined);
  return combined;
}

/* ═══════════════════════════════════════════════
   RENDER — FUNCIONES DE INTERFAZ
   ═══════════════════════════════════════════════ */

/** Formatea minutos a "X h Y min". */
function formatHours(minutes) {
  if (!minutes) return "0 h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** Formatea un timestamp UNIX a fecha legible. */
function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("es-AR", {
    year: "numeric", month: "long", day: "numeric",
  });
}

/** Formatea un timestamp UNIX a fecha corta. */
function formatDateShort(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("es-AR");
}

/** Genera la URL del avatar de un juego desde Steam CDN. */
function gameImgUrl(appId, imgHash) {
  if (!imgHash) return CONFIG.DEFAULT_GAME_IMG;
  return `${CONFIG.STEAM_CDN}/${appId}/${imgHash}.jpg`;
}

/** Renderiza el sidebar con datos del perfil. */
function renderSidebarProfile(player) {
  const stateInfo = CONFIG.PLAYER_STATES[player.personastate] || CONFIG.PLAYER_STATES[0];
  const el = document.getElementById("sidebar-profile");
  el.innerHTML = `
    <div class="avatar-wrapper">
      <img src="${player.avatarfull || CONFIG.DEFAULT_AVATAR}" alt="Avatar" loading="lazy">
      <span class="avatar-status" style="background:${stateInfo.color}" title="${stateInfo.label}"></span>
    </div>
    <div class="sidebar-name">${escHtml(player.personaname)}</div>
    <span class="sidebar-state" style="background:${stateInfo.color}">${stateInfo.label}</span>
    ${player.loccountrycode ? `<div class="sidebar-country">📍 ${player.loccountrycode}</div>` : ""}
  `;
  el.classList.add("visible");
}

/** Actualiza las badges de conteos en el sidebar nav. */
function updateNavBadges() {
  document.getElementById("badge-games").textContent   = STATE.ownedGames.length  || "";
  document.getElementById("badge-friends").textContent = STATE.friends.length      || "";
}

/** Renderiza la vista de Perfil (resumen). */
function renderProfile() {
  const p = STATE.playerData;
  if (!p) return;

  const stateInfo = CONFIG.PLAYER_STATES[p.personastate] || CONFIG.PLAYER_STATES[0];
  const visibility = CONFIG.PROFILE_VISIBILITY[p.communityvisibilitystate] || "Desconocido";
  const ban = STATE.banInfo;

  let banHtml = "";
  if (ban) {
    const hasBan = ban.VACBanned || ban.CommunityBanned || ban.EconomyBan !== "none";
    banHtml = hasBan
      ? `<span class="ban-badge">⚠️ Baneado</span>`
      : `<span class="clean-badge">✅ Sin baneos</span>`;
  }

  document.getElementById("view-profile").innerHTML = `
    <div class="section-header">
      <h2>Perfil</h2>
    </div>

    <div class="profile-grid">
      <div class="profile-avatar-box">
        <img src="${p.avatarfull || CONFIG.DEFAULT_AVATAR}" alt="Avatar">
        <div class="profile-main-name">${escHtml(p.personaname)}</div>
        <div style="margin-bottom:8px">
          <span class="sidebar-state" style="background:${stateInfo.color}; color:#000; font-size:.75rem; padding:2px 10px; border-radius:999px; display:inline-block">
            ${stateInfo.label}
          </span>
        </div>
        <a class="profile-link" href="${p.profileurl}" target="_blank" rel="noopener">
          Ver en Steam ↗
        </a>
      </div>

      <div class="profile-info-box">
        ${p.realname ? `
        <div class="info-row">
          <span class="info-label">Nombre real</span>
          <span class="info-value">${escHtml(p.realname)}</span>
        </div>` : ""}

        <div class="info-row">
          <span class="info-label">SteamID64</span>
          <span class="info-value" style="font-family:monospace;font-size:.8rem">${p.steamid}</span>
        </div>

        <div class="info-row">
          <span class="info-label">Estado</span>
          <span class="info-value">
            <span class="status-dot" style="background:${stateInfo.color}"></span>
            ${stateInfo.label}
          </span>
        </div>

        <div class="info-row">
          <span class="info-label">Visibilidad</span>
          <span class="info-value">${visibility}</span>
        </div>

        ${p.loccountrycode ? `
        <div class="info-row">
          <span class="info-label">País</span>
          <span class="info-value">📍 ${p.loccountrycode}</span>
        </div>` : ""}

        ${p.timecreated ? `
        <div class="info-row">
          <span class="info-label">Cuenta creada</span>
          <span class="info-value">${formatDate(p.timecreated)}</span>
        </div>` : ""}

        ${p.lastlogoff ? `
        <div class="info-row">
          <span class="info-label">Último acceso</span>
          <span class="info-value">${formatDate(p.lastlogoff)}</span>
        </div>` : ""}

        ${p.gameextrainfo ? `
        <div class="info-row full">
          <span class="info-label">Jugando ahora</span>
          <span class="info-value">🎮 ${escHtml(p.gameextrainfo)}</span>
        </div>` : ""}

        <div class="info-row full">
          <span class="info-label">Baneos</span>
          <span class="info-value">${banHtml || "Cargando…"}</span>
        </div>
      </div>
    </div>

    ${STATE.recentGames.length ? `
    <div class="section-header" style="margin-top:8px">
      <h2>Actividad reciente</h2>
      <span class="section-count">${STATE.recentGames.length} juegos</span>
    </div>
    <div class="recent-grid">
      ${STATE.recentGames.map(g => `
        <div class="game-card">
          <img class="game-card-img"
               src="${gameImgUrl(g.appid, g.img_icon_url)}"
               onerror="this.src='${CONFIG.DEFAULT_GAME_IMG}'"
               alt="${escHtml(g.name)}">
          <div class="game-card-body">
            <div class="game-card-name" title="${escHtml(g.name)}">${escHtml(g.name)}</div>
            <div class="game-card-meta">
              <span class="game-hours">${formatHours(g.playtime_2weeks)} ult. 2 sem.</span>
              <span>${formatHours(g.playtime_forever)} total</span>
            </div>
          </div>
        </div>
      `).join("")}
    </div>
    ` : `<div class="empty-state"><div class="empty-icon">🎮</div><p>${CONFIG.ERRORS.NO_RECENT}</p></div>`}
  `;
}

/** Renderiza la vista de Juegos (librería). */
function renderGames() {
  const container = document.getElementById("view-games");
  let games = [...STATE.ownedGames];

  if (!games.length) {
    container.innerHTML = `
      <div class="section-header"><h2>Juegos</h2></div>
      <div class="empty-state"><div class="empty-icon">📦</div><p>${CONFIG.ERRORS.NO_GAMES}</p></div>
    `;
    return;
  }

  // Filtrar por búsqueda
  const q = STATE.gamesFilter.toLowerCase();
  if (q) games = games.filter(g => g.name?.toLowerCase().includes(q));

  // Ordenar
  if (STATE.gamesSort === "hours")      games.sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
  else if (STATE.gamesSort === "name")  games.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (STATE.gamesSort === "recent") games.sort((a, b) => (b.rtime_last_played || 0) - (a.rtime_last_played || 0));

  const maxHours = Math.max(...games.map(g => g.playtime_forever || 0), 1);
  const total = games.length;
  const perPage = CONFIG.GAMES_PER_PAGE;
  const totalPages = Math.ceil(total / perPage);
  const page = Math.min(STATE.gamesPage, totalPages);
  const slice = games.slice((page - 1) * perPage, page * perPage);

  container.innerHTML = `
    <div class="section-header">
      <h2>Juegos</h2>
      <span class="section-count">${total} juegos</span>
    </div>

    <div class="games-toolbar">
      <input class="search-input" id="games-search" type="text"
             placeholder="Buscar juego…" value="${escHtml(STATE.gamesFilter)}">
      <select class="sort-select" id="games-sort">
        <option value="hours"  ${STATE.gamesSort==="hours"  ? "selected":""}>Más jugados</option>
        <option value="name"   ${STATE.gamesSort==="name"   ? "selected":""}>Nombre A-Z</option>
        <option value="recent" ${STATE.gamesSort==="recent" ? "selected":""}>Más recientes</option>
      </select>
    </div>

    <table class="games-table">
      <thead>
        <tr>
          <th></th>
          <th>Juego</th>
          <th class="hours-bar-cell">Horas jugadas</th>
          <th>Último uso</th>
        </tr>
      </thead>
      <tbody>
        ${slice.map(g => `
          <tr class="achievement-row-trigger"
              data-appid="${g.appid}"
              data-name="${escHtml(g.name || "")}"
              title="Click para ver logros de ${escHtml(g.name || "")}">
            <td>
              <img class="game-row-img"
                   src="${gameImgUrl(g.appid, g.img_icon_url)}"
                   onerror="this.src='${CONFIG.DEFAULT_GAME_IMG}'"
                   alt="">
            </td>
            <td>
              <div class="game-row-name">${escHtml(g.name || `AppID ${g.appid}`)}</div>
            </td>
            <td class="hours-bar-cell">
              <div class="hours-bar-wrap">
                <div class="hours-bar">
                  <div class="hours-bar-fill" style="width:${Math.round((g.playtime_forever || 0) / maxHours * 100)}%"></div>
                </div>
                <span class="hours-text">${formatHours(g.playtime_forever)}</span>
              </div>
            </td>
            <td><span class="hours-text">${formatDateShort(g.rtime_last_played)}</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    ${totalPages > 1 ? renderPagination(page, totalPages, "games") : ""}
  `;

  // Eventos de filtro/sort
  document.getElementById("games-search").addEventListener("input", e => {
    STATE.gamesFilter = e.target.value;
    STATE.gamesPage = 1;
    renderGames();
  });
  document.getElementById("games-sort").addEventListener("change", e => {
    STATE.gamesSort = e.target.value;
    STATE.gamesPage = 1;
    renderGames();
  });

  // Click en fila → ir a logros del juego
  container.querySelectorAll(".achievement-row-trigger").forEach(row => {
    row.addEventListener("click", () => {
      const appId = row.dataset.appid;
      const name  = row.dataset.name;
      const sel = document.getElementById("ach-game-select");
      if (sel) {
        sel.value = appId;
        switchSection("achievements");
        // Autocargar si tiene horas
        const game = STATE.ownedGames.find(g => String(g.appid) === appId);
        if (game && game.playtime_forever > 0) {
          loadAchievements(appId, name);
        }
      } else {
        switchSection("achievements");
      }
    });
  });

  // Paginación
  container.querySelectorAll(".page-btn[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.gamesPage = Number(btn.dataset.page);
      renderGames();
      document.getElementById("main-content").scrollTop = 0;
    });
  });
}

/** Renderiza la vista de Logros. */
function renderAchievements() {
  const container = document.getElementById("view-achievements");
  const gamesWithHours = STATE.ownedGames
    .filter(g => g.playtime_forever > 0)
    .sort((a, b) => b.playtime_forever - a.playtime_forever);

  container.innerHTML = `
    <div class="section-header">
      <h2>Logros</h2>
    </div>

    <div class="achievements-select-area">
      <label for="ach-game-select">Seleccionar juego:</label>
      <select class="game-select" id="ach-game-select">
        <option value="">— Elegí un juego —</option>
        ${gamesWithHours.map(g => `
          <option value="${g.appid}">${escHtml(g.name || `AppID ${g.appid}`)}</option>
        `).join("")}
      </select>
      <button class="btn-load-ach" id="btn-load-ach">Cargar logros</button>
    </div>

    <div id="ach-content"></div>
  `;

  document.getElementById("btn-load-ach").addEventListener("click", () => {
    const sel = document.getElementById("ach-game-select");
    const appId = sel.value;
    if (!appId) { showToast("Seleccioná un juego primero.", "error"); return; }
    const name = sel.options[sel.selectedIndex].text;
    loadAchievements(appId, name);
  });
}

/** Carga y muestra los logros de un juego. */
async function loadAchievements(appId, gameName) {
  const container = document.getElementById("ach-content");
  container.innerHTML = `<div class="spinner" style="margin:40px auto"></div>`;
  try {
    const achs = await fetchAchievements(STATE.steamId, appId);
    STATE.achievements = achs;
    STATE.achFilter = "all";
    renderAchievementsContent(gameName);
  } catch (e) {
    container.innerHTML = `<div class="error-msg">⚠️ ${e.message}</div>`;
  }
}

/** Renderiza el contenido de logros (filtros + lista). */
function renderAchievementsContent(gameName) {
  const achs = STATE.achievements;
  const unlocked = achs.filter(a => a.achieved === 1);
  const locked    = achs.filter(a => a.achieved === 0);
  const pct = achs.length ? Math.round(unlocked.length / achs.length * 100) : 0;
  const container = document.getElementById("ach-content");

  let filtered = achs;
  if (STATE.achFilter === "unlocked") filtered = unlocked;
  if (STATE.achFilter === "locked")   filtered = locked;

  container.innerHTML = `
    <div class="section-header" style="margin-top:0">
      <h2 style="font-size:1.1rem">${escHtml(gameName)}</h2>
    </div>

    <div class="ach-summary">
      <div class="ach-stat">
        <div class="ach-stat-value">${unlocked.length}</div>
        <div class="ach-stat-label">Obtenidos</div>
      </div>
      <div class="ach-stat">
        <div class="ach-stat-value">${achs.length}</div>
        <div class="ach-stat-label">Total</div>
      </div>
      <div class="ach-stat">
        <div class="ach-stat-value" style="color:var(--accent-green)">${pct}%</div>
        <div class="ach-stat-label">Completado</div>
      </div>
      <div class="ach-progress-wrap">
        <div class="ach-progress-bar">
          <div class="ach-progress-fill" style="width:${pct}%"></div>
        </div>
        <span style="font-size:.75rem;color:var(--text-secondary)">${unlocked.length} de ${achs.length} logros obtenidos</span>
      </div>
    </div>

    <div class="achievements-filter">
      <button class="filter-btn ${STATE.achFilter==="all"      ? "active":""}" data-f="all">Todos (${achs.length})</button>
      <button class="filter-btn ${STATE.achFilter==="unlocked" ? "active":""}" data-f="unlocked">Obtenidos (${unlocked.length})</button>
      <button class="filter-btn ${STATE.achFilter==="locked"   ? "active":""}" data-f="locked">Faltantes (${locked.length})</button>
    </div>

    <div class="achievements-list">
      ${filtered.map(a => `
        <div class="achievement-item ${a.achieved ? "unlocked" : "locked"}">
          <img class="ach-icon"
               src="${a.achieved ? (a.icon || "") : (a.icongray || a.icon || "")}"
               onerror="this.style.display='none'"
               alt="">
          <div class="ach-info">
            <div class="ach-name">${escHtml(a.displayName || a.apiname)}</div>
            ${a.description ? `<div class="ach-desc">${escHtml(a.description)}</div>` : ""}
            ${a.achieved && a.unlocktime
              ? `<div class="ach-unlock-time">Obtenido: ${formatDate(a.unlocktime)}</div>`
              : ""}
          </div>
          <span class="ach-check">${a.achieved ? "✅" : "🔒"}</span>
        </div>
      `).join("")}
    </div>
  `;

  // Filtros
  container.querySelectorAll(".filter-btn[data-f]").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.achFilter = btn.dataset.f;
      renderAchievementsContent(gameName);
    });
  });
}

/** Renderiza la vista de Amigos. */
async function renderFriends() {
  const container = document.getElementById("view-friends");
  container.innerHTML = `<div class="section-header"><h2>Amigos</h2></div><div class="spinner" style="margin:40px auto"></div>`;

  if (!STATE.friends.length) {
    container.innerHTML = `
      <div class="section-header"><h2>Amigos</h2></div>
      <div class="empty-state"><div class="empty-icon">👥</div><p>${CONFIG.ERRORS.NO_FRIENDS}</p></div>
    `;
    return;
  }

  const page = STATE.friendsPage;
  const perPage = CONFIG.FRIENDS_PER_PAGE;
  const totalPages = Math.ceil(STATE.friends.length / perPage);
  const slice = STATE.friends.slice((page - 1) * perPage, page * perPage);
  const ids = slice.map(f => f.steamid);

  let summaries = [];
  try {
    summaries = await fetchFriendsSummaries(ids);
  } catch (e) {
    summaries = [];
  }

  const summaryMap = Object.fromEntries(summaries.map(s => [s.steamid, s]));

  container.innerHTML = `
    <div class="section-header">
      <h2>Amigos</h2>
      <span class="section-count">${STATE.friends.length} amigos</span>
    </div>

    <div class="friends-grid">
      ${slice.map(f => {
        const s = summaryMap[f.steamid] || {};
        const stateInfo = CONFIG.PLAYER_STATES[s.personastate] || CONFIG.PLAYER_STATES[0];
        return `
          <a class="friend-card"
             href="${s.profileurl || `https://steamcommunity.com/profiles/${f.steamid}`}"
             target="_blank" rel="noopener">
            <div class="friend-avatar">
              <img src="${s.avatarmedium || CONFIG.DEFAULT_AVATAR}"
                   alt="${escHtml(s.personaname || "Amigo")}"
                   loading="lazy"
                   onerror="this.src='${CONFIG.DEFAULT_AVATAR}'">
              <span class="status-dot" style="background:${stateInfo.color}" title="${stateInfo.label}"></span>
            </div>
            <div class="friend-info">
              <div class="friend-name">${escHtml(s.personaname || f.steamid)}</div>
              <div class="friend-status">${stateInfo.label}</div>
              <div class="friend-since">Amigos desde ${formatDateShort(f.friend_since)}</div>
            </div>
          </a>
        `;
      }).join("")}
    </div>

    ${totalPages > 1 ? renderPagination(page, totalPages, "friends") : ""}
  `;

  // Paginación
  container.querySelectorAll(".page-btn[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.friendsPage = Number(btn.dataset.page);
      renderFriends();
    });
  });
}

/** Renderiza la vista de Baneos. */
function renderBans() {
  const container = document.getElementById("view-bans");
  const b = STATE.banInfo;

  if (!b) {
    container.innerHTML = `
      <div class="section-header"><h2>Baneos</h2></div>
      <div class="empty-state"><div class="empty-icon">🛡️</div><p>No se pudo obtener información de baneos.</p></div>
    `;
    return;
  }

  const hasBan = b.VACBanned || b.CommunityBanned || b.EconomyBan !== "none";
  const overallColor = hasBan ? "var(--accent-red)" : "var(--accent-green)";
  const overallIcon  = hasBan ? "⚠️" : "✅";

  container.innerHTML = `
    <div class="section-header">
      <h2>Baneos</h2>
    </div>

    <div class="bans-grid">
      <div class="ban-card">
        <div class="ban-card-title" style="color:${overallColor}">
          ${overallIcon} Estado general
        </div>
        <div class="ban-status-item">
          <span class="ban-status-key">Resumen</span>
          <span>${hasBan
            ? `<span class="ban-badge">Tiene restricciones</span>`
            : `<span class="clean-badge">Perfil limpio</span>`
          }</span>
        </div>
      </div>

      <div class="ban-card">
        <div class="ban-card-title">🔫 VAC (Anti-Cheat)</div>
        <div class="ban-status-item">
          <span class="ban-status-key">Baneado por VAC</span>
          <span style="color:${b.VACBanned ? "var(--accent-red)":"var(--accent-green)"}">
            ${b.VACBanned ? "Sí ⚠️" : "No ✅"}
          </span>
        </div>
        <div class="ban-status-item">
          <span class="ban-status-key">N° de baneos VAC</span>
          <span>${b.NumberOfVACBans}</span>
        </div>
        <div class="ban-status-item">
          <span class="ban-status-key">Días desde último baneo</span>
          <span>${b.VACBanned ? `${b.DaysSinceLastBan} días` : "—"}</span>
        </div>
      </div>

      <div class="ban-card">
        <div class="ban-card-title">🏘️ Comunidad y Economía</div>
        <div class="ban-status-item">
          <span class="ban-status-key">Baneo de comunidad</span>
          <span style="color:${b.CommunityBanned ? "var(--accent-red)":"var(--accent-green)"}">
            ${b.CommunityBanned ? "Sí ⚠️" : "No ✅"}
          </span>
        </div>
        <div class="ban-status-item">
          <span class="ban-status-key">Baneo de economía</span>
          <span style="color:${b.EconomyBan !== "none" ? "var(--accent-red)":"var(--accent-green)"}">
            ${b.EconomyBan !== "none" ? `${b.EconomyBan} ⚠️` : "Ninguno ✅"}
          </span>
        </div>
        <div class="ban-status-item">
          <span class="ban-status-key">Baneos en juegos</span>
          <span>${b.NumberOfGameBans}</span>
        </div>
      </div>
    </div>
  `;
}

/** Genera HTML de paginación. */
function renderPagination(current, total, ns) {
  const pages = [];
  const delta = 2;
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= delta) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  return `<div class="pagination">
    <button class="page-btn" data-page="${current - 1}" ${current <= 1 ? "disabled" : ""}>‹ Ant.</button>
    ${pages.map(p => p === "…"
      ? `<span style="color:var(--text-muted);padding:0 4px">…</span>`
      : `<button class="page-btn ${p === current ? "active" : ""}" data-page="${p}">${p}</button>`
    ).join("")}
    <button class="page-btn" data-page="${current + 1}" ${current >= total ? "disabled" : ""}>Sig. ›</button>
  </div>`;
}

/* ═══════════════════════════════════════════════
   NAVEGACIÓN / SECCIONES
   ═══════════════════════════════════════════════ */

/** Cambia la sección activa del menú y renderiza el contenido correspondiente. */
function switchSection(section) {
  STATE.activeSection = section;

  // Actualizar clases del menú
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.section === section);
  });

  // Ocultar todas las vistas
  document.querySelectorAll(".section-view").forEach(v => v.classList.remove("active"));

  // Mostrar la vista activa
  const view = document.getElementById(`view-${section}`);
  if (view) view.classList.add("active");

  // Renderizar según sección
  if (section === "profile")      renderProfile();
  if (section === "games")        renderGames();
  if (section === "achievements") renderAchievements();
  if (section === "friends")      renderFriends();
  if (section === "bans")         renderBans();

  // En mobile, cerrar sidebar
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("visible");
}

/* ═══════════════════════════════════════════════
   BÚSQUEDA PRINCIPAL
   ═══════════════════════════════════════════════ */

/** Función principal: busca y carga todos los datos del perfil. */
async function searchProfile() {
  const rawInput = document.getElementById("input-steamid").value.trim();
  const apiKey   = document.getElementById("input-apikey").value.trim();

  if (!apiKey)   { showToast(CONFIG.ERRORS.NO_API_KEY,  "error"); return; }
  if (!rawInput) { showToast(CONFIG.ERRORS.NO_STEAM_ID, "error"); return; }

  STATE.apiKey = apiKey;

  // Guardar en localStorage para próxima sesión
  localStorage.setItem(CONFIG.LS_KEYS.API_KEY,  apiKey);

  showLoading(true);
  hideWelcome();

  try {
    // 1. Resolver SteamID
    const steamId = await resolveSteamId(rawInput);
    STATE.steamId = steamId;
    localStorage.setItem(CONFIG.LS_KEYS.STEAM_ID, rawInput);

    // 2. Obtener datos en paralelo (para velocidad)
    const [player, owned, recent, bans] = await Promise.all([
      fetchPlayerSummary(steamId),
      fetchOwnedGames(steamId).catch(() => []),
      fetchRecentGames(steamId).catch(() => []),
      fetchBans(steamId).catch(() => null),
    ]);

    STATE.playerData  = player;
    STATE.ownedGames  = owned;
    STATE.recentGames = recent;
    STATE.banInfo     = bans;
    STATE.gamesPage   = 1;
    STATE.gamesFilter = "";
    STATE.friends     = [];
    STATE.achievements = [];

    // 3. Cargar amigos (puede fallar si perfil privado)
    try {
      STATE.friends = await fetchFriends(steamId);
    } catch { STATE.friends = []; }

    // 4. Renderizar sidebar y sección por defecto
    renderSidebarProfile(player);
    updateNavBadges();
    showNavItems(true);
    switchSection("profile");

    showToast(`Perfil cargado: ${player.personaname}`, "success");

  } catch (err) {
    showToast(err.message || CONFIG.ERRORS.API_ERROR, "error");
    showWelcome();
  } finally {
    showLoading(false);
  }
}

/* ═══════════════════════════════════════════════
   EXPORTAR PERFIL A JSON
   ═══════════════════════════════════════════════ */
function exportProfileJSON() {
  if (!STATE.playerData) { showToast("Buscá un perfil primero.", "error"); return; }

  const data = {
    exportedAt:  new Date().toISOString(),
    player:      STATE.playerData,
    bans:        STATE.banInfo,
    ownedGames:  STATE.ownedGames,
    recentGames: STATE.recentGames,
    friends:     STATE.friends,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `steaminfo_${STATE.playerData.personaname}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Datos exportados exitosamente.", "success");
}

/* ═══════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════ */

/** Escapa HTML para prevenir XSS. */
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Muestra u oculta el indicador de carga. */
function showLoading(visible) {
  document.getElementById("loading-overlay").classList.toggle("visible", visible);
}

/** Muestra la pantalla de bienvenida. */
function showWelcome() {
  document.getElementById("welcome-screen").style.display = "flex";
  document.querySelectorAll(".section-view").forEach(v => v.classList.remove("active"));
  showNavItems(false);
}

/** Oculta la pantalla de bienvenida. */
function hideWelcome() {
  document.getElementById("welcome-screen").style.display = "none";
}

/** Muestra u oculta los ítems de nav que requieren datos. */
function showNavItems(visible) {
  document.querySelectorAll(".nav-item[data-section]").forEach(item => {
    item.style.opacity = visible ? "1" : ".35";
    item.style.pointerEvents = visible ? "auto" : "none";
  });
}

/** Muestra una notificación toast. */
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️"} ${escHtml(msg)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity .3s";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ═══════════════════════════════════════════════
   INICIALIZACIÓN
   ═══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  // Precargar desde localStorage
  const savedKey = localStorage.getItem(CONFIG.LS_KEYS.API_KEY);
  const savedId  = localStorage.getItem(CONFIG.LS_KEYS.STEAM_ID);
  if (savedKey) document.getElementById("input-apikey").value   = savedKey;
  if (savedId)  document.getElementById("input-steamid").value  = savedId;

  // Botón buscar
  document.getElementById("btn-search").addEventListener("click", searchProfile);

  // Enter en inputs
  ["input-steamid", "input-apikey"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => {
      if (e.key === "Enter") searchProfile();
    });
  });

  // Navegación sidebar
  document.querySelectorAll(".nav-item[data-section]").forEach(item => {
    item.addEventListener("click", () => {
      if (!STATE.playerData) { showToast("Buscá un perfil primero.", "error"); return; }
      switchSection(item.dataset.section);
    });
  });

  // Botón limpiar caché
  document.getElementById("btn-clear-cache").addEventListener("click", () => {
    Cache.clearAll();
  });

  // Botón exportar JSON
  document.getElementById("btn-export").addEventListener("click", exportProfileJSON);

  // Menú hamburguesa (mobile)
  const hamburger = document.getElementById("hamburger");
  const sidebar   = document.getElementById("sidebar");
  const overlay   = document.getElementById("sidebar-overlay");

  hamburger.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("visible");
  });
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("visible");
  });

  // Estado inicial: nav deshabilitado
  showNavItems(false);
  showWelcome();
});