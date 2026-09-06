import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve hashed assets aggressively (they never change under the same URL);
  // serve index.html with no-cache so a new deploy always ships the current
  // bundle filenames to the browser instead of a stale HTML pointing at a
  // deleted JS asset (which fell through to the SPA catch-all and returned
  // HTML for a .js URL, tripping the strict-MIME-type check in the browser).
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }),
  );

  // SPA fallback: return index.html only for HTML page requests. Requests
  // for missing assets (e.g. an old hashed /assets/foo.js after a deploy)
  // must return 404 — NOT the HTML shell, which would be interpreted as a
  // JS module and fail to parse.
  app.use("/{*path}", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const url = req.path;
    // Any request that looks like an asset (has an extension or lives under
    // /assets/) should have been served by express.static above; if we're
    // here, the file doesn't exist — do NOT serve HTML for it.
    if (url.startsWith("/assets/") || /\.[a-zA-Z0-9]{1,8}$/.test(url)) {
      return res.status(404).end();
    }
    res
      .setHeader("Cache-Control", "no-cache, no-store, must-revalidate")
      .sendFile(path.resolve(distPath, "index.html"));
  });
}
