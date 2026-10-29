type Role = "member" | "conductor" | "owner";
type VoicePart = "S" | "A" | "T" | "B";

// Bump these version strings whenever the actual documents are materially updated.
const TERMS_VERSION = "2026-10-28-v2";
const PRIVACY_VERSION = "2026-10-28-v3";

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number; [key: string]: unknown };
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}
interface AssetFetcher { fetch(request: Request): Promise<Response>; }
interface Env {
  ASSETS: AssetFetcher;
  DB?: D1Database;
  DEFAULT_CHOIR_SLUG?: string;
  AUTH_SECRET?: string;
  BOOTSTRAP_SETUP_KEY?: string;
  B2_ENDPOINT?: string;
  B2_REGION?: string;
  B2_BUCKET?: string;
  B2_KEY_ID?: string;
  B2_APP_KEY?: string;
}
interface ChoirRow { id: string; slug: string; name: string; }
interface SessionRow {
  sessionId: string; userId: string; displayName: string; role: Role;
  voicePart: VoicePart | null; phoneNumber: string | null;
  choirId: string; choirSlug: string; choirName: string;
}
interface UserPinRow {
  id: string; display_name: string; login_code_hash: string; phone_number: string | null;
  pin_salt: string; pin_hash: string; role: Role; voice_part: VoicePart | null;
  choir_id: string; choir_slug: string; choir_name: string;
}
interface ActivationRow {
  id: string; choir_id: string; intended_role: Role; voice_part: VoicePart | null;
  intended_phone_hash: string | null;
}
interface RateRow { attempts: number; window_started_at: number; }

const encoder = new TextEncoder();
const SESSION_DAYS = 14;
const AUTH_WINDOW_SECONDS = 900;
const PIN_ITERATIONS = 100000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VOICE_PARTS = ["S", "A", "T", "B"] as const;
const ACCENT_THEMES = ["ocean", "violet", "emerald", "rose", "amber", "teal", "slate", "berry"] as const;
const ATTENDANCE_STATUSES = ["present", "absent", "excused", "late"] as const;
type AccentTheme = typeof ACCENT_THEMES[number];
type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
function isAccentTheme(value: unknown): value is AccentTheme {
  return typeof value === "string" && (ACCENT_THEMES as readonly string[]).includes(value);
}
function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  });
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(data), { status, headers });
}
function fail(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}
function authConfigured(env: Env): boolean {
  return Boolean(env.DB && env.AUTH_SECRET && env.AUTH_SECRET.length >= 32);
}
function bootstrapConfigured(env: Env): boolean {
  return Boolean(env.BOOTSTRAP_SETUP_KEY && env.BOOTSTRAP_SETUP_KEY.length >= 32);
}
function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
// The app does not use email sign-in. Reuse the existing unique email_normalized
// column to store a canonical Romanian mobile number without requiring a D1 schema change.
function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("07")) return "+40" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("407")) return "+" + digits;
  if (digits.length === 13 && digits.startsWith("00407")) return "+40" + digits.slice(4);
  return null;
}
function formatCode(value: string): string {
  const normalized = normalizeCode(value);
  if (normalized.length === 10) return normalized.slice(0, 5) + "-" + normalized.slice(5);
  if (normalized.length === 16) {
    return normalized.slice(0, 4) + "-" + normalized.slice(4, 8) + "-" +
      normalized.slice(8, 12) + "-" + normalized.slice(12, 16);
  }
  return normalized;
}
function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(value: string): Uint8Array {
  const out = new Uint8Array(Math.floor(value.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function derivePinHash(pin: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = new ArrayBuffer(saltHex.length / 2);
  new Uint8Array(saltBuffer).set(hexToBytes(saltHex));
  const derived = await crypto.subtle.deriveBits({
    name: "PBKDF2", salt: saltBuffer, iterations: PIN_ITERATIONS, hash: "SHA-256"
  }, key, 256);
  return Array.from(new Uint8Array(derived), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let i = 0; i < maxLength; i += 1) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return difference === 0;
}
async function readJson(request: Request, maxBytes = 4096): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
function cookieName(request: Request): string {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" ? "choir_session" : "__Host-choir_session";
}
function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") || "";
  for (const item of cookie.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return null;
}
function sessionCookie(request: Request, token: string, maxAge: number): string {
  return cookieName(request) + "=" + token + "; Path=/; Max-Age=" + maxAge +
    "; HttpOnly; Secure; SameSite=Lax";
}
function isVoicePart(value: unknown): value is VoicePart {
  return typeof value === "string" && (VOICE_PARTS as readonly string[]).includes(value);
}
function isRole(value: unknown): value is Role {
  return value === "member" || value === "conductor" || value === "owner";
}
function validPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}
function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ");
  return cleaned.length >= 2 && cleaned.length <= 80 ? cleaned : null;
}
async function resolveChoirSlug(request: Request, env: Env): Promise<string | undefined> {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (hostname.endsWith(".workers.dev") || hostname === "localhost" || hostname === "127.0.0.1") {
    return env.DEFAULT_CHOIR_SLUG;
  }
  if (!env.DB) return undefined;
  const result = await env.DB.prepare(
    "SELECT c.slug FROM choir_domains AS d JOIN choirs AS c ON c.id = d.choir_id " +
    "WHERE lower(d.hostname) = ? AND d.status = 'active' AND c.status = 'active' LIMIT 1"
  ).bind(hostname).all<{ slug: string }>();
  return result.results?.[0]?.slug;
}
async function getChoir(request: Request, env: Env): Promise<ChoirRow | null> {
  if (!env.DB) return null;
  const slug = await resolveChoirSlug(request, env);
  if (!slug) return null;
  const result = await env.DB.prepare(
    "SELECT id, slug, name FROM choirs WHERE slug = ? AND status = 'active' LIMIT 1"
  ).bind(slug).all<ChoirRow>();
  return result.results?.[0] ?? null;
}
async function getCurrentSession(request: Request, env: Env): Promise<SessionRow | null> {
  if (!authConfigured(env) || !env.DB) return null;
  const rawToken = getCookie(request, cookieName(request));
  if (!rawToken || !/^[a-f0-9]{64}$/.test(rawToken)) return null;
  const tokenHash = await sha256(rawToken);
  const choir = await getChoir(request, env);
  if (!choir) return null;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "SELECT s.id AS sessionId, u.id AS userId, u.display_name AS displayName, u.email_normalized AS phoneNumber, " +
    "m.role AS role, m.voice_part AS voicePart, c.id AS choirId, c.slug AS choirSlug, c.name AS choirName " +
    "FROM sessions s JOIN users u ON u.id = s.user_id " +
    "JOIN choir_memberships m ON m.user_id = u.id AND m.choir_id = ? " +
    "JOIN choirs c ON c.id = m.choir_id " +
    "WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? " +
    "AND u.status = 'active' AND m.status = 'active' AND c.status = 'active' LIMIT 1"
  ).bind(choir.id, tokenHash, now).all<SessionRow>();
  const session = result.results?.[0] ?? null;
  return session && isRole(session.role) ? session : null;
}
async function createSession(
  env: Env, userId: string, sessionId: string
): Promise<{ token: string; result: D1Result }> {
  if (!env.DB) throw new Error("Database unavailable");
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const result = await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(sessionId, userId, tokenHash, expiresAt).run();
  return { token, result };
}
async function allowAttempt(
  request: Request, env: Env, action: string, maximum: number, identity?: string
): Promise<boolean> {
  if (!env.DB || !env.AUTH_SECRET) return false;
  const client = identity ?? request.headers.get("CF-Connecting-IP") ?? "unknown";
  const keyHash = await hmacHex(env.AUTH_SECRET, action + "|" + client);
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(
    "SELECT attempts, window_started_at FROM auth_rate_limits WHERE key_hash = ? AND action = ? LIMIT 1"
  ).bind(keyHash, action).all<RateRow>();
  const row = existing.results?.[0];
  if (row && now - Number(row.window_started_at) < AUTH_WINDOW_SECONDS &&
      Number(row.attempts) >= maximum) return false;
  await env.DB.prepare(
    "INSERT INTO auth_rate_limits (key_hash, action, window_started_at, attempts) VALUES (?, ?, ?, 1) " +
    "ON CONFLICT(key_hash, action) DO UPDATE SET " +
    "attempts = CASE WHEN excluded.window_started_at - auth_rate_limits.window_started_at >= 900 " +
    "THEN 1 ELSE auth_rate_limits.attempts + 1 END, " +
    "window_started_at = CASE WHEN excluded.window_started_at - auth_rate_limits.window_started_at >= 900 " +
    "THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END"
  ).bind(keyHash, action, now).run();
  return true;
}
async function recordAudit(
  env: Env, choirId: string, actorId: string | null, action: string,
  targetType: string | null, targetId: string | null, metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), choirId, actorId, action, targetType, targetId, JSON.stringify(metadata)).run();
}
async function hasCurrentLegalAcceptance(env: Env, userId: string, choirId: string): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    "SELECT id FROM audit_logs WHERE choir_id = ? AND actor_user_id = ? " +
    "AND action = 'legal.terms.accepted' " +
    "AND json_extract(metadata_json, '$.termsVersion') = ? " +
    "AND json_extract(metadata_json, '$.privacyVersion') = ? LIMIT 1"
  ).bind(choirId, userId, TERMS_VERSION, PRIVACY_VERSION).all<{ id: string }>();
  return Boolean(result.results?.length);
}
async function recordLegalAcceptance(
  env: Env, choirId: string, userId: string, acceptedVia: string
): Promise<void> {
  await recordAudit(env, choirId, userId, "legal.terms.accepted", "user", userId, {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedVia
  });
}
function authUnavailable(env: Env): Response | null {
  return authConfigured(env) ? null : fail(
    "authentication_not_configured",
    "Autentificarea nu este configurată complet. Administratorul trebuie să configureze D1 și secretul AUTH_SECRET în Cloudflare.",
    503
  );
}
async function setupStatus(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({
    authenticationConfigured: false, bootstrapKeyConfigured: false, ownerExists: false, setupAvailable: false
  });
  const choir = await getChoir(request, env);
  if (!choir) return json({
    authenticationConfigured: authConfigured(env), bootstrapKeyConfigured: bootstrapConfigured(env),
    ownerExists: false, setupAvailable: false, error: "choir_not_configured"
  }, 503);
  const result = await env.DB.prepare(
    "SELECT id FROM choir_memberships WHERE choir_id = ? AND role = 'owner' AND status = 'active' LIMIT 1"
  ).bind(choir.id).all<{ id: string }>();
  const ownerExists = Boolean(result.results?.length);
  const configured = authConfigured(env);
  const bootstrapKey = bootstrapConfigured(env);
  return json({
    authenticationConfigured: configured,
    bootstrapKeyConfigured: bootstrapKey,
    ownerExists,
    setupAvailable: configured && bootstrapKey && !ownerExists
  });
}
async function bootstrapOwner(request: Request, env: Env): Promise<Response> {
  const unavailable = authUnavailable(env);
  if (unavailable) return unavailable;
  if (!bootstrapConfigured(env)) return fail(
    "bootstrap_not_configured", "Configurarea inițială nu este activată pe server.", 503
  );
  if (!(await allowAttempt(request, env, "bootstrap", 6))) {
    return fail("rate_limited", "Prea multe încercări. Reîncearcă peste 15 minute.", 429);
  }
  const body = await readJson(request);
  if (!body) return fail("invalid_request", "Cerere invalidă.", 400);
  const setupKey = typeof body.setupKey === "string" ? body.setupKey : "";
  const displayName = cleanDisplayName(body.displayName);
  const pin = body.pin;
  if (body.acceptedLegal !== true) {
    return fail("legal_acceptance_required", "Pentru a crea contul, acceptă Termenii de utilizare și confirmă că ai citit Nota de informare privind datele personale.", 428);
  }
  if (!constantTimeEqual(setupKey, env.BOOTSTRAP_SETUP_KEY || "")) {
    return fail("invalid_setup_key", "Cheia de configurare nu este corectă.", 401);
  }
  if (!displayName || !validPin(pin)) {
    return fail("invalid_fields", "Completează numele și un PIN din 6 cifre.", 400);
  }
  if (!sameOrigin(request)) return fail("origin_not_allowed", "Cerere refuzată.", 403);
  const choir = await getChoir(request, env);
  if (!choir || !env.DB) return fail("choir_not_configured", "Corul nu este configurat.", 503);
  const loginCode = randomCode(10);
  const loginHash = await sha256(loginCode);
  const pinSalt = randomHex(16);
  const pinHash = await derivePinHash(pin, pinSalt);
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const statements = [
    env.DB.prepare(
      "INSERT INTO users (id, display_name, email_normalized, login_code_hash, pin_salt, pin_hash) " +
      "SELECT ?, ?, NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM choirs WHERE id = ? AND status = 'active') " +
      "AND NOT EXISTS (SELECT 1 FROM choir_memberships WHERE choir_id = ? AND role = 'owner' AND status = 'active')"
    ).bind(userId, displayName, loginHash, pinSalt, pinHash, choir.id, choir.id),
    env.DB.prepare(
      "INSERT INTO choir_memberships (id, choir_id, user_id, role, voice_part, status) " +
      "SELECT ?, ?, ?, 'owner', NULL, 'active' WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) " +
      "AND NOT EXISTS (SELECT 1 FROM choir_memberships WHERE choir_id = ? AND role = 'owner' AND status = 'active')"
    ).bind(membershipId, choir.id, userId, userId, choir.id),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) " +
      "SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM choir_memberships WHERE id = ? AND user_id = ? AND role = 'owner' AND status = 'active')"
    ).bind(sessionId, userId, tokenHash, expiresAt, membershipId, userId),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "SELECT ?, ?, ?, 'owner.bootstrap', 'user', ?, ? " +
      "WHERE EXISTS (SELECT 1 FROM choir_memberships WHERE id = ? AND user_id = ? AND role = 'owner' AND status = 'active')"
    ).bind(crypto.randomUUID(), choir.id, userId, userId, JSON.stringify({ role: "owner" }), membershipId, userId),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "SELECT ?, ?, ?, 'legal.terms.accepted', 'user', ?, ? " +
      "WHERE EXISTS (SELECT 1 FROM choir_memberships WHERE id = ? AND user_id = ? AND role = 'owner' AND status = 'active')"
    ).bind(crypto.randomUUID(), choir.id, userId, userId,
      JSON.stringify({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedVia: "owner_bootstrap" }), membershipId, userId)
  ];
  const results = await env.DB.batch(statements);
  if (Number(results[1]?.meta?.changes || 0) !== 1 || Number(results[2]?.meta?.changes || 0) !== 1 ||
      Number(results[4]?.meta?.changes || 0) !== 1) {
    return fail("setup_already_completed", "Contul principal a fost deja configurat sau configurarea nu a putut fi finalizată.", 409);
  }
  return json({
    authenticated: true,
    user: { displayName, role: "owner", voicePart: null, phoneNumber: null, choirName: choir.name },
    loginCode: formatCode(loginCode),
    message: "Păstrează codul contului. Este afișat o singură dată."
  }, 200, { "Set-Cookie": sessionCookie(request, token, SESSION_DAYS * 86400) });
}
async function activateAccount(request: Request, env: Env): Promise<Response> {
  const unavailable = authUnavailable(env);
  if (unavailable) return unavailable;
  if (!(await allowAttempt(request, env, "activate", 8))) {
    return fail("rate_limited", "Prea multe încercări. Reîncearcă peste 15 minute.", 429);
  }
  const body = await readJson(request);
  if (!body) return fail("invalid_request", "Cerere invalidă.", 400);
  const code = typeof body.code === "string" ? normalizeCode(body.code) : "";
  const displayName = cleanDisplayName(body.displayName);
  const phoneNumber = normalizePhone(body.phone);
  const pin = body.pin;
  if (body.acceptedLegal !== true) {
    return fail("legal_acceptance_required", "Pentru a activa contul, acceptă Termenii de utilizare și confirmă că ai citit Nota de informare privind datele personale.", 428);
  }
  if (code.length < 12 || !displayName || !phoneNumber || !validPin(pin)) {
    return fail("invalid_fields", "Completează codul de invitație, numele, un număr de mobil românesc și un PIN din 6 cifre.", 400);
  }
  if (!sameOrigin(request)) return fail("origin_not_allowed", "Cerere refuzată.", 403);
  const choir = await getChoir(request, env);
  if (!choir || !env.DB) return fail("choir_not_configured", "Corul nu este configurat.", 503);
  const phoneResult = await env.DB.prepare(
    "SELECT id FROM users WHERE email_normalized = ? LIMIT 1"
  ).bind(phoneNumber).all<{ id: string }>();
  if (phoneResult.results?.length) {
    return fail("phone_in_use", "Numărul acesta este deja asociat unui cont. Cere unui dirijor să te ajute.", 409);
  }
  const codeHash = await sha256(code);
  const now = new Date().toISOString();
  const candidateResult = await env.DB.prepare(
    "SELECT a.id, a.choir_id, a.intended_role, a.voice_part, " +
    "(SELECT json_extract(l.metadata_json, '$.phoneHash') FROM audit_logs l " +
    "WHERE l.choir_id = a.choir_id AND l.target_type = 'activation_code' " +
    "AND l.target_id = a.id AND l.action = 'activation_code.created' " +
    "ORDER BY l.created_at DESC LIMIT 1) AS intended_phone_hash " +
    "FROM activation_codes a WHERE a.code_hash = ? AND a.choir_id = ? " +
    "AND a.used_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > ? LIMIT 1"
  ).bind(codeHash, choir.id, now).all<ActivationRow>();
  const candidate = candidateResult.results?.[0];
  if (!candidate || !isRole(candidate.intended_role) ||
      (candidate.intended_role === "member" && !isVoicePart(candidate.voice_part))) {
    return fail("invalid_activation_code", "Codul nu este valid, a expirat sau a fost deja folosit.", 400);
  }
  // Legacy invitations may still be bound to a phone hash. New invitations
  // do not collect a phone number from the conductor; the member supplies it here.
  if (candidate.intended_phone_hash) {
    const submittedPhoneHash = await hmacHex(env.AUTH_SECRET || "", "activation-phone|" + phoneNumber);
    if (!constantTimeEqual(candidate.intended_phone_hash, submittedPhoneHash)) {
      return fail("phone_mismatch", "Numărul de telefon nu corespunde acestei invitații mai vechi. Verifică numărul sau cere dirijorului o invitație nouă.", 409);
    }
  }
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const pinSalt = randomHex(16);
  const pinHash = await derivePinHash(pin, pinSalt);
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const statements = [
    // Create the user only while the invitation is still valid. The FK on
    // used_by_user_id requires the user row to exist before claiming the code.
    env.DB.prepare(
      "INSERT INTO users (id, display_name, email_normalized, login_code_hash, pin_salt, pin_hash) " +
      "SELECT ?, ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM activation_codes " +
      "WHERE id = ? AND code_hash = ? AND choir_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?)"
    ).bind(userId, displayName, phoneNumber, pinSalt, pinHash, candidate.id, codeHash, choir.id, now),
    env.DB.prepare(
      "UPDATE activation_codes SET used_at = ?, used_by_user_id = ? " +
      "WHERE id = ? AND code_hash = ? AND choir_id = ? AND used_at IS NULL AND revoked_at IS NULL " +
      "AND expires_at > ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)"
    ).bind(now, userId, candidate.id, codeHash, choir.id, now, userId),
    env.DB.prepare(
      "INSERT INTO choir_memberships (id, choir_id, user_id, role, voice_part, status) " +
      "SELECT ?, a.choir_id, ?, a.intended_role, a.voice_part, 'active' FROM activation_codes a " +
      "WHERE a.id = ? AND a.used_by_user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)"
    ).bind(membershipId, userId, candidate.id, userId, userId),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) " +
      "SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM choir_memberships WHERE id = ? AND user_id = ? AND status = 'active')"
    ).bind(sessionId, userId, tokenHash, expiresAt, membershipId, userId),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "SELECT ?, ?, ?, 'account.activated', 'user', ?, ? WHERE EXISTS " +
      "(SELECT 1 FROM choir_memberships WHERE id = ? AND user_id = ? AND status = 'active')"
    ).bind(crypto.randomUUID(), choir.id, userId, userId,
      JSON.stringify({ role: candidate.intended_role, voicePart: candidate.voice_part }), membershipId, userId),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "SELECT ?, ?, ?, 'legal.terms.accepted', 'user', ?, ? " +
      "WHERE EXISTS (SELECT 1 FROM choir_memberships WHERE id = ? AND user_id = ? AND status = 'active')"
    ).bind(crypto.randomUUID(), choir.id, userId, userId,
      JSON.stringify({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedVia: "account_activation" }), membershipId, userId)
  ];
  const results = await env.DB.batch(statements);
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1 ||
      Number(results[2]?.meta?.changes || 0) !== 1 || Number(results[3]?.meta?.changes || 0) !== 1 ||
      Number(results[5]?.meta?.changes || 0) !== 1) {
    return fail("invalid_activation_code", "Codul nu este valid, a expirat sau a fost deja folosit. Cere ajutorul dirijorului dacă eroarea persistă.", 409);
  }
  return json({
    authenticated: true,
    user: { displayName, role: candidate.intended_role, voicePart: candidate.voice_part, phoneNumber, choirName: choir.name },
    phoneLoginEnabled: true,
    message: "Cont activat. De acum, conectarea se face cu numărul de telefon și PIN-ul."
  }, 200, { "Set-Cookie": sessionCookie(request, token, SESSION_DAYS * 86400) });
}
async function login(request: Request, env: Env): Promise<Response> {
  const unavailable = authUnavailable(env);
  if (unavailable) return unavailable;
  const body = await readJson(request);
  if (!body) return fail("invalid_request", "Cerere invalidă.", 400);
  const loginIdentity = typeof body.loginCode === "string" ? body.loginCode.trim() : "";
  const phoneNumber = normalizePhone(loginIdentity);
  const loginCode = phoneNumber ? "" : normalizeCode(loginIdentity);
  const pin = body.pin;
  if ((!phoneNumber && loginCode.length !== 10) || !validPin(pin)) {
    return fail("invalid_credentials", "Numărul de telefon (sau codul vechi al contului) și PIN-ul nu sunt corecte.", 401);
  }
  const rateIdentity = phoneNumber || loginCode;
  if (!(await allowAttempt(request, env, "login-ip", 12)) ||
      !(await allowAttempt(request, env, "login-account", 8, await sha256(rateIdentity)))) {
    return fail("rate_limited", "Prea multe încercări. Reîncearcă peste 15 minute.", 429);
  }
  if (!sameOrigin(request)) return fail("origin_not_allowed", "Cerere refuzată.", 403);
  const choir = await getChoir(request, env);
  if (!choir || !env.DB) return fail("choir_not_configured", "Corul nu este configurat.", 503);
  const result = phoneNumber
    ? await env.DB.prepare(
      "SELECT u.id, u.display_name, u.login_code_hash, u.email_normalized AS phone_number, u.pin_salt, u.pin_hash, " +
      "m.role, m.voice_part, c.id AS choir_id, c.slug AS choir_slug, c.name AS choir_name " +
      "FROM users u JOIN choir_memberships m ON m.user_id = u.id AND m.choir_id = ? " +
      "JOIN choirs c ON c.id = m.choir_id " +
      "WHERE u.email_normalized = ? AND u.status = 'active' AND m.status = 'active' AND c.status = 'active' LIMIT 1"
    ).bind(choir.id, phoneNumber).all<UserPinRow>()
    : await env.DB.prepare(
      "SELECT u.id, u.display_name, u.login_code_hash, u.email_normalized AS phone_number, u.pin_salt, u.pin_hash, " +
      "m.role, m.voice_part, c.id AS choir_id, c.slug AS choir_slug, c.name AS choir_name " +
      "FROM users u JOIN choir_memberships m ON m.user_id = u.id AND m.choir_id = ? " +
      "JOIN choirs c ON c.id = m.choir_id " +
      "WHERE u.login_code_hash = ? AND u.status = 'active' AND m.status = 'active' AND c.status = 'active' LIMIT 1"
    ).bind(choir.id, await sha256(loginCode)).all<UserPinRow>();
  const user = result.results?.[0];
  const calculatedHash = await derivePinHash(pin, user?.pin_salt || "00000000000000000000000000000000");
  if (!user || !isRole(user.role) || !user.pin_hash || !constantTimeEqual(calculatedHash, user.pin_hash)) {
    return fail("invalid_credentials", "Codul contului sau PIN-ul nu este corect.", 401);
  }
  const currentLegalAcceptance = await hasCurrentLegalAcceptance(env, user.id, choir.id);
  if (!currentLegalAcceptance && body.acceptedLegal !== true) {
    return fail("legal_acceptance_required", "Documentele de utilizare au fost actualizate. Citește Termenii și Nota de informare, apoi bifează acceptarea pentru a continua.", 428);
  }
  if (!currentLegalAcceptance) await recordLegalAcceptance(env, choir.id, user.id, "login");
  const sessionId = crypto.randomUUID();
  const session = await createSession(env, user.id, sessionId);
  await recordAudit(env, choir.id, user.id, "session.created", "session", sessionId);
  return json({
    authenticated: true,
    user: { displayName: user.display_name, role: user.role, voicePart: user.voice_part, phoneNumber: user.phone_number, choirName: user.choir_name }
  }, 200, { "Set-Cookie": sessionCookie(request, session.token, SESSION_DAYS * 86400) });
}
async function acceptLegalTerms(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body || body.acceptedLegal !== true) {
    return fail("legal_acceptance_required", "Bifează acceptarea termenilor și confirmă că ai citit nota de informare.", 400);
  }
  // Bypass requireSession intentionally: legacy sessions need this endpoint to accept
  // the current legal version before protected endpoints become available again.
  const current = await getCurrentSession(request, env);
  if (!current) return fail("authentication_required", "Conectează-te pentru a continua.", 401);
  if (!(await hasCurrentLegalAcceptance(env, current.userId, current.choirId))) {
    await recordLegalAcceptance(env, current.choirId, current.userId, "existing_session");
  }
  return json({ ok: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
}
async function resetAccess(request: Request, env: Env): Promise<Response> {
  const unavailable = authUnavailable(env);
  if (unavailable) return unavailable;
  const body = await readJson(request);
  if (!body) return fail("invalid_request", "Cerere invalidă.", 400);
  const loginIdentity = typeof body.loginCode === "string" ? body.loginCode.trim() : "";
  const phoneNumber = normalizePhone(loginIdentity);
  const loginCode = phoneNumber ? "" : normalizeCode(loginIdentity);
  const resetCode = typeof body.resetCode === "string" ? normalizeCode(body.resetCode) : "";
  const pin = body.pin;
  if ((!phoneNumber && loginCode.length !== 10) || resetCode.length < 12 || !validPin(pin)) {
    return fail("invalid_fields", "Verifică numărul de telefon (sau codul vechi), codul de resetare și PIN-ul de 6 cifre.", 400);
  }
  const rateIdentity = phoneNumber || loginCode;
  if (!(await allowAttempt(request, env, "reset-ip", 8)) ||
      !(await allowAttempt(request, env, "reset-account", 5, await sha256(rateIdentity)))) {
    return fail("rate_limited", "Prea multe încercări. Reîncearcă peste 15 minute.", 429);
  }
  if (!sameOrigin(request)) return fail("origin_not_allowed", "Cerere refuzată.", 403);
  const choir = await getChoir(request, env);
  if (!choir || !env.DB) return fail("choir_not_configured", "Corul nu este configurat.", 503);
  const resetHash = await sha256(resetCode);
  const now = new Date().toISOString();
  const candidateResult = phoneNumber
    ? await env.DB.prepare(
      "SELECT r.id AS reset_id, u.id AS user_id FROM access_reset_codes r " +
      "JOIN users u ON u.id = r.user_id JOIN choir_memberships m ON m.user_id = u.id AND m.choir_id = r.choir_id " +
      "WHERE r.code_hash = ? AND u.email_normalized = ? AND r.choir_id = ? " +
      "AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > ? " +
      "AND u.status = 'active' AND m.status = 'active' LIMIT 1"
    ).bind(resetHash, phoneNumber, choir.id, now).all<{ reset_id: string; user_id: string }>()
    : await env.DB.prepare(
      "SELECT r.id AS reset_id, u.id AS user_id FROM access_reset_codes r " +
      "JOIN users u ON u.id = r.user_id JOIN choir_memberships m ON m.user_id = u.id AND m.choir_id = r.choir_id " +
      "WHERE r.code_hash = ? AND u.login_code_hash = ? AND r.choir_id = ? " +
      "AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > ? " +
      "AND u.status = 'active' AND m.status = 'active' LIMIT 1"
    ).bind(resetHash, await sha256(loginCode), choir.id, now).all<{ reset_id: string; user_id: string }>();
  const candidate = candidateResult.results?.[0];
  if (!candidate) return fail("invalid_reset_code", "Codul de resetare nu este valid sau a expirat.", 400);
  const salt = randomHex(16);
  const pinHash = await derivePinHash(pin, salt);
  const usedAt = new Date().toISOString() + ":" + randomHex(8);
  const statements = [
    env.DB.prepare(
      "UPDATE access_reset_codes SET used_at = ?, used_by_user_id = ? " +
      "WHERE id = ? AND code_hash = ? AND user_id = ? AND choir_id = ? " +
      "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?"
    ).bind(usedAt, candidate.user_id, candidate.reset_id, resetHash, candidate.user_id, choir.id, now),
    env.DB.prepare(
      "UPDATE users SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ? AND EXISTS " +
      "(SELECT 1 FROM access_reset_codes WHERE id = ? AND used_at = ? AND used_by_user_id = ?)"
    ).bind(salt, pinHash, usedAt, candidate.user_id, candidate.reset_id, usedAt, candidate.user_id),
    env.DB.prepare(
      "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND EXISTS " +
      "(SELECT 1 FROM access_reset_codes WHERE id = ? AND used_at = ? AND used_by_user_id = ?)"
    ).bind(usedAt, candidate.user_id, candidate.reset_id, usedAt, candidate.user_id),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "SELECT ?, ?, ?, 'account.pin_reset', 'user', ?, '{}' WHERE EXISTS " +
      "(SELECT 1 FROM access_reset_codes WHERE id = ? AND used_at = ? AND used_by_user_id = ?)"
    ).bind(crypto.randomUUID(), choir.id, candidate.user_id, candidate.user_id,
      candidate.reset_id, usedAt, candidate.user_id)
  ];
  const results = await env.DB.batch(statements);
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
    return fail("invalid_reset_code", "Codul de resetare nu mai este valid.", 409);
  }
  return json({ ok: true, message: phoneNumber
    ? "PIN schimbat. Conectează-te cu numărul de telefon și noul PIN."
    : "PIN schimbat. Conectează-te cu codul vechi al contului și noul PIN." },
    200, { "Set-Cookie": sessionCookie(request, "", 0) });
}
async function issuePhoneChangeCode(request: Request, env: Env, targetId: string): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot emite coduri pentru schimbarea numerelor.", 403);
  const target = await manageableMember(env, current, targetId);
  if (target instanceof Response) return target;
  const body = await readJson(request);
  if (!body) return fail("invalid_request", "Cerere invalidă.", 400);
  const phoneNumber = normalizePhone(body.phone);
  if (!phoneNumber) {
    return fail("invalid_phone", "Introdu un număr de telefon mobil românesc valid.", 400);
  }
  if (!(await allowAttempt(request, env, "phone-change-issue-ip", 12)) ||
      !(await allowAttempt(request, env, "phone-change-issue-target", 5, targetId))) {
    return fail("rate_limited", "Au fost emise prea multe coduri. Reîncearcă peste 15 minute.", 429);
  }
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE email_normalized = ? AND id <> ? LIMIT 1"
  ).bind(phoneNumber, targetId).all<{ id: string }>();
  if (existing.results?.length) {
    return fail("phone_in_use", "Numărul acesta este deja asociat altui cont.", 409);
  }
  const code = randomCode(16);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
  const codeHash = await sha256(normalizeCode(code));
  const phoneHash = await hmacHex(env.AUTH_SECRET || "", "phone-change|" + phoneNumber);
  const statements = [
    env.DB.prepare(
      "UPDATE access_reset_codes SET revoked_at = ? WHERE user_id = ? AND choir_id = ? " +
      "AND used_at IS NULL AND revoked_at IS NULL AND id IN " +
      "(SELECT target_id FROM audit_logs WHERE target_type = 'phone_change_code' AND action = 'account.phone_change_code.created')"
    ).bind(now, targetId, current.choirId),
    env.DB.prepare(
      "INSERT INTO access_reset_codes (id, choir_id, user_id, code_hash, created_by_user_id, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, current.choirId, targetId, codeHash, current.userId, expiresAt),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "VALUES (?, ?, ?, 'account.phone_change_code.created', 'phone_change_code', ?, ?)"
    ).bind(crypto.randomUUID(), current.choirId, current.userId, id, JSON.stringify({ phoneHash }))
  ];
  await env.DB.batch(statements);
  return json({
    code: formatCode(code), expiresAt,
    message: "Codul este legat de numărul de telefon introdus, este valabil 30 de minute și poate fi folosit o singură dată. Transmite-l doar membrului respectiv."
  }, 201);
}
async function updateAccountPhone(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  const body = await readJson(request);
  if (!body) return fail("invalid_request", "Cerere invalidă.", 400);
  const phoneNumber = normalizePhone(body.phone);
  const phoneChangeCode = typeof body.code === "string" ? normalizeCode(body.code) : "";
  const pin = body.pin;
  if (!phoneNumber || phoneChangeCode.length !== 16 || !validPin(pin)) {
    return fail("invalid_fields", "Introdu numărul de telefon, codul primit de la dirijor și PIN-ul actual din 6 cifre.", 400);
  }
  if (!(await allowAttempt(request, env, "phone-change-ip", 12)) ||
      !(await allowAttempt(request, env, "phone-change-account", 5, current.userId))) {
    return fail("rate_limited", "Prea multe încercări. Reîncearcă peste 15 minute.", 429);
  }
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const credentials = await env.DB.prepare(
    "SELECT pin_salt, pin_hash FROM users WHERE id = ? AND status = 'active' LIMIT 1"
  ).bind(current.userId).all<{ pin_salt: string; pin_hash: string }>();
  const account = credentials.results?.[0];
  const calculatedHash = await derivePinHash(pin as string, account?.pin_salt || "00000000000000000000000000000000");
  if (!account?.pin_hash || !constantTimeEqual(calculatedHash, account.pin_hash)) {
    return fail("invalid_pin", "PIN-ul actual nu este corect.", 401);
  }
  const codeHash = await sha256(phoneChangeCode);
  const codeResult = await env.DB.prepare(
    "SELECT r.id AS resetId, json_extract(l.metadata_json, '$.phoneHash') AS phoneHash " +
    "FROM access_reset_codes r JOIN audit_logs l ON l.target_id = r.id " +
    "AND l.target_type = 'phone_change_code' AND l.action = 'account.phone_change_code.created' " +
    "WHERE r.code_hash = ? AND r.user_id = ? AND r.choir_id = ? " +
    "AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > ? LIMIT 1"
  ).bind(codeHash, current.userId, current.choirId, new Date().toISOString())
    .all<{ resetId: string; phoneHash: string | null }>();
  const authorizedCode = codeResult.results?.[0];
  if (!authorizedCode) {
    return fail("invalid_phone_change_code", "Codul nu este valid, a expirat sau a fost deja folosit.", 400);
  }
  const expectedPhoneHash = await hmacHex(env.AUTH_SECRET || "", "phone-change|" + phoneNumber);
  if (!authorizedCode.phoneHash || !constantTimeEqual(authorizedCode.phoneHash, expectedPhoneHash)) {
    return fail("phone_mismatch", "Numărul nu corespunde codului de schimbare primit de la dirijor.", 409);
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE email_normalized = ? AND id <> ? LIMIT 1"
  ).bind(phoneNumber, current.userId).all<{ id: string }>();
  if (existing.results?.length) {
    return fail("phone_in_use", "Numărul acesta este deja asociat altui cont.", 409);
  }
  const usedAt = new Date().toISOString() + ":" + randomHex(8);
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE access_reset_codes SET used_at = ?, used_by_user_id = ? " +
        "WHERE id = ? AND user_id = ? AND choir_id = ? AND code_hash = ? " +
        "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? " +
        "AND NOT EXISTS (SELECT 1 FROM users WHERE email_normalized = ? AND id <> ?)"
      ).bind(usedAt, current.userId, authorizedCode.resetId, current.userId, current.choirId,
        codeHash, new Date().toISOString(), phoneNumber, current.userId),
      env.DB.prepare(
        "UPDATE users SET email_normalized = ?, updated_at = ? WHERE id = ? AND status = 'active' " +
        "AND EXISTS (SELECT 1 FROM choir_memberships WHERE user_id = ? AND choir_id = ? AND status = 'active') " +
        "AND EXISTS (SELECT 1 FROM access_reset_codes WHERE id = ? AND used_at = ? AND used_by_user_id = ?) " +
        "AND NOT EXISTS (SELECT 1 FROM users WHERE email_normalized = ? AND id <> ?)"
      ).bind(phoneNumber, new Date().toISOString(), current.userId, current.userId, current.choirId,
        authorizedCode.resetId, usedAt, current.userId, phoneNumber, current.userId),
      env.DB.prepare(
        "UPDATE choir_memberships SET phone_verified_at = NULL, phone_verified_by_user_id = NULL WHERE user_id = ?"
      ).bind(current.userId),
      env.DB.prepare(
        "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
        "SELECT ?, ?, ?, 'account.phone.updated', 'user', ?, ? " +
        "WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND email_normalized = ?) " +
        "AND EXISTS (SELECT 1 FROM access_reset_codes WHERE id = ? AND used_at = ? AND used_by_user_id = ?)"
      ).bind(crypto.randomUUID(), current.choirId, current.userId, current.userId,
        JSON.stringify({ phoneUpdated: true }), current.userId, phoneNumber,
        authorizedCode.resetId, usedAt, current.userId)
    ]);
  } catch {
    return fail("phone_update_failed", "Nu am putut salva numărul. Codul poate fi deja folosit sau numărul este ocupat.", 409);
  }
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
    return fail("phone_update_failed", "Nu am putut salva numărul. Cere dirijorului un cod nou și verifică numărul.", 409);
  }
  return json({ ok: true, phoneNumber, message: "Numărul de telefon a fost actualizat." });
}
async function logout(request: Request, env: Env): Promise<Response> {
  const session = await getCurrentSession(request, env);
  if (session && env.DB) {
    await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), session.sessionId).run();
    await recordAudit(env, session.choirId, session.userId, "session.revoked", "session", session.sessionId);
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
}
async function requireSession(request: Request, env: Env): Promise<SessionRow | Response> {
  const unavailable = authUnavailable(env);
  if (unavailable) return unavailable;
  const session = await getCurrentSession(request, env);
  if (!session) return fail("authentication_required", "Conectează-te pentru a continua.", 401);
  if (!(await hasCurrentLegalAcceptance(env, session.userId, session.choirId))) {
    return fail("legal_acceptance_required", "Citește Termenii de utilizare și Nota de informare privind datele personale, apoi acceptă pentru a continua.", 428);
  }
  return session;
}
function isConductor(session: SessionRow): boolean {
  return session.role === "conductor" || session.role === "owner";
}
type MediaFormat = "pdf" | "audio" | "video";
type MediaVoice = typeof VOICE_PARTS[number];
interface B2Config {
  endpoint: URL;
  bucket: string;
  region: string;
  keyId: string;
  applicationKey: string;
}
interface MediaExtension {
  format: MediaFormat;
  contentType: string;
  maxBytes: number;
}
const MEDIA_EXTENSIONS: Record<string, MediaExtension> = {
  pdf: { format: "pdf", contentType: "application/pdf", maxBytes: 50 * 1024 * 1024 },
  mp3: { format: "audio", contentType: "audio/mpeg", maxBytes: 500 * 1024 * 1024 },
  m4a: { format: "audio", contentType: "audio/mp4", maxBytes: 500 * 1024 * 1024 },
  aac: { format: "audio", contentType: "audio/aac", maxBytes: 500 * 1024 * 1024 },
  wav: { format: "audio", contentType: "audio/wav", maxBytes: 500 * 1024 * 1024 },
  ogg: { format: "audio", contentType: "audio/ogg", maxBytes: 500 * 1024 * 1024 },
  opus: { format: "audio", contentType: "audio/opus", maxBytes: 500 * 1024 * 1024 },
  flac: { format: "audio", contentType: "audio/flac", maxBytes: 500 * 1024 * 1024 },
  mp4: { format: "video", contentType: "video/mp4", maxBytes: 2 * 1024 * 1024 * 1024 },
  webm: { format: "video", contentType: "video/webm", maxBytes: 2 * 1024 * 1024 * 1024 },
  mov: { format: "video", contentType: "video/quicktime", maxBytes: 2 * 1024 * 1024 * 1024 }
};
function getB2Config(env: Env): B2Config | null {
  if (!env.B2_ENDPOINT || !env.B2_REGION || !env.B2_BUCKET || !env.B2_KEY_ID || !env.B2_APP_KEY) {
    return null;
  }
  try {
    const endpoint = new URL(env.B2_ENDPOINT);
    const region = env.B2_REGION.trim();
    const bucket = env.B2_BUCKET.trim();
    if (endpoint.protocol !== "https:" || endpoint.pathname !== "/" ||
        endpoint.search || endpoint.hash || endpoint.username || endpoint.password ||
        !/^[a-z0-9-]+$/.test(region) ||
        endpoint.hostname !== "s3." + region + ".backblazeb2.com" ||
        !/^[a-z0-9-]{3,63}$/.test(bucket)) {
      return null;
    }
    return {
      endpoint,
      bucket,
      region,
      keyId: env.B2_KEY_ID,
      applicationKey: env.B2_APP_KEY
    };
  } catch {
    return null;
  }
}
function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    "%" + char.charCodeAt(0).toString(16).toUpperCase()
  );
}
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hmacBytes(keyMaterial: string | Uint8Array, value: string): Promise<Uint8Array> {
  const keyBytes = typeof keyMaterial === "string" ? encoder.encode(keyMaterial) : keyMaterial;
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);
  const key = await crypto.subtle.importKey(
    "raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const valueBytes = encoder.encode(value);
  const valueBuffer = new ArrayBuffer(valueBytes.byteLength);
  new Uint8Array(valueBuffer).set(valueBytes);
  const digest = await crypto.subtle.sign("HMAC", key, valueBuffer);
  return new Uint8Array(digest);
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}
async function presignB2Object(
  config: B2Config,
  method: "GET" | "PUT" | "HEAD",
  objectKey: string,
  expiresSeconds: number,
  contentType?: string
): Promise<string> {
  const safeExpiry = Math.max(1, Math.min(Math.trunc(expiresSeconds), 3600));
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = dateStamp + "/" + config.region + "/s3/aws4_request";
  const signedHeaders = contentType ? "content-type;host" : "host";
  const canonicalHeaders = contentType
    ? "content-type:" + contentType + "\nhost:" + config.endpoint.host + "\n"
    : "host:" + config.endpoint.host + "\n";
  const canonicalUri = "/" + awsEncode(config.bucket) + "/" +
    objectKey.split("/").map(awsEncode).join("/");
  const queryValues: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", config.keyId + "/" + scope],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(safeExpiry)],
    ["X-Amz-SignedHeaders", signedHeaders]
  ];
  const canonicalQuery = queryValues
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => awsEncode(key) + "=" + awsEncode(value))
    .join("&");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" +
    await sha256Hex(canonicalRequest);
  const dateKey = await hmacBytes("AWS4" + config.applicationKey, dateStamp);
  const regionKey = await hmacBytes(dateKey, config.region);
  const serviceKey = await hmacBytes(regionKey, "s3");
  const signingKey = await hmacBytes(serviceKey, "aws4_request");
  const signature = toHex(await hmacBytes(signingKey, stringToSign));
  return config.endpoint.origin + canonicalUri + "?" + canonicalQuery +
    "&X-Amz-Signature=" + signature;
}
function safeUploadFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const leaf = value.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned.length > 180 || cleaned === "." || cleaned === "..") return null;
  return cleaned;
}
async function listSongs(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const url = new URL(request.url);
  const requestedVoice = url.searchParams.get("voice");
  let voice: MediaVoice;
  if (current.role === "member") {
    if (!isVoicePart(current.voicePart)) return fail("voice_not_assigned", "Dirijorul trebuie să-ți asocieze o voce.", 403);
    voice = current.voicePart;
  } else {
    voice = isVoicePart(requestedVoice) ? requestedVoice : (isVoicePart(current.voicePart) ? current.voicePart : "S");
  }
  const result = await env.DB.prepare(
    "SELECT s.id, s.title, s.slug, s.description, s.sort_order AS sortOrder FROM songs s " +
    "WHERE s.choir_id = ? AND s.status = 'published' " +
    "ORDER BY s.sort_order ASC, s.title COLLATE NOCASE ASC"
  ).bind(current.choirId).all<{ id: string; title: string; slug: string; description: string | null; sortOrder: number }>();
  const songs = result.results ?? [];
  if (!songs.length) return json({ songs: [], voice });
  const placeholders = songs.map(() => "?").join(", ");
  const assetsResult = await env.DB.prepare(
    "SELECT id, song_id AS songId, voice_part AS voicePart, format FROM song_assets " +
    "WHERE choir_id = ? AND status = 'published' AND voice_part = ? " +
    "AND song_id IN (" + placeholders + ") ORDER BY updated_at DESC"
  ).bind(current.choirId, voice, ...songs.map((song) => song.id))
    .all<{ id: string; songId: string; voicePart: MediaVoice; format: MediaFormat }>();
  const assetsBySong = new Map<string, Array<{ id: string; voicePart: MediaVoice; format: MediaFormat }>>();
  for (const asset of assetsResult.results ?? []) {
    const list = assetsBySong.get(asset.songId) ?? [];
    list.push({ id: asset.id, voicePart: asset.voicePart, format: asset.format });
    assetsBySong.set(asset.songId, list);
  }
  return json({
    songs: songs.map((song) => ({ ...song, assets: assetsBySong.get(song.id) ?? [] })),
    voice
  });
}
async function listConductorSongs(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot administra fișierele repertoriului.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const [songResult, assetResult] = await Promise.all([
    env.DB.prepare(
      "SELECT id, title, slug, description, status, sort_order AS sortOrder " +
      "FROM songs WHERE choir_id = ? ORDER BY sort_order ASC, title COLLATE NOCASE ASC"
    ).bind(current.choirId).all<{ id: string; title: string; slug: string; description: string | null; status: string; sortOrder: number }>(),
    env.DB.prepare(
      "SELECT id, song_id AS songId, voice_part AS voicePart, format, status, file_name AS fileName, size_bytes AS sizeBytes " +
      "FROM song_assets WHERE choir_id = ? AND status != 'archived' ORDER BY created_at DESC"
    ).bind(current.choirId).all<{ id: string; songId: string; voicePart: MediaVoice; format: MediaFormat; status: string; fileName: string | null; sizeBytes: number | null }>()
  ]);
  const assetsBySong = new Map<string, Array<Record<string, unknown>>>();
  for (const asset of assetResult.results ?? []) {
    const list = assetsBySong.get(asset.songId) ?? [];
    list.push({
      id: asset.id,
      voicePart: asset.voicePart,
      format: asset.format,
      status: asset.status,
      fileName: asset.fileName,
      sizeBytes: asset.sizeBytes
    });
    assetsBySong.set(asset.songId, list);
  }
  return json({
    configured: Boolean(getB2Config(env)),
    songs: (songResult.results ?? []).map((song) => ({
      ...song,
      assets: assetsBySong.get(song.id) ?? []
    }))
  });
}
async function getMediaStorageStatus(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot consulta starea stocării.", 403);
  return json({ configured: Boolean(getB2Config(env)) });
}
async function diagnoseMediaStorage(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot testa conexiunea la stocare.", 403);
  const config = getB2Config(env);
  if (!config) return fail("backblaze_not_configured", "Lipsește una sau mai multe variabile B2 din Production.", 503);

  const objectKey = current.choirId + "/_diagnostics/" + crypto.randomUUID() + ".pdf";
  const signatureUrl = await presignB2Object(config, "GET", objectKey, 60);
  let signatureStatus = 0;
  let signatureCode = "";
  try {
    const response = await fetch(signatureUrl, { method: "GET" });
    signatureStatus = response.status;
    const body = (await response.text()).slice(0, 3000);
    signatureCode = body.match(/<Code>([^<]+)<\/Code>/i)?.[1] ?? "";
    if (response.status === 404 && !signatureCode) signatureCode = "NoSuchKey";
  } catch {
    signatureCode = "NetworkError";
  }
  const signaturePass = signatureStatus === 404 &&
    (signatureCode === "" || signatureCode === "NoSuchKey" || signatureCode === "NotFound");

  const origin = new URL(request.url).origin;
  // CORS preflight is an unsigned OPTIONS request. Do not send a URL signed for PUT,
  // because the signature is method-specific and can produce a misleading 403.
  const corsProbeUrl = config.endpoint.origin + "/" + awsEncode(config.bucket) + "/" +
    objectKey.split("/").map(awsEncode).join("/");
  let preflightStatus = 0;
  let allowOrigin = "";
  let allowMethods = "";
  let allowHeaders = "";
  let preflightCode = "";
  try {
    const response = await fetch(corsProbeUrl, {
      method: "OPTIONS",
      headers: {
        "Origin": origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    preflightStatus = response.status;
    allowOrigin = response.headers.get("Access-Control-Allow-Origin") ?? "";
    allowMethods = response.headers.get("Access-Control-Allow-Methods") ?? "";
    allowHeaders = response.headers.get("Access-Control-Allow-Headers") ?? "";
    const body = (await response.text()).slice(0, 3000);
    preflightCode = body.match(/<Code>([^<]+)<\/Code>/i)?.[1] ?? "";
  } catch {
    preflightCode = "NetworkError";
  }
  const methods = allowMethods.toUpperCase().split(",").map((value) => value.trim());
  const headers = allowHeaders.toLowerCase().split(",").map((value) => value.trim());
  const corsPass = (preflightStatus >= 200 && preflightStatus < 300) &&
    allowOrigin === origin &&
    methods.includes("PUT") &&
    (headers.includes("*") || headers.includes("content-type"));

  await recordAudit(env, current.choirId, current.userId, "conductor.media.connection_diagnosed", "media_storage", null, {
    signatureStatus, signatureCode: signatureCode || null, preflightStatus, preflightCode: preflightCode || null,
    corsPass
  });
  return json({
    configured: true,
    signature: {
      ok: signaturePass,
      status: signatureStatus,
      code: signatureCode || null,
      message: signaturePass
        ? "Semnătura și accesul de citire sunt acceptate de Backblaze."
        : "Backblaze nu a confirmat semnătura sau permisiunile. Verifică cheia și prefixul de acces."
    },
    cors: {
      ok: corsPass,
      status: preflightStatus,
      allowOrigin: allowOrigin || null,
      allowMethods: allowMethods || null,
      allowHeaders: allowHeaders || null,
      code: preflightCode || null,
      message: corsPass
        ? "Preflight-ul CORS pentru PUT și content-type este acceptat."
        : "Regula CORS nu a confirmat origine, metoda PUT și antetul content-type."
    }
  });
}
async function createSong(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot adăuga cântări.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const body = await readJson(request, 8192);
  if (!body || typeof body.title !== "string" || typeof body.description !== "string") {
    return fail("invalid_song", "Completează titlul și descrierea cântării.", 400);
  }
  const title = body.title.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ");
  const description = body.description.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ");
  if (!title || title.length > 160 || description.length > 1200) {
    return fail("invalid_song", "Titlul trebuie să aibă 1–160 de caractere, iar descrierea maximum 1200.", 400);
  }
  const slugBase = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "cantare";
  const id = crypto.randomUUID();
  const slug = slugBase + "-" + id.slice(0, 8);
  const sort = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM songs WHERE choir_id = ?"
  ).bind(current.choirId).all<{ nextOrder: number }>();
  await env.DB.prepare(
    "INSERT INTO songs (id, choir_id, title, slug, description, status, sort_order, created_by_user_id) " +
    "VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)"
  ).bind(id, current.choirId, title, slug, description || null, sort.results?.[0]?.nextOrder ?? 1, current.userId).run();
  await recordAudit(env, current.choirId, current.userId, "conductor.song.created", "song", id, { title });
  return json({ song: { id, title, slug, description: description || null, status: "draft", assets: [] }, message: "Cântarea a fost creată ca draft. Încarcă fișierele, apoi public-o." }, 201);
}
async function publishSong(request: Request, env: Env, songId: string): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot publica repertoriul.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const found = await env.DB.prepare(
    "SELECT id, title, status FROM songs WHERE id = ? AND choir_id = ? LIMIT 1"
  ).bind(songId, current.choirId).all<{ id: string; title: string; status: string }>();
  const song = found.results?.[0];
  if (!song) return fail("song_not_found", "Cântarea nu a fost găsită.", 404);
  if (song.status === "archived") return fail("song_archived", "Cântarea este arhivată și nu poate fi publicată.", 409);
  const assets = await env.DB.prepare(
    "SELECT id FROM song_assets WHERE choir_id = ? AND song_id = ? AND status IN ('draft', 'published') LIMIT 1"
  ).bind(current.choirId, songId).all<{ id: string }>();
  if (!assets.results?.length) return fail("song_has_no_assets", "Înainte de publicare, încarcă cel puțin un fișier.", 409);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE songs SET status = 'published', updated_at = ? WHERE id = ? AND choir_id = ?")
      .bind(now, songId, current.choirId),
    env.DB.prepare("UPDATE song_assets SET status = 'published', updated_at = ? WHERE song_id = ? AND choir_id = ? AND status = 'draft'")
      .bind(now, songId, current.choirId)
  ]);
  await recordAudit(env, current.choirId, current.userId, "conductor.song.published", "song", songId, { title: song.title });
  return json({ message: "Cântarea și fișierele ei sunt publicate pentru vocile asociate." });
}
async function prepareMediaUpload(request: Request, env: Env, songId: string): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot încărca fișiere.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const config = getB2Config(env);
  if (!config) return fail("backblaze_not_configured", "Backblaze B2 nu este configurat încă pe server.", 503);
  const body = await readJson(request, 4096);
  if (!body || !isVoicePart(body.voicePart) ||
      (body.format !== "pdf" && body.format !== "audio" && body.format !== "video") ||
      typeof body.sizeBytes !== "number" || !Number.isSafeInteger(body.sizeBytes) || body.sizeBytes <= 0) {
    return fail("invalid_media_upload", "Verifică vocea, formatul și dimensiunea fișierului.", 400);
  }
  const fileName = safeUploadFileName(body.fileName);
  if (!fileName) return fail("invalid_media_filename", "Numele fișierului nu este valid.", 400);
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const media = MEDIA_EXTENSIONS[extension];
  if (!media || media.format !== body.format) {
    return fail("unsupported_media_type", "Format nesuportat. PDF: .pdf; audio: .mp3, .m4a, .aac, .wav, .ogg, .opus, .flac; video: .mp4, .webm sau .mov.", 415);
  }
  if (body.sizeBytes > media.maxBytes) {
    return fail("media_too_large", "Fișierul depășește limita pentru acest format (" + Math.floor(media.maxBytes / (1024 * 1024)) + " MB).", 413);
  }
  const songResult = await env.DB.prepare(
    "SELECT id, status FROM songs WHERE id = ? AND choir_id = ? LIMIT 1"
  ).bind(songId, current.choirId).all<{ id: string; status: string }>();
  const song = songResult.results?.[0];
  if (!song) return fail("song_not_found", "Cântarea nu a fost găsită.", 404);
  if (song.status === "archived") return fail("song_archived", "Nu poți încărca fișiere într-o cântare arhivată.", 409);

  const uploadId = crypto.randomUUID();
  const objectKey = current.choirId + "/" + songId + "/" + uploadId + "." + extension;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO media_uploads (id, choir_id, song_id, created_by_user_id, object_key, voice_part, format, file_name, content_type, size_bytes, status, expires_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
  ).bind(uploadId, current.choirId, songId, current.userId, objectKey, body.voicePart, body.format,
    fileName, media.contentType, body.sizeBytes, expiresAt).run();
  const uploadUrl = await presignB2Object(config, "PUT", objectKey, 900, media.contentType);
  await recordAudit(env, current.choirId, current.userId, "conductor.media.upload_started", "media_upload", uploadId, {
    songId, voicePart: body.voicePart, format: body.format, sizeBytes: body.sizeBytes
  });
  return json({
    uploadId,
    uploadUrl,
    method: "PUT",
    contentType: media.contentType,
    expiresAt,
    message: "URL de încărcare generat. Încarcă fișierul înainte să expire în 15 minute."
  }, 201);
}
async function completeMediaUpload(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot confirma încărcarea fișierelor.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const config = getB2Config(env);
  if (!config) return fail("backblaze_not_configured", "Backblaze B2 nu este configurat încă pe server.", 503);
  const body = await readJson(request);
  if (!body || typeof body.uploadId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.uploadId)) {
    return fail("invalid_upload_id", "Identificatorul încărcării nu este valid.", 400);
  }
  const uploadResult = await env.DB.prepare(
    "SELECT u.id, u.choir_id AS choirId, u.song_id AS songId, u.created_by_user_id AS createdByUserId, " +
    "u.object_key AS objectKey, u.voice_part AS voicePart, u.format, u.file_name AS fileName, " +
    "u.content_type AS contentType, u.size_bytes AS sizeBytes, u.status, u.expires_at AS expiresAt, s.status AS songStatus " +
    "FROM media_uploads u JOIN songs s ON s.id = u.song_id AND s.choir_id = u.choir_id " +
    "WHERE u.id = ? AND u.choir_id = ? LIMIT 1"
  ).bind(body.uploadId, current.choirId).all<{
    id: string; choirId: string; songId: string; createdByUserId: string; objectKey: string;
    voicePart: MediaVoice; format: MediaFormat; fileName: string; contentType: string;
    sizeBytes: number; status: string; expiresAt: string; songStatus: string;
  }>();
  const upload = uploadResult.results?.[0];
  if (!upload || upload.createdByUserId !== current.userId) {
    return fail("upload_not_found", "Încărcarea nu a fost găsită.", 404);
  }
  if (upload.status === "completed") {
    const asset = await env.DB.prepare("SELECT id, status FROM song_assets WHERE object_key = ? AND choir_id = ? LIMIT 1")
      .bind(upload.objectKey, current.choirId).all<{ id: string; status: string }>();
    if (asset.results?.[0]) return json({ assetId: asset.results[0].id, status: asset.results[0].status, message: "Fișierul este deja înregistrat." });
    return fail("upload_already_completed", "Încărcarea a fost deja finalizată.", 409);
  }
  if (upload.status !== "pending" || upload.expiresAt <= new Date().toISOString()) {
    await env.DB.prepare("UPDATE media_uploads SET status = 'expired' WHERE id = ? AND status = 'pending'")
      .bind(upload.id).run();
    return fail("upload_expired", "URL-ul de încărcare a expirat. Începe încărcarea din nou.", 410);
  }
  if (upload.songStatus === "archived") return fail("song_archived", "Cântarea a fost arhivată.", 409);
  const headUrl = await presignB2Object(config, "HEAD", upload.objectKey, 60);
  let headResponse: Response;
  try {
    headResponse = await fetch(headUrl, { method: "HEAD" });
  } catch {
    return fail("backblaze_unreachable", "Nu am putut verifica fișierul în Backblaze. Încearcă din nou.", 502);
  }
  if (headResponse.status === 404 || headResponse.status === 403) {
    return fail("uploaded_file_not_found", "Fișierul nu a fost găsit în Backblaze. Verifică dacă încărcarea s-a terminat.", 422);
  }
  if (!headResponse.ok) {
    return fail("backblaze_head_failed", "Backblaze nu a putut valida fișierul încărcat.", 502);
  }
  const storedSize = Number(headResponse.headers.get("Content-Length") || 0);
  const storedType = (headResponse.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (storedSize !== upload.sizeBytes || storedType !== upload.contentType.toLowerCase()) {
    return fail("uploaded_file_mismatch", "Dimensiunea sau tipul fișierului încărcat nu corespunde cererii.", 422);
  }
  const assetId = crypto.randomUUID();
  const now = new Date().toISOString();
  const batchResults = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO song_assets (id, choir_id, song_id, voice_part, format, object_key, content_type, size_bytes, status, file_name, created_at, updated_at) " +
      "SELECT ?, u.choir_id, u.song_id, u.voice_part, u.format, u.object_key, u.content_type, u.size_bytes, " +
      "CASE WHEN s.status = 'published' THEN 'published' ELSE 'draft' END, u.file_name, ?, ? " +
      "FROM media_uploads u JOIN songs s ON s.id = u.song_id AND s.choir_id = u.choir_id " +
      "WHERE u.id = ? AND u.status = 'pending' AND u.expires_at > ? AND u.created_by_user_id = ?"
    ).bind(assetId, now, now, upload.id, now, current.userId),
    env.DB.prepare(
      "UPDATE media_uploads SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'pending' " +
      "AND EXISTS (SELECT 1 FROM song_assets WHERE id = ? AND object_key = media_uploads.object_key)"
    ).bind(now, upload.id, assetId)
  ]);
  if (Number(batchResults[0]?.meta?.changes ?? 0) !== 1 || Number(batchResults[1]?.meta?.changes ?? 0) !== 1) {
    const already = await env.DB.prepare("SELECT id, status FROM song_assets WHERE object_key = ? AND choir_id = ? LIMIT 1")
      .bind(upload.objectKey, current.choirId).all<{ id: string; status: string }>();
    if (already.results?.[0]) return json({ assetId: already.results[0].id, status: already.results[0].status, message: "Fișierul este deja înregistrat." });
    return fail("upload_completion_conflict", "Încărcarea a expirat sau a fost finalizată într-o altă cerere.", 409);
  }
  await env.DB.prepare(
    "UPDATE song_assets SET status = 'archived', updated_at = ? WHERE choir_id = ? AND song_id = ? " +
    "AND voice_part = ? AND format = ? AND id != ? AND status IN ('draft', 'published')"
  ).bind(now, current.choirId, upload.songId, upload.voicePart, upload.format, assetId).run();
  await recordAudit(env, current.choirId, current.userId, "conductor.media.upload_completed", "song_asset", assetId, {
    songId: upload.songId, voicePart: upload.voicePart, format: upload.format, sizeBytes: storedSize
  });
  return json({
    assetId,
    status: upload.songStatus === "published" ? "published" : "draft",
    message: upload.songStatus === "published"
      ? "Fișierul a fost încărcat și publicat."
      : "Fișierul a fost încărcat. Publică apoi cântarea ca să-l vadă membrii."
  }, 201);
}
async function downloadSongAsset(request: Request, env: Env, assetId: string): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const config = getB2Config(env);
  if (!config) return fail("backblaze_not_configured", "Backblaze B2 nu este configurat încă pe server.", 503);
  const assetResult = await env.DB.prepare(
    "SELECT a.id, a.object_key AS objectKey, a.status AS assetStatus, a.voice_part AS voicePart, " +
    "s.status AS songStatus FROM song_assets a JOIN songs s ON s.id = a.song_id AND s.choir_id = a.choir_id " +
    "WHERE a.id = ? AND a.choir_id = ? LIMIT 1"
  ).bind(assetId, current.choirId).all<{ id: string; objectKey: string; assetStatus: string; voicePart: MediaVoice; songStatus: string }>();
  const asset = assetResult.results?.[0];
  if (!asset || asset.assetStatus === "archived" || asset.songStatus === "archived") {
    return fail("asset_not_found", "Fișierul nu a fost găsit.", 404);
  }
  if (current.role === "member" &&
      (asset.assetStatus !== "published" || asset.songStatus !== "published" || asset.voicePart !== current.voicePart)) {
    return fail("asset_not_found", "Fișierul nu este disponibil pentru contul tău.", 404);
  }
  const signedUrl = await presignB2Object(config, "GET", asset.objectKey, 3600);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": signedUrl,
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
async function listMemberContacts(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) {
    return fail("forbidden", "Această pagină este disponibilă doar dirijorilor.", 403);
  }
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);

  const body = await readJson(request);
  if (!body || !validPin(body.pin)) {
    return fail("reauthentication_required", "Introdu PIN-ul de 6 cifre pentru a vedea numerele de telefon.", 401);
  }
  if (!(await allowAttempt(request, env, "conductor-contacts-ip", 24)) ||
      !(await allowAttempt(request, env, "conductor-contacts-user", 12, await sha256(current.userId)))) {
    return fail("rate_limited", "Prea multe încercări. Reîncearcă peste 15 minute.", 429);
  }

  const credentialResult = await env.DB.prepare(
    "SELECT pin_salt, pin_hash FROM users WHERE id = ? AND status = 'active' LIMIT 1"
  ).bind(current.userId).all<{ pin_salt: string; pin_hash: string }>();
  const credential = credentialResult.results?.[0];
  const calculatedHash = await derivePinHash(
    body.pin,
    credential?.pin_salt || "00000000000000000000000000000000"
  );
  if (!credential?.pin_hash || !constantTimeEqual(calculatedHash, credential.pin_hash)) {
    return fail("invalid_pin", "PIN incorect. Numerele de telefon rămân blocate.", 401);
  }

  const result = await env.DB.prepare(
    "SELECT u.id, u.display_name AS displayName, u.email_normalized AS phoneNumber, " +
    "CASE WHEN m.phone_verified_at IS NULL THEN 0 ELSE 1 END AS phoneVerified, " +
    "m.phone_verified_at AS phoneVerifiedAt, verifier.display_name AS phoneVerifiedBy, " +
    "m.role, m.voice_part AS voicePart, m.created_at AS joinedAt " +
    "FROM choir_memberships m JOIN users u ON u.id = m.user_id " +
    "LEFT JOIN users verifier ON verifier.id = m.phone_verified_by_user_id " +
    "WHERE m.choir_id = ? AND m.status = 'active' AND u.status = 'active' " +
    "ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'conductor' THEN 1 ELSE 2 END, u.display_name COLLATE NOCASE"
  ).bind(current.choirId).all();

  const members = result.results ?? [];
  await recordAudit(
    env, current.choirId, current.userId, "conductor.member_contacts.viewed",
    "choir", current.choirId, { memberCount: members.length }
  );
  return json({ members, actorRole: current.role });
}
async function listMembers(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot vedea lista membrilor.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const result = await env.DB.prepare(
    "SELECT u.id, m.id AS membershipId, u.display_name AS displayName, m.role, m.voice_part AS voicePart, m.created_at AS joinedAt " +
    "FROM choir_memberships m JOIN users u ON u.id = m.user_id " +
    "WHERE m.choir_id = ? AND m.status = 'active' AND u.status = 'active' " +
    "ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'conductor' THEN 1 ELSE 2 END, u.display_name COLLATE NOCASE"
  ).bind(current.choirId).all();
  return json({ members: result.results ?? [], actorRole: current.role });
}
async function getAccountPreferences(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const result = await env.DB.prepare(
    "SELECT accent_theme AS accentTheme FROM user_preferences WHERE user_id = ? LIMIT 1"
  ).bind(current.userId).all<{ accentTheme: AccentTheme }>();
  return json({ accentTheme: result.results?.[0]?.accentTheme ?? "ocean" });
}
async function saveAccountPreferences(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const body = await readJson(request);
  if (!body || !isAccentTheme(body.accentTheme)) {
    return fail("invalid_accent_theme", "Alege o culoare din paleta disponibilă.", 400);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO user_preferences (user_id, accent_theme, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET accent_theme = excluded.accent_theme, updated_at = excluded.updated_at"
  ).bind(current.userId, body.accentTheme, now).run();
  await recordAudit(env, current.choirId, current.userId, "account.preferences.updated", "user", current.userId, {
    accentTheme: body.accentTheme
  });
  return json({ accentTheme: body.accentTheme, message: "Paleta de culori a fost salvată." });
}
async function saveAttendance(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot înregistra prezența.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const body = await readJson(request, 32768);
  if (!body || !isIsoDate(body.date)) {
    return fail("invalid_attendance_date", "Alege o dată validă pentru repetiție.", 400);
  }
  if (typeof body.title !== "string") {
    return fail("invalid_attendance_title", "Completează denumirea repetiției.", 400);
  }
  const title = body.title.trim().replace(/[\\u0000-\\u001f\\u007f]/g, "").replace(/\\s+/g, " ");
  if (!title || title.length > 80) {
    return fail("invalid_attendance_title", "Denumirea trebuie să aibă între 1 și 80 de caractere.", 400);
  }
  if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > 300) {
    return fail("invalid_attendance_records", "Lista de prezență este goală sau prea mare.", 400);
  }
  const supplied = new Map<string, AttendanceStatus>();
  for (const item of body.records) {
    if (!item || typeof item !== "object") {
      return fail("invalid_attendance_records", "Lista de prezență nu este validă.", 400);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.membershipId !== "string" || !/^[a-f0-9-]{36}$/i.test(record.membershipId) ||
        !isAttendanceStatus(record.status) || supplied.has(record.membershipId)) {
      return fail("invalid_attendance_records", "Verifică numele și statusurile din lista de prezență.", 400);
    }
    supplied.set(record.membershipId, record.status);
  }
  const rosterResult = await env.DB.prepare(
    "SELECT id FROM choir_memberships WHERE choir_id = ? AND status = 'active'"
  ).bind(current.choirId).all<{ id: string }>();
  const rosterIds = (rosterResult.results ?? []).map((row) => row.id);
  if (rosterIds.length === 0 || rosterIds.length !== supplied.size ||
      rosterIds.some((id) => !supplied.has(id))) {
    return fail("attendance_roster_changed", "Lista membrilor s-a schimbat. Reîncarcă lista și încearcă din nou.", 409);
  }

  const proposedId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO attendance_sessions (id, choir_id, session_date, title, created_by_user_id) " +
    "VALUES (?, ?, ?, ?, ?) ON CONFLICT(choir_id, session_date, title) DO NOTHING"
  ).bind(proposedId, current.choirId, body.date, title, current.userId).run();
  const sessionResult = await env.DB.prepare(
    "SELECT id FROM attendance_sessions WHERE choir_id = ? AND session_date = ? AND title = ? LIMIT 1"
  ).bind(current.choirId, body.date, title).all<{ id: string }>();
  const sessionId = sessionResult.results?.[0]?.id;
  if (!sessionId) throw new Error("Attendance session was not persisted");
  const now = new Date().toISOString();
  const statements = Array.from(supplied.entries(), ([membershipId, status]) => env.DB!.prepare(
    "INSERT INTO attendance_records (id, session_id, membership_id, status, recorded_by_user_id, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, membership_id) DO UPDATE SET " +
    "status = excluded.status, recorded_by_user_id = excluded.recorded_by_user_id, updated_at = excluded.updated_at"
  ).bind(crypto.randomUUID(), sessionId, membershipId, status, current.userId, now));
  await env.DB.batch(statements);
  await recordAudit(env, current.choirId, current.userId, "conductor.attendance.saved", "attendance_session", sessionId, {
    sessionDate: body.date, title, memberCount: supplied.size
  });
  return json({ sessionId, date: body.date, title, memberCount: supplied.size, message: "Prezența a fost salvată." });
}
async function getAttendanceReport(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot consulta prezența.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = today.slice(0, 7) + "-01";
  const from = url.searchParams.get("from") ?? defaultFrom;
  const to = url.searchParams.get("to") ?? today;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return fail("invalid_attendance_range", "Alege un interval de date valid.", 400);
  }
  const span = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
  if (span > 366) return fail("attendance_range_too_large", "Exportul poate cuprinde cel mult 367 de zile.", 400);
  const [sessionsResult, membersResult, recordsResult] = await Promise.all([
    env.DB.prepare(
      "SELECT id, session_date AS date, title FROM attendance_sessions " +
      "WHERE choir_id = ? AND session_date BETWEEN ? AND ? " +
      "ORDER BY session_date ASC, title COLLATE NOCASE ASC"
    ).bind(current.choirId, from, to).all<{ id: string; date: string; title: string }>(),
    env.DB.prepare(
      "SELECT m.id AS membershipId, u.display_name AS displayName, m.role, m.voice_part AS voicePart " +
      "FROM choir_memberships m JOIN users u ON u.id = m.user_id " +
      "WHERE m.choir_id = ? AND m.status != 'invited' " +
      "ORDER BY u.display_name COLLATE NOCASE"
    ).bind(current.choirId).all<{ membershipId: string; displayName: string; role: Role; voicePart: VoicePart | null }>(),
    env.DB.prepare(
      "SELECT ar.session_id AS sessionId, ar.membership_id AS membershipId, ar.status " +
      "FROM attendance_records ar JOIN attendance_sessions s ON s.id = ar.session_id " +
      "WHERE s.choir_id = ? AND s.session_date BETWEEN ? AND ?"
    ).bind(current.choirId, from, to).all<{ sessionId: string; membershipId: string; status: AttendanceStatus }>()
  ]);
  const sessions = sessionsResult.results ?? [];
  const members = membersResult.results ?? [];
  const records = recordsResult.results ?? [];
  await recordAudit(env, current.choirId, current.userId, "conductor.attendance.report_viewed", "choir", current.choirId, {
    from, to, sessionCount: sessions.length
  });
  return json({ from, to, sessions, members, records });
}
async function listInvitations(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot vedea invitațiile.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "SELECT a.id, a.intended_role AS role, a.voice_part AS voicePart, a.expires_at AS expiresAt, " +
    "a.created_at AS createdAt, u.display_name AS createdBy " +
    "FROM activation_codes a LEFT JOIN users u ON u.id = a.created_by_user_id " +
    "WHERE a.choir_id = ? AND a.used_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > ? " +
    "ORDER BY a.created_at DESC LIMIT 100"
  ).bind(current.choirId, now).all();
  return json({ invitations: result.results ?? [], actorRole: current.role });
}
async function updateMemberPhoneVerification(
  request: Request, env: Env, targetId: string
): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot verifica numerele membrilor.", 403);
  const target = await manageableMember(env, current, targetId);
  if (target instanceof Response) return target;
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);

  const body = await readJson(request);
  if (!body || typeof body.verified !== "boolean" || !validPin(body.pin)) {
    return fail("invalid_request", "Introdu PIN-ul de 6 cifre și alege starea verificării.", 400);
  }
  if (!(await allowAttempt(request, env, "phone-verification-ip", 24)) ||
      !(await allowAttempt(request, env, "phone-verification-user", 12, await sha256(current.userId)))) {
    return fail("rate_limited", "Prea multe încercări. Reîncearcă peste 15 minute.", 429);
  }

  const credentials = await env.DB.prepare(
    "SELECT pin_salt, pin_hash FROM users WHERE id = ? AND status = 'active' LIMIT 1"
  ).bind(current.userId).all<{ pin_salt: string; pin_hash: string }>();
  const credential = credentials.results?.[0];
  const calculatedHash = await derivePinHash(body.pin as string, credential?.pin_salt || "00000000000000000000000000000000");
  if (!credential?.pin_hash || !constantTimeEqual(calculatedHash, credential.pin_hash)) {
    return fail("invalid_pin", "PIN incorect. Starea verificării nu a fost modificată.", 401);
  }

  const verified = body.verified;
  const now = new Date().toISOString();
  const update = await env.DB.prepare(
    "UPDATE choir_memberships SET phone_verified_at = ?, phone_verified_by_user_id = ? " +
    "WHERE choir_id = ? AND user_id = ? AND status = 'active' " +
    "AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' " +
    "AND (? = 0 OR email_normalized IS NOT NULL))"
  ).bind(
    verified ? now : null,
    verified ? current.userId : null,
    current.choirId,
    targetId,
    targetId,
    verified ? 1 : 0
  ).run();
  if (Number(update.meta?.changes || 0) !== 1) {
    return fail("phone_unavailable", "Nu există un număr salvat pentru acest membru sau contul nu mai este activ.", 409);
  }

  await recordAudit(
    env, current.choirId, current.userId,
    verified ? "account.phone.verified_by_conductor" : "account.phone.verification_revoked",
    "user", targetId, { verified }
  );
  return json({
    ok: true,
    phoneVerified: verified,
    phoneVerifiedAt: verified ? now : null,
    phoneVerifiedBy: verified ? current.displayName : null,
    message: verified
      ? "Numărul a fost marcat ca verificat de dirijor."
      : "Bifa de verificare a fost eliminată."
  });
}
async function createInvitation(request: Request, env: Env): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot emite invitații.", 403);
  const body = await readJson(request);
  if (!body) return fail("invalid_request", "Cerere invalidă.", 400);
  const role = body.role;
  const voicePart = body.voicePart;
  if (role !== "member" && role !== "conductor") {
    return fail("invalid_role", "Rol invalid.", 400);
  }
  if (role === "conductor" && current.role !== "owner") {
    return fail("owner_required", "Doar administratorul principal poate invita alți dirijori.", 403);
  }
  if (role === "member" && !isVoicePart(voicePart)) {
    return fail("voice_required", "Alege vocea membrului.", 400);
  }
  if (role === "conductor" && voicePart !== null && voicePart !== undefined && !isVoicePart(voicePart)) {
    return fail("invalid_voice", "Voce invalidă.", 400);
  }
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const code = randomCode(16);
  const codeHash = await sha256(code);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const voice = role === "member" ? voicePart : null;
  const statements = [
    env.DB.prepare(
      "INSERT INTO activation_codes (id, choir_id, code_hash, intended_role, voice_part, created_by_user_id, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, current.choirId, codeHash, role, voice, current.userId, expiresAt),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "VALUES (?, ?, ?, 'activation_code.created', 'activation_code', ?, ?)"
    ).bind(crypto.randomUUID(), current.choirId, current.userId, id, JSON.stringify({ role, voicePart: voice }))
  ];
  await env.DB.batch(statements);
  return json({
    invitation: { id, role, voicePart: voice, expiresAt },
    code: formatCode(code),
    message: "Codul este valabil 7 zile, poate fi folosit o singură dată și nu este legat de un număr de telefon. Membrul își introduce numărul la activare."
  }, 201);
}
async function revokeInvitation(request: Request, env: Env, invitationId: string): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot revoca invitații.", 403);
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const now = new Date().toISOString();
  const sql = current.role === "owner"
    ? "UPDATE activation_codes SET revoked_at = ? WHERE id = ? AND choir_id = ? AND used_at IS NULL AND revoked_at IS NULL"
    : "UPDATE activation_codes SET revoked_at = ? WHERE id = ? AND choir_id = ? AND used_at IS NULL AND revoked_at IS NULL AND intended_role = 'member'";
  const result = await env.DB.prepare(sql).bind(now, invitationId, current.choirId).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    return fail("invitation_not_found", "Invitația nu mai este activă sau nu poate fi revocată.", 404);
  }
  await recordAudit(env, current.choirId, current.userId, "activation_code.revoked", "activation_code", invitationId);
  return json({ ok: true });
}
async function manageableMember(
  env: Env, current: SessionRow, targetId: string
): Promise<{ role: Role } | Response> {
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const result = await env.DB.prepare(
    "SELECT role FROM choir_memberships WHERE choir_id = ? AND user_id = ? AND status = 'active' LIMIT 1"
  ).bind(current.choirId, targetId).all<{ role: Role }>();
  const target = result.results?.[0];
  if (!target || !isRole(target.role)) return fail("member_not_found", "Membrul nu a fost găsit.", 404);
  if (current.role !== "owner" && target.role !== "member") {
    return fail("forbidden", "Dirijorii pot gestiona accesul membrilor, nu al altor dirijori.", 403);
  }
  return target;
}
async function issueResetCode(request: Request, env: Env, targetId: string): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot emite coduri de resetare.", 403);
  const target = await manageableMember(env, current, targetId);
  if (target instanceof Response) return target;
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const code = randomCode(16);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
  const statements = [
    env.DB.prepare(
      "UPDATE access_reset_codes SET revoked_at = ? WHERE user_id = ? AND choir_id = ? AND used_at IS NULL AND revoked_at IS NULL"
    ).bind(now, targetId, current.choirId),
    env.DB.prepare(
      "INSERT INTO access_reset_codes (id, choir_id, user_id, code_hash, created_by_user_id, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, current.choirId, targetId, await sha256(code), current.userId, expiresAt),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) " +
      "VALUES (?, ?, ?, 'account.reset_code.created', 'user', ?, '{}')"
    ).bind(crypto.randomUUID(), current.choirId, current.userId, targetId)
  ];
  await env.DB.batch(statements);
  return json({
    code: formatCode(code), expiresAt,
    message: "Transmite acest cod numai membrului respectiv. Este valabil 30 de minute și poate fi folosit o singură dată."
  }, 201);
}
async function renewLoginCode(request: Request, env: Env, targetId: string): Promise<Response> {
  const current = await requireSession(request, env);
  if (current instanceof Response) return current;
  if (!isConductor(current)) return fail("forbidden", "Doar dirijorii pot reînnoi coduri de cont.", 403);
  const target = await manageableMember(env, current, targetId);
  if (target instanceof Response) return target;
  if (!env.DB) return fail("database_not_configured", "Baza de date nu este configurată.", 503);
  const code = randomCode(10);
  const codeHash = await sha256(code);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE users SET login_code_hash = ?, updated_at = ? WHERE id = ? AND EXISTS " +
    "(SELECT 1 FROM choir_memberships WHERE choir_id = ? AND user_id = ? AND status = 'active')"
  ).bind(codeHash, now, targetId, current.choirId, targetId).run();
  if (Number(result.meta?.changes || 0) !== 1) return fail("member_not_found", "Membrul nu a fost găsit.", 404);
  await recordAudit(env, current.choirId, current.userId, "account.login_code.renewed", "user", targetId);
  return json({
    code: formatCode(code),
    message: "Codul vechi nu mai funcționează. Transmite noul cod membrului."
  }, 200);
}
async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, app: "choir-app", databaseConfigured: Boolean(env.DB) });
  }
  if (request.method === "GET" && path === "/api/setup/status") return setupStatus(request, env);
  if (request.method === "GET" && path === "/api/session") {
    const unavailable = authUnavailable(env);
    if (unavailable) return json({ authenticated: false, authenticationConfigured: false }, 200);
    const current = await getCurrentSession(request, env);
    return json(current ? {
      authenticated: true,
      legalAcceptanceRequired: !(await hasCurrentLegalAcceptance(env, current.userId, current.choirId)),
      user: {
        id: current.userId, displayName: current.displayName, role: current.role,
        voicePart: current.voicePart, phoneNumber: current.phoneNumber, choirName: current.choirName
      }
    } : { authenticated: false, authenticationConfigured: true });
  }
  if (request.method === "GET" && path === "/api/account/preferences") return getAccountPreferences(request, env);
  if (request.method === "GET" && path === "/api/conductor/attendance") return getAttendanceReport(request, env);
  if (request.method !== "GET" && request.method !== "POST") {
    return fail("method_not_allowed", "Metoda nu este permisă.", 405);
  }
  if (request.method === "POST" && !sameOrigin(request)) {
    return fail("origin_not_allowed", "Cerere refuzată.", 403);
  }
  if (request.method === "POST" && path === "/api/legal/accept") return acceptLegalTerms(request, env);
  if (request.method === "POST" && path === "/api/setup/bootstrap") return bootstrapOwner(request, env);
  if (request.method === "POST" && path === "/api/auth/activate") return activateAccount(request, env);
  if (request.method === "POST" && path === "/api/auth/login") return login(request, env);
  if (request.method === "POST" && path === "/api/auth/logout") return logout(request, env);
  if (request.method === "POST" && path === "/api/auth/reset-access") return resetAccess(request, env);
  if (request.method === "POST" && path === "/api/account/phone") return updateAccountPhone(request, env);
  if (request.method === "POST" && path === "/api/account/preferences") return saveAccountPreferences(request, env);
  if (request.method === "POST" && path === "/api/conductor/attendance") return saveAttendance(request, env);
  if (request.method === "GET" && path === "/api/conductor/media/status") return getMediaStorageStatus(request, env);
  if (request.method === "GET" && path === "/api/conductor/media/diagnose") return diagnoseMediaStorage(request, env);
  if (request.method === "GET" && path === "/api/conductor/songs") return listConductorSongs(request, env);
  if (request.method === "POST" && path === "/api/conductor/songs") return createSong(request, env);
  if (request.method === "POST" && path === "/api/conductor/assets/complete") return completeMediaUpload(request, env);
  if (request.method === "GET" && path === "/api/songs") return listSongs(request, env);
  const songPublishMatch = path.match(/^\/api\/conductor\/songs\/([a-f0-9-]{36})\/publish$/);
  if (request.method === "POST" && songPublishMatch) return publishSong(request, env, songPublishMatch[1]);
  const songUploadMatch = path.match(/^\/api\/conductor\/songs\/([a-f0-9-]{36})\/assets\/upload-url$/);
  if (request.method === "POST" && songUploadMatch) return prepareMediaUpload(request, env, songUploadMatch[1]);
  const assetDownloadMatch = path.match(/^\/api\/assets\/([a-f0-9-]{36})\/download$/);
  if (request.method === "GET" && assetDownloadMatch) return downloadSongAsset(request, env, assetDownloadMatch[1]);
  if (request.method === "GET" && path === "/api/conductor/members") return listMembers(request, env);
  if (request.method === "POST" && path === "/api/conductor/contacts") return listMemberContacts(request, env);
  if (request.method === "GET" && path === "/api/conductor/invitations") return listInvitations(request, env);
  if (request.method === "POST" && path === "/api/conductor/invitations") return createInvitation(request, env);
  const phoneVerificationMatch = path.match(/^\/api\/conductor\/members\/([a-f0-9-]{36})\/phone-verification$/);
  if (request.method === "POST" && phoneVerificationMatch) return updateMemberPhoneVerification(request, env, phoneVerificationMatch[1]);
  const revokeMatch = path.match(/^\/api\/conductor\/invitations\/([a-f0-9-]{36})\/revoke$/);
  if (request.method === "POST" && revokeMatch) return revokeInvitation(request, env, revokeMatch[1]);
  const resetMatch = path.match(/^\/api\/conductor\/members\/([a-f0-9-]{36})\/reset$/);
  if (request.method === "POST" && resetMatch) return issueResetCode(request, env, resetMatch[1]);
  const phoneChangeCodeMatch = path.match(/^\/api\/conductor\/members\/([a-f0-9-]{36})\/phone-change-code$/);
  if (request.method === "POST" && phoneChangeCodeMatch) return issuePhoneChangeCode(request, env, phoneChangeCodeMatch[1]);
  const renewMatch = path.match(/^\/api\/conductor\/members\/([a-f0-9-]{36})\/renew-login-code$/);
  if (request.method === "POST" && renewMatch) return renewLoginCode(request, env, renewMatch[1]);
  return fail("not_found", "Resursa nu a fost găsită.", 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        // Never log request bodies, setup keys, PINs, account codes, or cookies.
        // Safe metadata here makes production D1/runtime failures diagnosable.
        console.error("Worker API request failed", {
          method: request.method,
          path: url.pathname,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        return fail(
          "service_unavailable",
          "Serviciul nu a putut procesa cererea. Verifică migrațiile D1 și configurația serverului.",
          503
        );
      }
    }
    const staticPages: Record<string, string> = {
      "/invitation": "invitation.html",
      "/invitation/": "invitation.html",
      "/account": "account.html",
      "/account/": "account.html",
      "/prezenta": "attendance.html",
      "/prezenta/": "attendance.html",
      "/termeni": "termeni.html",
      "/confidentialitate": "confidentialitate.html"
    };
    const mappedPage = staticPages[url.pathname];
    if (mappedPage && request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "Allow": "GET, HEAD", "Cache-Control": "no-store" }
      });
    }
    const assetRequest = mappedPage
      ? new Request(new URL("/" + mappedPage, url.origin).toString(), {
          method: request.method,
          headers: request.headers
        })
      : request;
    const assetResponse = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(assetResponse.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (mappedPage) headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests");
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    });
  }
};
