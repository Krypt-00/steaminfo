/**
 * src/middleware/requestLogger.js
 * ─────────────────────────────────────────────────────────────────
 * Middleware que registra cada petición con:
 * - IP del cliente
 * - Método y ruta
 * - Status de respuesta
 * - Tiempo total de respuesta en ms
 * - HIT/MISS de caché (si el header X-Cache fue seteado)
 *
 * Se ejecuta DESPUÉS de la respuesta usando el evento 'finish' del
 * response para capturar el status code final.
 */

"use strict";

const logger = require("../utils/logger");

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const ip    = req.ip || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  // Escuchar el evento 'finish' (respuesta enviada al cliente)
  res.on("finish", () => {
    const elapsed  = Date.now() - start;
    const cacheHit = res.getHeader("X-Cache") || "BYPASS";
    const level    = res.statusCode >= 500 ? "error"
                   : res.statusCode >= 400 ? "warn"
                   : "info";

    logger[level](`${req.method} ${req.path}`, {
      ip,
      status:   res.statusCode,
      elapsed:  `${elapsed}ms`,
      cache:    cacheHit,
      ua:       req.headers["user-agent"]?.substring(0, 60),
    });
  });

  next();
}

module.exports = requestLogger;