/**
 * src/services/cache.js
 * ─────────────────────────────────────────────────────────────────
 * Servicio de caché en memoria usando node-cache.
 * - Clave = hash de (endpoint + parámetros + API Key).
 * - TTL configurable via .env (default: 300 seg = 5 min).
 * - Expone set(), get(), del() y stats().
 * - Incluye utilidad para generar claves reproducibles.
 *
 * Nota: node-cache vive en el proceso de Node. Si el servidor
 * se reinicia, la caché se limpia. Para producción multi-instancia,
 * reemplazá por Redis (ver comentario al final del archivo).
 */

"use strict";

const NodeCache = require("node-cache");
const config    = require("../../config");
const logger    = require("../utils/logger");

// ── Instancia de la caché ────────────────────────────────────────
const cache = new NodeCache({
  stdTTL:      config.cache.ttlSeconds,
  checkperiod: Math.ceil(config.cache.ttlSeconds / 2), // limpieza automática cada 2.5 min
  maxKeys:     config.cache.maxKeys,
  useClones:   false, // evitar overhead de clonación profunda
});

// Loguear cuando se elimina una clave automáticamente (TTL)
cache.on("expired", (key) => {
  logger.debug("Cache expired", { key: key.substring(0, 40) + "…" });
});

// ── Generador de clave de caché ──────────────────────────────────

/**
 * Genera una clave determinística para la caché.
 * Ordena las claves del objeto params alfabéticamente para que
 * {steamid: "X", count: 5} y {count: 5, steamid: "X"} generen
 * la misma clave de caché.
 *
 * @param {string} endpoint  - Nombre del endpoint (ej: "summaries")
 * @param {object} params    - Parámetros de la petición
 * @param {string} apiKey    - API Key de Steam del usuario
 * @returns {string}
 */
function buildCacheKey(endpoint, params, apiKey) {
  // Incluir los últimos 8 chars de la API Key (no la clave completa por seguridad)
  const keyFragment = apiKey.slice(-8);
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join("&");
  return `${endpoint}:${sortedParams}:${keyFragment}`;
}

// ── API pública ──────────────────────────────────────────────────

/**
 * Busca un valor en la caché.
 * @param {string} key
 * @returns {{ hit: boolean, data?: any }}
 */
function get(key) {
  const value = cache.get(key);
  if (value === undefined) return { hit: false };
  return { hit: true, data: value };
}

/**
 * Guarda un valor en la caché.
 * @param {string} key
 * @param {any}    value
 * @param {number} [ttl]  - TTL en segundos (opcional, usa el default si no se pasa)
 */
function set(key, value, ttl) {
  if (ttl !== undefined) {
    cache.set(key, value, ttl);
  } else {
    cache.set(key, value);
  }
}

/**
 * Elimina una entrada de la caché.
 * @param {string} key
 */
function del(key) {
  cache.del(key);
}

/**
 * Limpia toda la caché.
 */
function flush() {
  cache.flushAll();
  logger.info("Cache flushed manually");
}

/**
 * Retorna estadísticas de la caché.
 * @returns {{ keys: number, hits: number, misses: number, ksize: number, vsize: number }}
 */
function stats() {
  return cache.getStats();
}

module.exports = { get, set, del, flush, buildCacheKey, stats };

/*
 * ── MIGRACIÓN A REDIS (para producción multi-instancia) ──────────
 *
 * Si querés escalar a múltiples instancias de Node, reemplazá
 * node-cache por ioredis:
 *
 *   npm install ioredis
 *
 * Luego cambiá este servicio:
 *
 *   const Redis = require("ioredis");
 *   const redis = new Redis({ host: process.env.REDIS_HOST, port: 6379 });
 *
 *   async function get(key) {
 *     const raw = await redis.get(key);
 *     if (!raw) return { hit: false };
 *     return { hit: true, data: JSON.parse(raw) };
 *   }
 *
 *   async function set(key, value, ttl = config.cache.ttlSeconds) {
 *     await redis.set(key, JSON.stringify(value), "EX", ttl);
 *   }
 *
 * El resto de la lógica del servidor no necesita cambios.
 */