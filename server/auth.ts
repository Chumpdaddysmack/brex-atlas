import type { Request, Response, NextFunction, Express } from "express";
import session from "express-session";
import { timingSafeEqual } from "node:crypto";

// Extend session type
declare module "express-session" {
  interface SessionData {
    isAuthenticated?: boolean;
    loginAt?: number;
  }
}

// Constant-time password compare (prevents timing attacks)
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still do a compare to keep timing consistent
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

// Simple in-memory rate limiter for login attempts (per IP)
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (rec.count >= MAX_ATTEMPTS) return false;
  rec.count++;
  return true;
}

export function setupAuth(app: Express) {
  const password = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!password) {
    console.error("[auth] FATAL: ADMIN_PASSWORD env var not set. App will refuse all logins.");
  }
  if (!sessionSecret) {
    console.error("[auth] FATAL: SESSION_SECRET env var not set. Sessions will not work.");
  }

  // Session middleware — cookie expires when browser closes (no maxAge)
  app.use(
    session({
      secret: sessionSecret || "unsafe-dev-fallback-do-not-use-in-prod",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // HTTPS only in prod
        sameSite: "lax",
        // No maxAge → session cookie, cleared when browser closes
      },
    }),
  );

  // POST /api/login — check password, set session
  app.post("/api/login", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: "Too many login attempts. Wait a minute and try again." });
    }

    const submitted = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      return res.status(500).json({ error: "Server not configured. Contact administrator." });
    }
    if (!safeEqual(submitted, password)) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    req.session.isAuthenticated = true;
    req.session.loginAt = Date.now();
    // Force save before responding
    req.session.save((err) => {
      if (err) {
        console.error("[auth] session save error", err);
        return res.status(500).json({ error: "Login failed" });
      }
      res.json({ ok: true });
    });
  });

  // POST /api/logout — clear session
  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("[auth] session destroy error", err);
      }
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });

  // GET /api/auth/status — check if logged in (used by client on load)
  app.get("/api/auth/status", (req, res) => {
    res.json({ authenticated: !!req.session.isAuthenticated });
  });
}

// Middleware to protect API routes
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.isAuthenticated) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
}
