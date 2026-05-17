/**
 * src/services/steamApi.js
 * ─────────────────────────────────────────────────────────────────
 * Cliente HTTP para la Steam Web API.
 * - Usa axios con timeout configurado.
 * - Traduce los errores HTTP de Steam a errores semánticos propios.
 * - Cada función corresponde a un endpoint de Steam.
 * - Nada de esto hace caché; eso lo maneja la capa de rutas.
 */

"use strict";

const axios  = require("axios");
const config = require("../../config");
const logger = require("../utils/logger");

// ── Instancia de axios configurada ──────────────────────────────
const steamHttp = axios.create({
  baseURL: config.steam.baseUrl,
  timeout: config.steam.timeoutMs,
  headers: { "Accept": "application/json" },
});

// ── Errores propios ──────────────────────────────────────────────

class SteamApiError extends Error {
  /**
   * @param {string} message  - Mensaje legible
   * @param {number} status   - HTTP status code a devolver al cliente
   * @param {string} code     - Código interno del error
   */
  constructor(message, status = 500, code = "STEAM_API_ERROR") {
    super(message);
    this.name  = "SteamApiError";
    this.status = status;
    this.code  = code;
  }
}

// ── Función central de llamada ───────────────────────────────────

/**
 * Realiza una petición GET a la Steam Web API.
 * @param {string} endpoint   - Ruta del endpoint (ej: "/ISteamUser/GetPlayerSummaries/v2/")
 * @param {string} apiKey     - API Key de Steam del usuario
 * @param {object} params     - Parámetros adicionales del query string
 * @returns {Promise<object>} - Datos de la respuesta de Steam
 * @throws {SteamApiError}
 */
async function callSteamApi(endpoint, apiKey, params = {}) {
  const startTime = Date.now();

  try {
    const response = await steamHttp.get(endpoint, {
      params: {
        key:    apiKey,
        format: "json",
        ...params,
      },
    });

    const elapsed = Date.now() - startTime;
    logger.debug("Steam API call OK", { endpoint, elapsed });

    return response.data;

  } catch (err) {
    const elapsed = Date.now() - startTime;

    // ── Mapeo de errores HTTP de Steam ───────────────────────────
    if (err.response) {
      const status = err.response.status;
      logger.warn("Steam API error response", { endpoint, status, elapsed });

      switch (status) {
        case 400:
          throw new SteamApiError(
            "Parámetros inválidos enviados a la Steam API.",
            400, "BAD_REQUEST"
          );
        case 401:
          throw new SteamApiError(
            "API Key de Steam inválida o expirada. Verificá tu clave en steamcommunity.com/dev/apikey.",
            401, "INVALID_API_KEY"
          );
        case 403:
          throw new SteamApiError(
            "Perfil privado o acceso denegado. Este perfil no permite acceso público.",
            403, "PRIVATE_PROFILE"
          );
        case 404:
          throw new SteamApiError(
            "Recurso no encontrado en Steam. Verificá el SteamID o AppID.",
            404, "NOT_FOUND"
          );
        case 429:
          throw new SteamApiError(
            "Límite de peticiones de Steam excedido. Esperá unos minutos e intentá de nuevo.",
            429, "RATE_LIMITED"
          );
        case 500:
        case 502:
        case 503:
        case 504:
          throw new SteamApiError(
            "Los servidores de Steam están experimentando problemas. Intentá más tarde.",
            502, "STEAM_SERVER_ERROR"
          );
        default:
          throw new SteamApiError(
            `Error inesperado de Steam: HTTP ${status}.`,
            502, "STEAM_UNKNOWN_ERROR"
          );
      }
    }

    // ── Timeout ──────────────────────────────────────────────────
    if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
      logger.error("Steam API timeout", { endpoint, timeoutMs: config.steam.timeoutMs });
      throw new SteamApiError(
        `La petición a Steam tardó más de ${config.steam.timeoutMs / 1000} segundos. Intentá de nuevo.`,
        504, "TIMEOUT"
      );
    }

    // ── Error de red ─────────────────────────────────────────────
    if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
      logger.error("Steam API network error", { endpoint, code: err.code });
      throw new SteamApiError(
        "No se pudo conectar con los servidores de Steam. Verificá tu conexión.",
        503, "NETWORK_ERROR"
      );
    }

    // ── Error desconocido ─────────────────────────────────────────
    logger.error("Steam API unexpected error", { endpoint, message: err.message });
    throw new SteamApiError(
      "Error inesperado al comunicarse con Steam.",
      500, "UNEXPECTED_ERROR"
    );
  }
}

// ── Funciones por endpoint ───────────────────────────────────────

/**
 * GetPlayerSummaries/v2
 * Devuelve el resumen de uno o varios perfiles.
 * @param {string}   apiKey   - API Key de Steam
 * @param {string[]} steamIds - Array de SteamID64
 */
async function getPlayerSummaries(apiKey, steamIds) {
  return callSteamApi("/ISteamUser/GetPlayerSummaries/v2/", apiKey, {
    steamids: steamIds.join(","),
  });
}

/**
 * GetRecentlyPlayedGames/v1
 * Juegos jugados en las últimas 2 semanas.
 * @param {string} apiKey
 * @param {string} steamId
 * @param {number} [count=10]
 */
async function getRecentlyPlayedGames(apiKey, steamId, count = 10) {
  return callSteamApi("/IPlayerService/GetRecentlyPlayedGames/v1/", apiKey, {
    steamid: steamId,
    count,
  });
}

/**
 * GetOwnedGames/v1
 * Todos los juegos en la librería del usuario.
 * @param {string}  apiKey
 * @param {string}  steamId
 * @param {0|1}     includeAppInfo
 * @param {0|1}     includeFreeGames
 */
async function getOwnedGames(apiKey, steamId, includeAppInfo = 1, includeFreeGames = 1) {
  return callSteamApi("/IPlayerService/GetOwnedGames/v1/", apiKey, {
    steamid:                    steamId,
    include_appinfo:            includeAppInfo,
    include_played_free_games:  includeFreeGames,
  });
}

/**
 * GetPlayerAchievements/v1
 * Logros obtenidos en un juego específico.
 * @param {string} apiKey
 * @param {string} steamId
 * @param {string} appId
 * @param {string} [language]
 */
async function getPlayerAchievements(apiKey, steamId, appId, language = "spanish") {
  return callSteamApi("/ISteamUserStats/GetPlayerAchievements/v1/", apiKey, {
    steamid: steamId,
    appid:   appId,
    l:       language,
  });
}

/**
 * GetSchemaForGame/v2
 * Metadatos de logros (iconos, descripción) de un juego.
 * @param {string} apiKey
 * @param {string} appId
 * @param {string} [language]
 */
async function getGameSchema(apiKey, appId, language = "spanish") {
  return callSteamApi("/ISteamUserStats/GetSchemaForGame/v2/", apiKey, {
    appid: appId,
    l:     language,
  });
}

/**
 * GetFriendList/v1
 * Lista de amigos del usuario.
 * @param {string} apiKey
 * @param {string} steamId
 * @param {string} [relationship="friend"]
 */
async function getFriendList(apiKey, steamId, relationship = "friend") {
  return callSteamApi("/ISteamUser/GetFriendList/v1/", apiKey, {
    steamid:      steamId,
    relationship,
  });
}

/**
 * GetPlayerBans/v1
 * Información de baneos (VAC, comunidad, economía).
 * @param {string}   apiKey
 * @param {string[]} steamIds
 */
async function getPlayerBans(apiKey, steamIds) {
  return callSteamApi("/ISteamUser/GetPlayerBans/v1/", apiKey, {
    steamids: steamIds.join(","),
  });
}

/**
 * ResolveVanityURL/v1
 * Convierte un nombre de vanidad en SteamID64.
 * @param {string} apiKey
 * @param {string} vanityUrl - Nombre de vanidad (ej: "gaben")
 */
async function resolveVanityUrl(apiKey, vanityUrl) {
  return callSteamApi("/ISteamUser/ResolveVanityURL/v1/", apiKey, {
    vanityurl: vanityUrl,
  });
}

module.exports = {
  SteamApiError,
  getPlayerSummaries,
  getRecentlyPlayedGames,
  getOwnedGames,
  getPlayerAchievements,
  getGameSchema,
  getFriendList,
  getPlayerBans,
  resolveVanityUrl,
};