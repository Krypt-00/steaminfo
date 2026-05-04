/**
 * script.js — SteamInfo
 * Lógica completa: API Steam, caché localStorage, renderizado de vistas,
 * paginación, filtros, exportación JSON.
 * Diseñado para la estructura de 3 columnas fiel a la imagen de referencia.
 */

"use strict";

/* ═══════════════════════════════════════
   ESTADO GLOBAL
   ═══════════════════════════════════════ */
const STATE = {
  apiKey:        "",
  steamId:       "",
  activeSection: "recent",
  playerData:    null,
  ownedGames:    [],
  recentGames:   [],
  friends:       [],
  banInfo:       null,
  achievements:  [],
  achGameName:   "",
  achFilter:     "all",
  gamesFilter:   "",
  gamesSort:     "hours",
  gamesPage:     1,
  friendsPage:   1,
};

/* ═══════════════════════════════════════
   CACHÉ (localStorage, TTL 5 min)
   ═══════════════════════════════════════ */
const Cache = {
  set(key, data) {
    try { localStorage.setItem("si_" + key, JSON.stringify({ data, ts: Date.now() })); }
    catch { /* cuota */ }
  },
  get(key) {
    try {
      const raw = localStorage.getItem("si_" + key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CONFIG.CACHE_TTL_MS) { localStorage.removeItem("si_" + key); return null; }
      return data;
    } catch { return null; }
  },
  clearAll() {
    Object.keys(localStorage).filter(k => k.startsWith("si_")).forEach(k => localStorage.removeItem(k));
    toast("Caché limpiada.", "success");
  },
};

/* ═══════════════════════════════════════
   PETICIONES A LA API
   ═══════════════════════════════════════ */
async function steamFetch(endpoint, params = {}) {
  const url = new URL(CONFIG.STEAM_API_BASE + endpoint);
  url.searchParams.set("key",    STATE.apiKey);
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

async function resolveSteamId(input) {
  input = input.trim();
  const urlMatch = input.match(/steamcommunity\.com\/(id|profiles)\/([^/]+)/i);
  if (urlMatch) input = urlMatch[2];
  if (/^7656\d{13}$/.test(input)) return input;
  const cKey = "vanity_" + input;
  const cached = Cache.get(cKey);
  if (cached) return cached;
  const data = await steamFetch(CONFIG.ENDPOINTS.RESOLVE_VANITY, { vanityurl: input });
  if (data?.response?.success === 1) { Cache.set(cKey, data.response.steamid); return data.response.steamid; }
  throw new Error(CONFIG.ERRORS.VANITY_NOT_FOUND);
}

async function fetchPlayerSummary(id) {
  const cKey = "sum_" + id;
  const cached = Cache.get(cKey);
  if (cached) return cached;
  const data = await steamFetch(CONFIG.ENDPOINTS.PLAYER_SUMMARIES, { steamids: id });
  const p = data?.response?.players?.[0];
  if (!p) throw new Error(CONFIG.ERRORS.INVALID_STEAM_ID);
  Cache.set(cKey, p);
  return p;
}

async function fetchOwnedGames(id) {
  const cKey = "owned_" + id;
  const c = Cache.get(cKey);
  if (c) return c;
  const data = await steamFetch(CONFIG.ENDPOINTS.OWNED_GAMES, { steamid: id, include_appinfo: 1, include_played_free_games: 1 });
  const g = data?.response?.games || [];
  Cache.set(cKey, g);
  return g;
}

async function fetchRecentGames(id) {
  const cKey = "recent_" + id;
  const c = Cache.get(cKey);
  if (c) return c;
  const data = await steamFetch(CONFIG.ENDPOINTS.RECENT_GAMES, { steamid: id, count: 10 });
  const g = data?.response?.games || [];
  Cache.set(cKey, g);
  return g;
}

async function fetchFriends(id) {
  const cKey = "friends_" + id;
  const c = Cache.get(cKey);
  if (c) return c;
  const data = await steamFetch(CONFIG.ENDPOINTS.FRIEND_LIST, { steamid: id, relationship: "friend" });
  const f = data?.friendslist?.friends || [];
  Cache.set(cKey, f);
  return f;
}

async function fetchFriendsSummaries(ids) {
  const cKey = "fsum_" + ids.slice(0, 5).join("_");
  const c = Cache.get(cKey);
  if (c) return c;
  const data = await steamFetch(CONFIG.ENDPOINTS.PLAYER_SUMMARIES, { steamids: ids.join(",") });
  const p = data?.response?.players || [];
  Cache.set(cKey, p);
  return p;
}

async function fetchBans(id) {
  const cKey = "bans_" + id;
  const c = Cache.get(cKey);
  if (c) return c;
  const data = await steamFetch(CONFIG.ENDPOINTS.PLAYER_BANS, { steamids: id });
  const b = data?.players?.[0] || null;
  Cache.set(cKey, b);
  return b;
}

async function fetchAchievements(steamId, appId) {
  const cKey = "ach_" + steamId + "_" + appId;
  const c = Cache.get(cKey);
  if (c) return c;
  const [playerR, schemaR] = await Promise.allSettled([
    steamFetch(CONFIG.ENDPOINTS.ACHIEVEMENTS, { steamid: steamId, appid: appId, l: "spanish" }),
    steamFetch(CONFIG.ENDPOINTS.GAME_SCHEMA,  { appid: appId, l: "spanish" }),
  ]);
  if (playerR.status === "rejected") throw new Error(CONFIG.ERRORS.NO_ACHIEVEMENTS);
  const playerAchs = playerR.value?.playerstats?.achievements || [];
  const schemaAchs = schemaR.status === "fulfilled"
    ? (schemaR.value?.game?.availableGameStats?.achievements || []) : [];
  const schemaMap = Object.fromEntries(schemaAchs.map(a => [a.name, a]));
  const combined = playerAchs.map(a => ({
    ...a,
    displayName: schemaMap[a.apiname]?.displayName || a.apiname,
    description: schemaMap[a.apiname]?.description || "",
    icon:        schemaMap[a.apiname]?.icon        || "",
    icongray:    schemaMap[a.apiname]?.icongray    || "",
  }));
  Cache.set(cKey, combined);
  return combined;
}

/* ═══════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════ */
function esc(s) {
  if (!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtHours(min) {
  if (!min) return "0 h";
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return m + " min";
  if (m === 0) return h + " h";
  return h + " h " + m + " min";
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("es-AR", { year:"numeric", month:"long", day:"numeric" });
}

function fmtDateShort(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("es-AR");
}

function gameImg(appid, hash) {
  if (!hash) return CONFIG.DEFAULT_GAME_IMG;
  return CONFIG.STEAM_CDN + "/" + appid + "/" + hash + ".jpg";
}

function stateInfo(code) {
  return CONFIG.PLAYER_STATES[code] || CONFIG.PLAYER_STATES[0];
}

function makePagination(current, total, ns) {
  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= 2) pages.push(i);
    else if (pages[pages.length-1] !== "…") pages.push("…");
  }
  return `<div class="pagination">
    <button class="pg-btn" data-p="${current-1}" ${current<=1?"disabled":""}>‹</button>
    ${pages.map(p => p==="…"
      ? `<span style="color:var(--text-muted);padding:0 3px">…</span>`
      : `<button class="pg-btn ${p===current?"active":""}" data-p="${p}">${p}</button>`
    ).join("")}
    <button class="pg-btn" data-p="${current+1}" ${current>=total?"disabled":""}>›</button>
  </div>`;
}

function bindPagination(container, ns) {
  container.querySelectorAll(".pg-btn[data-p]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (ns === "games")   { STATE.gamesPage   = +btn.dataset.p; renderGames(); }
      if (ns === "friends") { STATE.friendsPage = +btn.dataset.p; renderFriends(); }
    });
  });
}

/* ═══════════════════════════════════════
   PANEL IZQUIERDO
   ═══════════════════════════════════════ */
function renderLeftPanel(p) {
  const si = stateInfo(p.personastate);

  // Ocultar placeholder, mostrar datos reales
  document.getElementById("lp-avatar-placeholder").classList.add("hidden");
  const img = document.getElementById("lp-avatar-img");
  img.src = p.avatarfull || CONFIG.DEFAULT_AVATAR;
  img.classList.remove("hidden");

  const dot = document.getElementById("lp-status-dot");
  dot.style.background = si.color;
  dot.classList.remove("hidden");

  document.getElementById("lp-name").textContent = p.personaname;

  const stateEl = document.getElementById("lp-state");
  stateEl.textContent = si.label;
  stateEl.style.background = si.color;
  stateEl.classList.remove("hidden");

  if (p.loccountrycode) {
    const c = document.getElementById("lp-country");
    c.textContent = "📍 " + p.loccountrycode;
    c.classList.remove("hidden");
  }

  // Metadatos
  const meta = document.getElementById("lp-meta");
  const rows = [];
  if (p.timecreated) rows.push(["Cuenta creada", fmtDateShort(p.timecreated)]);
  if (p.realname)    rows.push(["Nombre real",   esc(p.realname)]);
  rows.push(["Perfil", CONFIG.PROFILE_VISIBILITY[p.communityvisibilitystate] || "—"]);
  if (p.gameextrainfo) rows.push(["Jugando", "🎮 " + esc(p.gameextrainfo)]);

  if (rows.length) {
    meta.innerHTML = rows.map(([k, v]) =>
      `<div class="lp-meta-row"><span class="lp-meta-key">${k}</span><span class="lp-meta-val">${v}</span></div>`
    ).join("");
    meta.classList.remove("hidden");
  }

  const link = document.getElementById("lp-link");
  link.href = p.profileurl;
  link.classList.remove("hidden");
}

/* ═══════════════════════════════════════
   RENDER: ACTIVIDAD RECIENTE
   ═══════════════════════════════════════ */
function renderRecent() {
  setTitle("Actividad reciente", STATE.recentGames.length ? STATE.recentGames.length + " juegos" : "");
  const el = document.getElementById("view-recent");

  if (!STATE.recentGames.length) {
    el.innerHTML = `<div class="empty-view"><div class="ev-icon">🎮</div><p>${CONFIG.ERRORS.NO_RECENT}</p></div>`;
    return;
  }

  el.innerHTML = `<div class="recent-grid">
    ${STATE.recentGames.map(g => `
      <div class="game-card">
        <img class="game-card-img" src="${gameImg(g.appid, g.img_icon_url)}" onerror="this.src='${CONFIG.DEFAULT_GAME_IMG}'" alt="">
        <div class="game-card-body">
          <div class="game-card-name" title="${esc(g.name)}">${esc(g.name)}</div>
          <div class="game-card-meta">
            <span class="game-hours">${fmtHours(g.playtime_2weeks)} (2 sem.)</span>
            <span>${fmtHours(g.playtime_forever)} total</span>
          </div>
        </div>
      </div>
    `).join("")}
  </div>`;
}

/* ═══════════════════════════════════════
   RENDER: JUEGOS (LIBRERÍA)
   ═══════════════════════════════════════ */
function renderGames() {
  setTitle("Juegos", "");
  const wrap = document.getElementById("games-inner");

  let games = [...STATE.ownedGames];
  if (!games.length) {
    wrap.innerHTML = `<div class="empty-view"><div class="ev-icon">📦</div><p>${CONFIG.ERRORS.NO_GAMES}</p></div>`;
    return;
  }

  const q = STATE.gamesFilter.toLowerCase();
  if (q) games = games.filter(g => g.name?.toLowerCase().includes(q));

  if      (STATE.gamesSort === "hours")  games.sort((a,b) => (b.playtime_forever||0) - (a.playtime_forever||0));
  else if (STATE.gamesSort === "name")   games.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  else if (STATE.gamesSort === "recent") games.sort((a,b) => (b.rtime_last_played||0) - (a.rtime_last_played||0));

  const maxH  = Math.max(...games.map(g => g.playtime_forever||0), 1);
  const total = games.length;
  const pp    = CONFIG.GAMES_PER_PAGE;
  const totalPages = Math.ceil(total / pp);
  const page  = Math.min(STATE.gamesPage, totalPages || 1);
  const slice = games.slice((page-1)*pp, page*pp);

  setTitle("Juegos", total + " juegos");

  wrap.innerHTML = `
    <table class="games-table">
      <thead>
        <tr>
          <th></th><th>Juego</th><th style="width:140px">Horas</th><th>Últ. vez</th>
        </tr>
      </thead>
      <tbody>
        ${slice.map(g => `
          <tr data-appid="${g.appid}" data-name="${esc(g.name||"")}">
            <td><img class="gt-img" src="${gameImg(g.appid, g.img_icon_url)}" onerror="this.style.display='none'" alt=""></td>
            <td><div class="gt-name" title="${esc(g.name||"")}">${esc(g.name||("AppID "+g.appid))}</div></td>
            <td>
              <div class="hbar-wrap">
                <div class="hbar"><div class="hbar-fill" style="width:${Math.round((g.playtime_forever||0)/maxH*100)}%"></div></div>
                <span class="hbar-text">${fmtHours(g.playtime_forever)}</span>
              </div>
            </td>
            <td><span class="hbar-text">${fmtDateShort(g.rtime_last_played)}</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${totalPages > 1 ? makePagination(page, totalPages, "games") : ""}
  `;

  // Click en fila → logros
  wrap.querySelectorAll("tbody tr").forEach(row => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      const appId = row.dataset.appid;
      const name  = row.dataset.name;
      const sel   = document.getElementById("ach-select");
      if (sel && sel.querySelector(`option[value="${appId}"]`)) sel.value = appId;
      switchSection("achievements");
      const game = STATE.ownedGames.find(g => String(g.appid) === appId);
      if (game && game.playtime_forever > 0) loadAchievements(appId, name);
    });
  });

  bindPagination(wrap, "games");
}

/* ═══════════════════════════════════════
   RENDER: LOGROS
   ═══════════════════════════════════════ */
function renderAchievements() {
  setTitle("Logros", "");
  const sel = document.getElementById("ach-select");
  const gamesWithHours = STATE.ownedGames
    .filter(g => g.playtime_forever > 0)
    .sort((a,b) => b.playtime_forever - a.playtime_forever);

  sel.innerHTML = `<option value="">— Elegí un juego —</option>` +
    gamesWithHours.map(g => `<option value="${g.appid}">${esc(g.name||"AppID "+g.appid)}</option>`).join("");

  document.getElementById("ach-inner").innerHTML = "";

  if (!STATE.achievements.length) return;
  renderAchievementsContent();
}

async function loadAchievements(appId, gameName) {
  setTitle("Logros — " + gameName, "");
  const inner = document.getElementById("ach-inner");
  inner.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:40px;gap:12px"><div class="spinner"></div><span>Cargando logros…</span></div>`;
  try {
    STATE.achievements = await fetchAchievements(STATE.steamId, appId);
    STATE.achGameName  = gameName;
    STATE.achFilter    = "all";
    renderAchievementsContent();
  } catch(e) {
    inner.innerHTML = `<div class="msg-error">⚠️ ${esc(e.message)}</div>`;
  }
}

function renderAchievementsContent() {
  const achs    = STATE.achievements;
  const unlocked = achs.filter(a => a.achieved === 1);
  const locked   = achs.filter(a => a.achieved === 0);
  const pct      = achs.length ? Math.round(unlocked.length / achs.length * 100) : 0;
  let filtered   = achs;
  if (STATE.achFilter === "unlocked") filtered = unlocked;
  if (STATE.achFilter === "locked")   filtered = locked;

  setTitle("Logros — " + (STATE.achGameName || ""), `${unlocked.length}/${achs.length}`);

  const inner = document.getElementById("ach-inner");
  inner.innerHTML = `
    <div class="ach-summary">
      <div class="ach-stat"><div class="ach-stat-val">${unlocked.length}</div><div class="ach-stat-label">Obtenidos</div></div>
      <div class="ach-stat"><div class="ach-stat-val">${achs.length}</div><div class="ach-stat-label">Total</div></div>
      <div class="ach-stat"><div class="ach-stat-val" style="color:var(--accent-green)">${pct}%</div><div class="ach-stat-label">Completado</div></div>
      <div class="ach-prog-wrap">
        <div class="ach-prog-bar"><div class="ach-prog-fill" style="width:${pct}%"></div></div>
        <span style="font-size:.72rem;color:var(--text-secondary)">${unlocked.length} de ${achs.length} logros obtenidos</span>
      </div>
    </div>
    <div class="ach-filters">
      <button class="ach-filter-btn ${STATE.achFilter==="all"?"active":""}"      data-f="all">Todos (${achs.length})</button>
      <button class="ach-filter-btn ${STATE.achFilter==="unlocked"?"active":""}" data-f="unlocked">Obtenidos (${unlocked.length})</button>
      <button class="ach-filter-btn ${STATE.achFilter==="locked"?"active":""}"   data-f="locked">Faltantes (${locked.length})</button>
    </div>
    <div class="ach-list">
      ${filtered.map(a => `
        <div class="ach-item ${a.achieved?"unlocked":"locked"}">
          <img class="ach-ico" src="${a.achieved?(a.icon||""):(a.icongray||a.icon||"")}" onerror="this.style.display='none'" alt="">
          <div class="ach-info">
            <div class="ach-name">${esc(a.displayName||a.apiname)}</div>
            ${a.description?`<div class="ach-desc">${esc(a.description)}</div>`:""}
            ${a.achieved&&a.unlocktime?`<div class="ach-date">Obtenido: ${fmtDate(a.unlocktime)}</div>`:""}
          </div>
          <span class="ach-chk">${a.achieved?"✅":"🔒"}</span>
        </div>
      `).join("")}
    </div>
  `;

  inner.querySelectorAll(".ach-filter-btn[data-f]").forEach(btn => {
    btn.addEventListener("click", () => { STATE.achFilter = btn.dataset.f; renderAchievementsContent(); });
  });
}

/* ═══════════════════════════════════════
   RENDER: AMIGOS
   ═══════════════════════════════════════ */
async function renderFriends() {
  setTitle("Amigos", "");
  const el = document.getElementById("view-friends");

  if (!STATE.friends.length) {
    el.innerHTML = `<div class="empty-view"><div class="ev-icon">👥</div><p>${CONFIG.ERRORS.NO_FRIENDS}</p></div>`;
    return;
  }

  const pp = CONFIG.FRIENDS_PER_PAGE;
  const totalPages = Math.ceil(STATE.friends.length / pp);
  const page = Math.min(STATE.friendsPage, totalPages || 1);
  const slice = STATE.friends.slice((page-1)*pp, page*pp);
  const ids = slice.map(f => f.steamid);

  setTitle("Amigos", STATE.friends.length + " amigos");

  el.innerHTML = `<div class="spinner" style="display:block;margin:40px auto"></div>`;

  let summaries = [];
  try { summaries = await fetchFriendsSummaries(ids); } catch { summaries = []; }
  const smap = Object.fromEntries(summaries.map(s => [s.steamid, s]));

  el.innerHTML = `
    <div class="friends-grid">
      ${slice.map(f => {
        const s  = smap[f.steamid] || {};
        const si = stateInfo(s.personastate);
        return `
          <a class="friend-card" href="${s.profileurl||"https://steamcommunity.com/profiles/"+f.steamid}" target="_blank" rel="noopener">
            <div class="friend-av">
              <img src="${s.avatarmedium||CONFIG.DEFAULT_AVATAR}" onerror="this.src='${CONFIG.DEFAULT_AVATAR}'" alt="" loading="lazy">
              <span class="friend-dot" style="background:${si.color}"></span>
            </div>
            <div>
              <div class="friend-name">${esc(s.personaname||f.steamid)}</div>
              <div class="friend-state">${si.label}</div>
              <div class="friend-since">Desde ${fmtDateShort(f.friend_since)}</div>
            </div>
          </a>
        `;
      }).join("")}
    </div>
    ${totalPages > 1 ? makePagination(page, totalPages, "friends") : ""}
  `;

  bindPagination(el, "friends");
}

/* ═══════════════════════════════════════
   RENDER: BANEOS
   ═══════════════════════════════════════ */
function renderBans() {
  setTitle("Baneos", "");
  const el = document.getElementById("view-bans");
  const b  = STATE.banInfo;

  if (!b) {
    el.innerHTML = `<div class="empty-view"><div class="ev-icon">🛡️</div><p>No se pudo obtener información de baneos.</p></div>`;
    return;
  }

  const hasBan = b.VACBanned || b.CommunityBanned || b.EconomyBan !== "none";

  el.innerHTML = `
    <div class="bans-grid">
      <div class="ban-card">
        <div class="ban-card-title" style="color:${hasBan?"var(--accent-red)":"var(--accent-green)"}">
          ${hasBan?"⚠️":"✅"} Estado general
        </div>
        <div class="ban-row">
          <span class="ban-key">Resumen</span>
          <span>${hasBan
            ? `<span class="badge-ban">Restricciones activas</span>`
            : `<span class="badge-clean">Perfil limpio</span>`
          }</span>
        </div>
      </div>
      <div class="ban-card">
        <div class="ban-card-title">🔫 VAC</div>
        <div class="ban-row"><span class="ban-key">Baneado VAC</span><span style="color:${b.VACBanned?"var(--accent-red)":"var(--accent-green)"}">${b.VACBanned?"Sí ⚠️":"No ✅"}</span></div>
        <div class="ban-row"><span class="ban-key">N° de baneos</span><span>${b.NumberOfVACBans}</span></div>
        <div class="ban-row"><span class="ban-key">Días desde ban</span><span>${b.VACBanned?b.DaysSinceLastBan+" días":"—"}</span></div>
      </div>
      <div class="ban-card">
        <div class="ban-card-title">🏘️ Comunidad</div>
        <div class="ban-row"><span class="ban-key">Baneo comunidad</span><span style="color:${b.CommunityBanned?"var(--accent-red)":"var(--accent-green)"}">${b.CommunityBanned?"Sí ⚠️":"No ✅"}</span></div>
        <div class="ban-row"><span class="ban-key">Baneo economía</span><span style="color:${b.EconomyBan!=="none"?"var(--accent-red)":"var(--accent-green)"}">${b.EconomyBan!=="none"?b.EconomyBan+" ⚠️":"Ninguno ✅"}</span></div>
        <div class="ban-row"><span class="ban-key">Baneos en juegos</span><span>${b.NumberOfGameBans}</span></div>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════
   NAVEGACIÓN
   ═══════════════════════════════════════ */
const SECTION_TITLES = {
  recent:       "Actividad reciente",
  games:        "Juegos",
  achievements: "Logros",
  friends:      "Amigos",
  bans:         "Baneos",
  videos:       "Videos",
  screenshots:  "Capturas",
};

function setTitle(title, badge) {
  document.getElementById("section-title").textContent = title;
  const b = document.getElementById("section-badge");
  if (badge) { b.textContent = badge; b.classList.remove("hidden"); }
  else b.classList.add("hidden");
}

function switchSection(section) {
  if (!STATE.playerData && section !== "recent") {
    toast("Buscá un perfil primero.", "error"); return;
  }

  STATE.activeSection = section;

  // Actualizar menú derecho
  document.querySelectorAll(".rn-item").forEach(i => {
    i.classList.toggle("active", i.dataset.section === section);
  });

  // Ocultar el estado vacío inicial
  document.getElementById("content-empty").style.display   = "none";
  document.getElementById("content-loading").classList.add("hidden");

  // Ocultar todas las vistas, mostrar la activa
  document.querySelectorAll(".c-view").forEach(v => v.classList.add("hidden"));
  const activeView = document.getElementById("view-" + section);
  if (activeView) activeView.classList.remove("hidden");

  // Renderizar según sección
  setTitle(SECTION_TITLES[section] || section, "");

  if (section === "recent")       renderRecent();
  if (section === "games")        renderGames();
  if (section === "achievements") renderAchievements();
  if (section === "friends")      renderFriends();
  if (section === "bans")         renderBans();
}

/* ═══════════════════════════════════════
   BÚSQUEDA PRINCIPAL
   ═══════════════════════════════════════ */
async function searchProfile() {
  const rawInput = document.getElementById("input-steamid").value.trim();
  const apiKey   = document.getElementById("input-apikey").value.trim();

  if (!apiKey)   { toast(CONFIG.ERRORS.NO_API_KEY,  "error"); return; }
  if (!rawInput) { toast(CONFIG.ERRORS.NO_STEAM_ID, "error"); return; }

  STATE.apiKey = apiKey;
  localStorage.setItem(CONFIG.LS_KEYS.API_KEY,  apiKey);

  // Mostrar loading
  document.getElementById("content-empty").style.display = "none";
  document.querySelectorAll(".c-view").forEach(v => v.classList.add("hidden"));
  document.getElementById("content-loading").classList.remove("hidden");

  try {
    const steamId = await resolveSteamId(rawInput);
    STATE.steamId = steamId;
    localStorage.setItem(CONFIG.LS_KEYS.STEAM_ID, rawInput);

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

    try { STATE.friends = await fetchFriends(steamId); } catch { STATE.friends = []; }

    // Renderizar panel izquierdo
    renderLeftPanel(player);

    // Ocultar loading, mostrar sección default
    document.getElementById("content-loading").classList.add("hidden");
    switchSection("recent");

    toast("Perfil cargado: " + player.personaname, "success");

  } catch(err) {
    document.getElementById("content-loading").classList.add("hidden");
    document.getElementById("content-empty").style.display = "flex";
    toast(err.message || CONFIG.ERRORS.API_ERROR, "error");
  }
}

/* ═══════════════════════════════════════
   EXPORTAR JSON
   ═══════════════════════════════════════ */
function exportJSON() {
  if (!STATE.playerData) { toast("Buscá un perfil primero.", "error"); return; }
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
  const a    = Object.assign(document.createElement("a"), { href: url, download: "steaminfo_" + STATE.playerData.personaname + ".json" });
  a.click();
  URL.revokeObjectURL(url);
  toast("Datos exportados.", "success");
}

/* ═══════════════════════════════════════
   TOASTS
   ═══════════════════════════════════════ */
function toast(msg, type = "info") {
  const c = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML = (type==="success"?"✅":type==="error"?"⚠️":"ℹ️") + " " + esc(msg);
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 4000);
}

/* ═══════════════════════════════════════
   INICIALIZACIÓN
   ═══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  // Precargar desde localStorage
  const savedKey = localStorage.getItem(CONFIG.LS_KEYS.API_KEY);
  const savedId  = localStorage.getItem(CONFIG.LS_KEYS.STEAM_ID);
  if (savedKey) document.getElementById("input-apikey").value  = savedKey;
  if (savedId)  document.getElementById("input-steamid").value = savedId;

  // Botón buscar + Enter
  document.getElementById("btn-search").addEventListener("click", searchProfile);
  ["input-steamid","input-apikey"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => { if (e.key==="Enter") searchProfile(); });
  });

  // Menú derecho
  document.querySelectorAll(".rn-item").forEach(item => {
    item.addEventListener("click", () => switchSection(item.dataset.section));
  });

  // Filtros de juegos (toolbar del view-games)
  document.getElementById("games-search").addEventListener("input", e => {
    STATE.gamesFilter = e.target.value;
    STATE.gamesPage   = 1;
    if (STATE.activeSection === "games") renderGames();
  });
  document.getElementById("games-sort").addEventListener("change", e => {
    STATE.gamesSort = e.target.value;
    STATE.gamesPage = 1;
    if (STATE.activeSection === "games") renderGames();
  });

  // Cargar logros
  document.getElementById("btn-load-ach").addEventListener("click", () => {
    const sel = document.getElementById("ach-select");
    const appId = sel.value;
    if (!appId) { toast("Seleccioná un juego primero.", "error"); return; }
    const name = sel.options[sel.selectedIndex].text;
    loadAchievements(appId, name);
  });

  // Caché y exportar
  document.getElementById("btn-clear-cache").addEventListener("click", () => Cache.clearAll());
  document.getElementById("btn-export").addEventListener("click", exportJSON);
});