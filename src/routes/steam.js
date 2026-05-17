/**
 * src/routes/steam.js
 * ─────────────────────────────────────────────────────────────────
 * Define todas las rutas de la API bajo /api/steam.
 * Cada ruta valida entrada, consulta la caché, llama al servicio
 * de Steam API y devuelve JSON al cliente.
 */

"use strict";

const express  = require("express");
const router   = express.Router();

const steamApi = require("../services/steamApi");
const cache    = require("../services/cache");
const logger   = require("../utils/logger");
const { strictLimiter }   = require("../middleware/rateLimiter");
const {
  requireApiKey,
  validateSteamId,
  validateSteamIds,
  validateAppId,
  validateCount,
  validateLanguage,
  validateRelationship,
  validateBoolParam,
} = require("../utils/validators");

// ── Helper: respuesta de caché ───────────────────────────────────

/**
 * Intenta servir desde caché. Si hay HIT devuelve la respuesta
 * y retorna true. Si hay MISS, retorna false.
 */
function tryCache(res, key) {
  const cached = cache.get(key);
  if (cached.hit) {
    res.setHeader("X-Cache", "HIT");
    res.json(cached.data);
    return true;
  }
  res.setHeader("X-Cache", "MISS");
  return false;
}

// ── GET /api/steam/summaries ─────────────────────────────────────
// Resumen de perfil(es). Acepta uno o varios SteamIDs.
// Query params: steamids (requerido, separados por coma)
router.get("/summaries", requireApiKey, async (req, res, next) => {
  const idsResult = validateSteamIds(req.query.steamids);
  if (!idsResult.valid) return res.status(400).json({ error: idsResult.error, code: "VALIDATION_ERROR" });

  const cacheKey = cache.buildCacheKey("summaries", { steamids: idsResult.value.sort().join(",") }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const data = await steamApi.getPlayerSummaries(req.steamApiKey, idsResult.value);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/steam/recent ────────────────────────────────────────
// Juegos jugados en las últimas 2 semanas.
// Query params: steamid, count (opcional, default 10)
router.get("/recent", requireApiKey, async (req, res, next) => {
  const idResult    = validateSteamId(req.query.steamid);
  const countResult = validateCount(req.query.count, 50, 10);

  if (!idResult.valid)    return res.status(400).json({ error: idResult.error,    code: "VALIDATION_ERROR" });
  if (!countResult.valid) return res.status(400).json({ error: countResult.error, code: "VALIDATION_ERROR" });

  const cacheKey = cache.buildCacheKey("recent", { steamid: idResult.value, count: countResult.value }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const data = await steamApi.getRecentlyPlayedGames(req.steamApiKey, idResult.value, countResult.value);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/steam/games ─────────────────────────────────────────
// Todos los juegos en la librería. Endpoint costoso → strictLimiter.
// Query params: steamid, include_appinfo (0|1), include_free (0|1)
router.get("/games", requireApiKey, strictLimiter, async (req, res, next) => {
  const idResult          = validateSteamId(req.query.steamid);
  const appInfoResult     = validateBoolParam(req.query.include_appinfo, 1);
  const freeGamesResult   = validateBoolParam(req.query.include_free, 1);

  if (!idResult.valid) return res.status(400).json({ error: idResult.error, code: "VALIDATION_ERROR" });

  const cacheKey = cache.buildCacheKey("games", {
    steamid:      idResult.value,
    appinfo:      appInfoResult.value,
    free:         freeGamesResult.value,
  }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const data = await steamApi.getOwnedGames(
      req.steamApiKey,
      idResult.value,
      appInfoResult.value,
      freeGamesResult.value
    );
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/steam/achievements ──────────────────────────────────
// Logros de un juego específico. Endpoint costoso → strictLimiter.
// Query params: steamid, appid, language (opcional)
router.get("/achievements", requireApiKey, strictLimiter, async (req, res, next) => {
  const idResult   = validateSteamId(req.query.steamid);
  const appResult  = validateAppId(req.query.appid);
  const langResult = validateLanguage(req.query.language);

  if (!idResult.valid)  return res.status(400).json({ error: idResult.error,  code: "VALIDATION_ERROR" });
  if (!appResult.valid) return res.status(400).json({ error: appResult.error,  code: "VALIDATION_ERROR" });

  const cacheKey = cache.buildCacheKey("achievements", {
    steamid:  idResult.value,
    appid:    appResult.value,
    lang:     langResult.value,
  }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const [achievements, schema] = await Promise.all([
      steamApi.getPlayerAchievements(req.steamApiKey, idResult.value, appResult.value, langResult.value),
      steamApi.getGameSchema(req.steamApiKey, appResult.value, langResult.value),
    ]);
    const result = { achievements, schema };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/steam/friends ───────────────────────────────────────
// Lista de amigos.
// Query params: steamid, relationship (opcional, "friend"|"all")
router.get("/friends", requireApiKey, async (req, res, next) => {
  const idResult  = validateSteamId(req.query.steamid);
  const relResult = validateRelationship(req.query.relationship);

  if (!idResult.valid) return res.status(400).json({ error: idResult.error, code: "VALIDATION_ERROR" });

  const cacheKey = cache.buildCacheKey("friends", {
    steamid:      idResult.value,
    relationship: relResult.value,
  }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const data = await steamApi.getFriendList(req.steamApiKey, idResult.value, relResult.value);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/steam/bans ──────────────────────────────────────────
// Información de baneos.
// Query params: steamids (requerido, separados por coma)
router.get("/bans", requireApiKey, async (req, res, next) => {
  const idsResult = validateSteamIds(req.query.steamids);
  if (!idsResult.valid) return res.status(400).json({ error: idsResult.error, code: "VALIDATION_ERROR" });

  const cacheKey = cache.buildCacheKey("bans", { steamids: idsResult.value.sort().join(",") }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const data = await steamApi.getPlayerBans(req.steamApiKey, idsResult.value);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/steam/resolve ───────────────────────────────────────
// Convierte una vanity URL a SteamID64.
// Query params: vanityurl (requerido)
router.get("/resolve", requireApiKey, async (req, res, next) => {
  const vanity = req.query.vanityurl;
  if (!vanity || typeof vanity !== "string" || vanity.trim().length === 0) {
    return res.status(400).json({ error: "El parámetro 'vanityurl' es obligatorio.", code: "VALIDATION_ERROR" });
  }
  const clean = vanity.trim().replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 64);

  const cacheKey = cache.buildCacheKey("resolve", { vanityurl: clean }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const data = await steamApi.resolveVanityUrl(req.steamApiKey, clean);
    cache.set(cacheKey, data, 60); // TTL corto: 1 min (las vanity URLs cambian más seguido)
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/steam/friends/summaries ────────────────────────────
// Atajos: recibe una lista de steamids (de la lista de amigos)
// y devuelve sus summaries en batch. Máx 100 por vez.
router.get("/friends/summaries", requireApiKey, async (req, res, next) => {
  const idsResult = validateSteamIds(req.query.steamids);
  if (!idsResult.valid) return res.status(400).json({ error: idsResult.error, code: "VALIDATION_ERROR" });

  const cacheKey = cache.buildCacheKey("friends-summaries", { steamids: idsResult.value.sort().join(",") }, req.steamApiKey);
  if (tryCache(res, cacheKey)) return;

  try {
    const data = await steamApi.getPlayerSummaries(req.steamApiKey, idsResult.value);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/steam/cache ──────────────────────────────────────
// Limpia la caché en memoria (útil en desarrollo).
router.delete("/cache", (req, res) => {
  cache.flush();
  logger.info("Cache cleared via API");
  res.json({ ok: true, message: "Caché limpiada correctamente." });
});

// ── GET /api/steam/cache/stats ───────────────────────────────────
// Estadísticas de la caché.
router.get("/cache/stats", (req, res) => {
  res.json(cache.stats());
});

module.exports = router;
