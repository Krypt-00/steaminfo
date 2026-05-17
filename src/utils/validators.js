/**
 * src/utils/validators.js
 * ─────────────────────────────────────────────────────────────────
 * Funciones de validación y sanitización de todos los parámetros
 * que llegan al backend desde el frontend.
 *
 * Principio: rechazar temprano con mensajes claros.
 * Ningún parámetro llega a la Steam API sin pasar por estas funciones.
 */

"use strict";

const config = require("../../config");

// ── Constantes de validación ─────────────────────────────────────

/** Regex: SteamID64 válido (17 dígitos, empieza con 7656) */
const STEAMID64_RE = /^7656\d{13}$/;

/** Regex: API Key de Steam (32 caracteres hexadecimales, mayúsculas o minúsculas) */
const API_KEY_RE = /^[A-Fa-f0-9]{32}$/;

/** Regex: AppID de Steam (1 a 7 dígitos numéricos) */
const APPID_RE = /^\d{1,7}$/;

/** Máxima cantidad de steamids aceptados en una sola llamada por lotes */
const MAX_BATCH_STEAMIDS = 100;

// ── Validadores individuales ─────────────────────────────────────

/**
 * Valida y sanitiza una API Key de Steam.
 * @param {string} key
 * @returns {{ valid: boolean, error?: string, value?: string }}
 */
function validateApiKey(key) {
  if (!key || typeof key !== "string") {
    return { valid: false, error: "API Key faltante (header X-Steam-API-Key o campo apiKey)." };
  }
  const trimmed = key.trim();
  if (trimmed.length !== config.steam.apiKeyLength) {
    return { valid: false, error: `La API Key debe tener exactamente ${config.steam.apiKeyLength} caracteres.` };
  }
  if (!API_KEY_RE.test(trimmed)) {
    return { valid: false, error: "La API Key solo puede contener caracteres hexadecimales (0-9, A-F)." };
  }
  return { valid: true, value: trimmed };
}

/**
 * Valida un SteamID64 único.
 * @param {string|number} id
 * @returns {{ valid: boolean, error?: string, value?: string }}
 */
function validateSteamId(id) {
  if (!id && id !== 0) {
    return { valid: false, error: "El parámetro 'steamid' es obligatorio." };
  }
  const str = String(id).trim();
  if (!STEAMID64_RE.test(str)) {
    return {
      valid: false,
      error: `SteamID inválido: "${str}". Debe ser un número de 17 dígitos empezando con 7656.`,
    };
  }
  return { valid: true, value: str };
}

/**
 * Valida uno o varios SteamIDs (separados por coma o como array).
 * @param {string|string[]} ids
 * @returns {{ valid: boolean, error?: string, value?: string[] }}
 */
function validateSteamIds(ids) {
  if (!ids) {
    return { valid: false, error: "El parámetro 'steamids' es obligatorio." };
  }

  // Normalizar a array
  const arr = Array.isArray(ids)
    ? ids.map(String)
    : String(ids).split(",").map(s => s.trim());

  if (arr.length === 0) {
    return { valid: false, error: "Debés ingresar al menos un SteamID." };
  }
  if (arr.length > MAX_BATCH_STEAMIDS) {
    return { valid: false, error: `Máximo ${MAX_BATCH_STEAMIDS} SteamIDs por petición.` };
  }

  const invalid = arr.filter(id => !STEAMID64_RE.test(id));
  if (invalid.length > 0) {
    return {
      valid: false,
      error: `SteamID(s) inválido(s): ${invalid.slice(0, 5).join(", ")}`,
    };
  }

  return { valid: true, value: arr };
}

/**
 * Valida un AppID de juego de Steam.
 * @param {string|number} appid
 * @returns {{ valid: boolean, error?: string, value?: string }}
 */
function validateAppId(appid) {
  if (!appid && appid !== 0) {
    return { valid: false, error: "El parámetro 'appid' es obligatorio." };
  }
  const str = String(appid).trim();
  if (!APPID_RE.test(str)) {
    return { valid: false, error: `AppID inválido: "${str}". Debe ser un número entre 1 y 9999999.` };
  }
  return { valid: true, value: str };
}

/**
 * Valida el parámetro 'count' (cantidad de resultados).
 * @param {string|number} count
 * @param {number} max    - Máximo permitido
 * @param {number} def    - Valor por defecto
 */
function validateCount(count, max = 10, def = 10) {
  if (count === undefined || count === null || count === "") return { valid: true, value: def };
  const n = parseInt(count, 10);
  if (isNaN(n) || n < 1) return { valid: false, error: "'count' debe ser un número positivo." };
  return { valid: true, value: Math.min(n, max) };
}

/**
 * Valida el parámetro 'language' (código de idioma).
 * Solo permite letras minúsculas (ej: "spanish", "english", "latam").
 */
function validateLanguage(lang, def = "spanish") {
  if (!lang) return { valid: true, value: def };
  const clean = String(lang).replace(/[^a-z]/g, "").slice(0, 10);
  return { valid: true, value: clean || def };
}

/**
 * Valida el parámetro 'relationship' de la lista de amigos.
 */
function validateRelationship(rel) {
  const allowed = ["friend", "all"];
  const clean = String(rel || "friend").trim().toLowerCase();
  return { valid: true, value: allowed.includes(clean) ? clean : "friend" };
}

/**
 * Valida si include_appinfo e include_played_free_games son booleanos.
 * Acepta "1", "true", true → 1; otro valor → 0.
 */
function validateBoolParam(val, def = 1) {
  if (val === undefined || val === null) return { valid: true, value: def };
  return { valid: true, value: (val === "1" || val === true || val === "true") ? 1 : 0 };
}

// ── Middleware de validación ──────────────────────────────────────

/**
 * Extrae y valida la API Key desde el header o el query/body.
 * Si es inválida, responde 400 y corta el ciclo.
 */
function requireApiKey(req, res, next) {
  const key =
    req.headers["x-steam-api-key"] ||
    req.query.apiKey                ||
    req.body?.apiKey;

  const result = validateApiKey(key);
  if (!result.valid) {
    return res.status(400).json({ error: result.error, code: "INVALID_API_KEY" });
  }

  // Adjuntar al objeto request para uso en rutas
  req.steamApiKey = result.value;
  next();
}

module.exports = {
  validateApiKey,
  validateSteamId,
  validateSteamIds,
  validateAppId,
  validateCount,
  validateLanguage,
  validateRelationship,
  validateBoolParam,
  requireApiKey,
};