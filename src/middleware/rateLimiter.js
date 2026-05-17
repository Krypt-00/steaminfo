/**
 * src/middleware/rateLimiter.js
 * ─────────────────────────────────────────────────────────────────
 * Rate limiting por IP usando express-rate-limit.
 * - Límite global: aplica a todas las rutas /api/*.
 * - Límite estricto: aplica a endpoints costosos (logros, lista completa de juegos).
 * - Respuesta personalizada al superar el límite (JSON).
 * - Headers estándar RateLimit-* en cada respuesta.
 */

"use strict";

const rateLimit = require("express-rate-limit");
const config    = require("../../config");
const logger    = require("../utils/logger");

// ── Función para generar una respuesta de rate limit consistente ─
function rateLimitHandler(req, res) {
  logger.warn("Rate limit exceeded", {
    ip:       req.ip,
    path:     req.path,
    method:   req.method,
  });

  res.status(429).json({
    error:   "Demasiadas peticiones desde tu IP. Esperá un momento e intentá de nuevo.",
    code:    "RATE_LIMITED",
    retryAfterMs: req.rateLimit?.resetTime
      ? req.rateLimit.resetTime - Date.now()
      : config.rateLimit.windowMinutes * 60 * 1000,
  });
}

// ── Limiter general para todas las rutas /api/* ──────────────────
const generalLimiter = rateLimit({
  windowMs:         config.rateLimit.windowMinutes * 60 * 1000,
  max:              config.rateLimit.max,
  standardHeaders:  "draft-7",   // Agrega RateLimit headers estándar RFC
  legacyHeaders:    false,
  message:          null,        // Usamos el handler personalizado
  handler:          rateLimitHandler,

  // Excluir health check del rate limiting
  skip: (req) => req.path === "/health",

  // Identificar por IP real (útil detrás de un proxy/nginx)
  keyGenerator: (req) => {
    return req.ip || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  },
});

// ── Limiter estricto para endpoints "pesados" ────────────────────
// Endpoints como logros y juegos implican llamadas múltiples a Steam.
const strictLimiter = rateLimit({
  windowMs:        config.rateLimit.windowMinutes * 60 * 1000,
  max:             Math.floor(config.rateLimit.max / 3), // 1/3 del límite general
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  message:         null,
  handler:         rateLimitHandler,
  keyGenerator: (req) => {
    return req.ip || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  },
});

module.exports = { generalLimiter, strictLimiter };