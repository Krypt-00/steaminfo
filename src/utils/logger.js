/**
 * src/utils/logger.js
 * ─────────────────────────────────────────────────────────────────
 * Logger centralizado usando Winston.
 * - Escribe a consola (con colores en dev, JSON en prod).
 * - Escribe a archivo diario rotativo en logs/requests.log.
 * - Escribe errores en un archivo separado logs/error.log.
 *
 * Uso:
 *   const logger = require('./utils/logger');
 *   logger.info('Mensaje', { meta: 'datos' });
 *   logger.error('Fallo', { error: err.message });
 */

"use strict";

const path    = require("path");
const fs      = require("fs");
const winston = require("winston");
require("winston-daily-rotate-file");

const config = require("../../config");

// Asegurar que el directorio de logs exista
const logDir = path.resolve(config.logging.dir);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ── Formatos ─────────────────────────────────────────────────────

/** Formato legible para consola en desarrollo */
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? " " + JSON.stringify(meta, null, 0)
      : "";
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

/** Formato JSON compacto para archivos y producción */
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ── Transportes ──────────────────────────────────────────────────

const transports = [];

// Consola (siempre activo; formato según entorno)
transports.push(
  new winston.transports.Console({
    format: config.isProd ? fileFormat : devFormat,
    silent: config.env === "test",
  })
);

// Archivo rotativo diario — todas las peticiones / info
transports.push(
  new winston.transports.DailyRotateFile({
    filename:     path.join(logDir, "requests-%DATE%.log"),
    datePattern:  "YYYY-MM-DD",
    zippedArchive: true,
    maxFiles:     `${config.logging.retentionDays}d`,
    format:       fileFormat,
    level:        "info",
  })
);

// Archivo rotativo diario — solo errores
transports.push(
  new winston.transports.DailyRotateFile({
    filename:     path.join(logDir, "error-%DATE%.log"),
    datePattern:  "YYYY-MM-DD",
    zippedArchive: true,
    maxFiles:     `${config.logging.retentionDays}d`,
    format:       fileFormat,
    level:        "error",
  })
);

// ── Instancia del logger ──────────────────────────────────────────
const logger = winston.createLogger({
  level:            config.logging.level,
  transports,
  // No crashear si un transport falla
  exitOnError: false,
});

module.exports = logger;