/**
 * src/server.js
 * ─────────────────────────────────────────────────────────────────
 * Punto de entrada del servidor Express.
 * - Carga la configuración y el logger primero.
 * - Aplica middlewares globales (helmet, cors, body-parser,
 *   request logger, rate limiter).
 * - Monta las rutas de la API bajo /api/steam.
 * - Expone un endpoint /health para health checks.
 * - Registra el manejador global de errores al final.
 * - Maneja SIGTERM/SIGINT para un apagado ordenado.
 */

"use strict";

// ── Cargar .env primero (antes de cualquier otro require) ────────
// El dotenv está en config/index.js pero lo llamamos explícitamente
// aquí también para garantizar que process.env esté listo.
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express      = require("express");
const helmet       = require("helmet");
const cors         = require("cors");
const path         = require("path");

const config        = require("../config");
const logger        = require("./utils/logger");
const requestLogger = require("./middleware/requestLogger");
const { generalLimiter } = require("./middleware/rateLimiter");
const errorHandler  = require("./middleware/errorHandler");
const steamRoutes   = require("./routes/steam");

// ── Crear app ────────────────────────────────────────────────────
const app = express();

// ── Seguridad y cabeceras ────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// ── CORS ─────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, curl, etc.) en desarrollo
    if (!origin && !config.isProd) return callback(null, true);
    if (!origin || config.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    logger.warn("CORS rejected origin", { origin });
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods:     ["GET", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Steam-API-Key"],
  credentials: false,
}));

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// ── Request logging ──────────────────────────────────────────────
app.use(requestLogger);

// ── Trust proxy (si está detrás de nginx/reverse proxy) ─────────
if (config.isProd) {
  app.set("trust proxy", 1);
}

// ── Rate limiting global ─────────────────────────────────────────
app.use("/api/", generalLimiter);

// ── Health check (sin autenticación, sin rate limit) ─────────────
app.get("/health", (req, res) => {
  res.json({
    status:  "ok",
    uptime:  Math.floor(process.uptime()),
    env:     config.env,
    ts:      new Date().toISOString(),
  });
});

// ── Rutas principales ─────────────────────────────────────────────
app.use("/api/steam", steamRoutes);

// ── Frontend estático ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../frontend")));

// ── 404 para rutas desconocidas ──────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.path}`,
    code:  "NOT_FOUND",
  });
});

// ── Manejador global de errores (debe ser el ÚLTIMO middleware) ───
app.use(errorHandler);

// ── Iniciar servidor ──────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info(`SteamInfo backend corriendo`, {
    port: config.port,
    env:  config.env,
    pid:  process.pid,
  });
});

// ── Apagado ordenado ──────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`Señal ${signal} recibida. Cerrando servidor…`);
  server.close(() => {
    logger.info("Servidor cerrado correctamente.");
    process.exit(0);
  });

  // Forzar salida si el cierre tarda más de 10 s
  setTimeout(() => {
    logger.error("El servidor no cerró a tiempo. Forzando salida.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// Capturar excepciones no manejadas para evitar crashes silenciosos
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { message: err.message, stack: err.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: String(reason) });
});

module.exports = app; // para tests
