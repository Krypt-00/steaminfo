/**
 * config/index.js
 * ─────────────────────────────────────────────────────────────────
 * Carga el archivo .env y exporta toda la configuración del servidor
 * como un objeto tipado. Lanza un error temprano si falta alguna
 * variable obligatoria para evitar fallos en runtime.
 */

"use strict";

require("dotenv").config();

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Lee una variable de entorno; lanza si es obligatoria y falta.
 * @param {string}  key        - Nombre de la variable
 * @param {*}       fallback   - Valor por defecto (undefined = obligatoria)
 */
function env(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Variable de entorno faltante: ${key}. Revisá tu archivo .env`);
  }
  return val;
}

/** Convierte un string de orígenes separados por coma en array. */
function parseOrigins(str) {
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

// ── Configuración exportada ──────────────────────────────────────
const config = {
  /** Puerto HTTP del servidor Express */
  port: parseInt(env("PORT", "3000"), 10),

  /** Entorno de ejecución */
  env: env("NODE_ENV", "development"),

  /** ¿Estamos en producción? */
  isProd: env("NODE_ENV", "development") === "production",

  cors: {
    /** Lista de orígenes permitidos (CORS) */
    allowedOrigins: parseOrigins(
      env("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:5500")
    ),
  },

  rateLimit: {
    /** Peticiones máximas por IP por ventana */
    max: parseInt(env("RATE_LIMIT_MAX", "30"), 10),
    /** Duración de la ventana en minutos */
    windowMinutes: parseInt(env("RATE_LIMIT_WINDOW_MINUTES", "1"), 10),
  },

  cache: {
    /** TTL de la caché en segundos */
    ttlSeconds: parseInt(env("CACHE_TTL_SECONDS", "300"), 10),
    /** Máximo de entradas en la caché en memoria */
    maxKeys: parseInt(env("CACHE_MAX_KEYS", "500"), 10),
  },

  logging: {
    /** Nivel de Winston */
    level: env("LOG_LEVEL", "info"),
    /** Directorio de logs */
    dir: env("LOG_DIR", "./logs"),
    /** Días de retención de archivos de log */
    retentionDays: parseInt(env("LOG_RETENTION_DAYS", "14"), 10),
  },

  steam: {
    /** URL base de la Steam Web API */
    baseUrl: env("STEAM_API_BASE_URL", "https://api.steampowered.com"),
    /** Timeout para peticiones a Steam (ms) */
    timeoutMs: parseInt(env("STEAM_REQUEST_TIMEOUT_MS", "10000"), 10),
    /** Longitud de una API Key válida de Steam */
    apiKeyLength: parseInt(env("STEAM_API_KEY_LENGTH", "32"), 10),
  },
};

module.exports = config;