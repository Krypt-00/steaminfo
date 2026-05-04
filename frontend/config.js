/**
 * config.js — Configuración global de SteamInfo
 * Contiene endpoints de la API, constantes de caché y mensajes de error.
 * La API Key NO se almacena aquí; se solicita en la interfaz y se guarda en localStorage.
 */

const CONFIG = {
  // ─── Proxy CORS ────────────────────────────────────────────────────────────
  // La Steam Web API no permite llamadas directas desde el navegador (CORS bloqueado).
  // Usamos un proxy público para desarrollo local. En producción, usa tu propio backend.
  CORS_PROXY: "https://corsproxy.io/?",

  // ─── Base URLs ──────────────────────────────────────────────────────────────
  STEAM_API_BASE: "https://api.steampowered.com",
  STEAM_CDN:      "https://media.steampowered.com/steamcommunity/public/images/apps",
  STEAM_PROFILE:  "https://steamcommunity.com",

  // ─── Endpoints de la Steam Web API ─────────────────────────────────────────
  ENDPOINTS: {
    RESOLVE_VANITY:   "/ISteamUser/ResolveVanityURL/v1/",
    PLAYER_SUMMARIES: "/ISteamUser/GetPlayerSummaries/v2/",
    OWNED_GAMES:      "/IPlayerService/GetOwnedGames/v1/",
    RECENT_GAMES:     "/IPlayerService/GetRecentlyPlayedGames/v1/",
    ACHIEVEMENTS:     "/ISteamUserStats/GetPlayerAchievements/v1/",
    GAME_SCHEMA:      "/ISteamUserStats/GetSchemaForGame/v2/",
    FRIEND_LIST:      "/ISteamUser/GetFriendList/v1/",
    PLAYER_BANS:      "/ISteamUser/GetPlayerBans/v1/",
  },

  // ─── Caché localStorage ──────────────────────────────────────────────────
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutos
  CACHE_PREFIX: "steaminfo_",
  LS_KEYS: {
    API_KEY:    "steaminfo_apikey",
    STEAM_ID:   "steaminfo_last_steamid",
    CACHE_META: "steaminfo_cache_meta",
  },

  // ─── Estados de jugador ──────────────────────────────────────────────────
  PLAYER_STATES: {
    0: { label: "Offline",       color: "#6b7280" },
    1: { label: "Online",        color: "#4ade80" },
    2: { label: "Busy",          color: "#f87171" },
    3: { label: "Away",          color: "#fbbf24" },
    4: { label: "Snooze",        color: "#a78bfa" },
    5: { label: "Looking to trade", color: "#60a5fa" },
    6: { label: "Looking to play",  color: "#34d399" },
  },

  // ─── Visibilidad del perfil ──────────────────────────────────────────────
  PROFILE_VISIBILITY: {
    1: "Private",
    2: "Friends only",
    3: "Public",
  },

  // ─── Mensajes de error ───────────────────────────────────────────────────
  ERRORS: {
    NO_API_KEY:       "Ingresá tu API Key de Steam para continuar.",
    NO_STEAM_ID:      "Ingresá un SteamID64 o URL de perfil.",
    INVALID_STEAM_ID: "El SteamID ingresado no es válido. Verificá en steamid.io.",
    VANITY_NOT_FOUND: "No se encontró ningún perfil con esa URL personalizada.",
    PRIVATE_PROFILE:  "Este perfil es privado. No se pueden obtener algunos datos.",
    NO_FRIENDS:       "La lista de amigos de este perfil es privada o está vacía.",
    NO_GAMES:         "La librería de este perfil es privada o no tiene juegos.",
    NO_RECENT:        "Este perfil no registra actividad reciente.",
    NO_ACHIEVEMENTS:  "No hay logros registrados para este juego o el perfil es privado.",
    API_ERROR:        "Error al conectar con la API de Steam. Verificá tu API Key.",
    CORS_ERROR:       "Error de red. Intentá nuevamente en unos segundos.",
    RATE_LIMIT:       "Límite de solicitudes alcanzado. Esperá un momento e intentá de nuevo.",
    VANITY_RESOLVE_FAIL: "No se pudo resolver la URL de vanidad. Probá con el SteamID64 directo.",
  },

  // ─── Configuración de paginación ─────────────────────────────────────────
  GAMES_PER_PAGE:   20,
  FRIENDS_PER_PAGE: 24,

  // ─── Imágenes por defecto ─────────────────────────────────────────────────
  DEFAULT_AVATAR: "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
  DEFAULT_GAME_IMG: "https://via.placeholder.com/184x69/1b2838/66c0f4?text=No+Image",
};

// Exportación para uso en script.js (compatible con módulos y carga directa)
if (typeof module !== "undefined") module.exports = CONFIG;