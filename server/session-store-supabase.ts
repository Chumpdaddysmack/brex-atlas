// Supabase-backed express-session store.
//
// Persists sessions across container restarts / redeploys so users are not
// logged out every time Railway ships a new build.
//
// Zero new deps: uses the same @supabase/supabase-js client the storage layer
// already uses (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Zero new native
// modules; avoids the connect-pg-simple / pg native-build path that has
// previously crashed on Railway.
//
// Required table (create once via SQL editor in Supabase; RLS off, service role
// only reads/writes it):
//
//   create table if not exists session (
//     sid text primary key,
//     sess jsonb not null,
//     expire timestamptz not null
//   );
//   create index if not exists session_expire_idx on session (expire);
//
// If the table is missing, the store falls back to logging the error and
// returning "no such session" — the app keeps running but users get logged
// out on restart (same behavior as MemoryStore). Errors are logged loudly so
// the missing-table condition is obvious in Railway logs.

import { Store, SessionData } from "express-session";
import type { SupabaseClient } from "@supabase/supabase-js";

const TABLE = "session";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h; login flow uses browser session cookie so this is just a garbage-collect ceiling

export class SupabaseSessionStore extends Store {
  private client: SupabaseClient;
  private ttlMs: number;

  constructor(client: SupabaseClient, opts: { ttlMs?: number } = {}) {
    super();
    this.client = client;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  private expiresAt(sess: SessionData): string {
    const cookieExpires = sess.cookie?.expires;
    const ms =
      cookieExpires instanceof Date
        ? cookieExpires.getTime()
        : typeof cookieExpires === "string"
        ? new Date(cookieExpires).getTime()
        : Date.now() + this.ttlMs;
    return new Date(ms).toISOString();
  }

  get(sid: string, cb: (err: any, sess?: SessionData | null) => void): void {
    this.client
      .from(TABLE)
      .select("sess, expire")
      .eq("sid", sid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("[session-store] get failed", error.message);
          return cb(null, null);
        }
        if (!data) return cb(null, null);
        // Lazy expiry: don't return expired sessions
        if (data.expire && new Date(data.expire).getTime() < Date.now()) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        cb(null, data.sess as SessionData);
      });
  }

  set(sid: string, sess: SessionData, cb?: (err?: any) => void): void {
    const row = {
      sid,
      sess: sess as unknown as Record<string, unknown>,
      expire: this.expiresAt(sess),
    };
    this.client
      .from(TABLE)
      .upsert(row, { onConflict: "sid" })
      .then(({ error }) => {
        if (error) {
          console.error("[session-store] set failed", error.message);
          return cb?.(error);
        }
        cb?.();
      });
  }

  destroy(sid: string, cb?: (err?: any) => void): void {
    this.client
      .from(TABLE)
      .delete()
      .eq("sid", sid)
      .then(({ error }) => {
        if (error) {
          console.error("[session-store] destroy failed", error.message);
          return cb?.(error);
        }
        cb?.();
      });
  }

  touch(sid: string, sess: SessionData, cb?: () => void): void {
    // Refresh the expire timestamp only (avoid rewriting the whole sess blob)
    this.client
      .from(TABLE)
      .update({ expire: this.expiresAt(sess) })
      .eq("sid", sid)
      .then(({ error }) => {
        if (error) {
          console.error("[session-store] touch failed", error.message);
        }
        cb?.();
      });
  }
}
