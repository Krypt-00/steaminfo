/**
 * src/middleware/errorHandler.js
 * ─────────────────────────────────────────────────────────────────
 * Manejador global de errores de Express (4 parámetros).
 * - Captura errores lanzados con next(err) en cualquier ruta.
 * - Diferencia entre errores propios (SteamApiError) y errores
 *   inesperados del sistema.
 * - En producción no expone stack traces al cliente.
 */

"use strict";

const { SteamApiError } = require("../services/steamApi");
const logger            = require("../utils/logger");
const config            = require("../../config");

/**
 * @param {Error}                       err
 * @param {import('express').Request}   req
 * @param {import('express').Response}  res
 * @param {Function}                    next  - Requerido aunque no se use (firma de 4 parámetros)
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // ── Error conocido de la Steam API ────────────────────────────
  if (err instanceof SteamApiError) {
    logger.warn("SteamApiError handled", {
      code:    err.code,
      status:  err.status,
      message: err.message,
      path:    req.path,
    });

    return res.status(err.status).json({
      error:   err.message,
      code:    err.code,
    });
  }

  // ── Error de validación de Express (body-parser, etc.) ─────────
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "El cuerpo de la petición no es un JSON válido.",
      code:  "INVALID_JSON",
    });
  }

  // ── Error inesperado (bug, fallo de dependencia, etc.) ─────────
  logger.error("Unhandled error", {
    message: err.message,
    stack:   err.stack,
    path:    req.path,
    method:  req.method,
  });

  const body = {
    error: "Error interno del servidor.",
    code:  "INTERNAL_ERROR",
  };

  // Incluir stack trace solo en desarrollo
  if (!config.isProd) {
    body.stack = err.stack;
  }

  res.status(500).json(body);
}

module.exports = errorHandler;