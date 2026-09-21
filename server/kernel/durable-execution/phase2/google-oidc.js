const SERVICE_ACCOUNT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function runAppAudience(value) {
  let parsed;
  try { parsed = new URL(value); } catch {
    throw failure(400, 'oidc_config_invalid', 'OIDC audience must be a valid URL');
  }
  if (parsed.protocol !== 'https:'
    || !parsed.hostname.endsWith('.run.app')
    || parsed.hostname === 'run.app'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw failure(400, 'oidc_config_invalid', 'OIDC audience must be an exact HTTPS run.app service origin');
  }
  return parsed.origin;
}

function allowedEmails(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw failure(400, 'oidc_config_invalid', 'OIDC service account email allowlist must be nonempty');
  }
  const unique = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !SERVICE_ACCOUNT_RE.test(value)) {
      throw failure(400, 'oidc_config_invalid', 'OIDC allowlist contains an invalid service account email');
    }
    unique.add(value);
  }
  if (unique.size !== values.length) {
    throw failure(400, 'oidc_config_invalid', 'OIDC service account email allowlist contains a duplicate');
  }
  return unique;
}

function bearerFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    throw failure(401, 'oidc_authorization_invalid', 'A bearer ID token is required');
  }
  const lower = headers.authorization;
  const upper = headers.Authorization;
  if (lower !== undefined && upper !== undefined && lower !== upper) {
    throw failure(401, 'oidc_authorization_invalid', 'Conflicting authorization headers are not accepted');
  }
  const header = lower ?? upper;
  if (typeof header !== 'string' || header.length > 16_384) {
    throw failure(401, 'oidc_authorization_invalid', 'A bearer ID token is required');
  }
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match || !JWT_RE.test(match[1])) {
    throw failure(401, 'oidc_authorization_invalid', 'Authorization must contain one Google-signed bearer ID token');
  }
  return match[1];
}

async function verifiedPayload(verifier, token, audience) {
  let ticket;
  try {
    ticket = typeof verifier === 'function'
      ? await verifier({ idToken: token, audience })
      : await verifier.verifyIdToken({ idToken: token, audience });
  } catch {
    throw failure(401, 'oidc_token_invalid', 'Google OIDC verification failed');
  }
  const payload = typeof ticket?.getPayload === 'function'
    ? ticket.getPayload()
    : (ticket?.payload || ticket);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw failure(401, 'oidc_token_invalid', 'Google OIDC verifier returned no claims');
  }
  return payload;
}

export function createGoogleOidcVerifier({
  verifier,
  audience,
  allowedServiceAccountEmails,
  clock = () => Date.now(),
  clockSkewSeconds = 60,
  maxTokenLifetimeSeconds = 3_700,
} = {}) {
  if (!(typeof verifier === 'function' || typeof verifier?.verifyIdToken === 'function')) {
    throw failure(500, 'oidc_verifier_invalid', 'An injected Google ID token verifier is required');
  }
  if (typeof clock !== 'function') {
    throw failure(500, 'oidc_clock_invalid', 'An injected OIDC clock function is required');
  }
  const expectedAudience = runAppAudience(audience);
  const emails = allowedEmails(allowedServiceAccountEmails);
  if (!Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 300) {
    throw failure(400, 'oidc_config_invalid', 'OIDC clock skew must be an integer from 0 through 300 seconds');
  }
  if (!Number.isInteger(maxTokenLifetimeSeconds) || maxTokenLifetimeSeconds < 60 || maxTokenLifetimeSeconds > 7_200) {
    throw failure(400, 'oidc_config_invalid', 'OIDC maximum token lifetime is invalid');
  }

  async function verifyToken(token) {
    if (typeof token !== 'string' || token.length > 16_384 || !JWT_RE.test(token)) {
      throw failure(401, 'oidc_token_invalid', 'Google OIDC token is malformed');
    }
    const payload = await verifiedPayload(verifier, token, expectedAudience);
    const nowMs = Number(clock());
    if (!Number.isFinite(nowMs)) throw failure(500, 'oidc_clock_invalid', 'OIDC verifier clock is invalid');
    const now = Math.floor(nowMs / 1000);
    const issuedAt = Number(payload.iat);
    const expiresAt = Number(payload.exp);
    const validTimes = Number.isSafeInteger(issuedAt)
      && Number.isSafeInteger(expiresAt)
      && issuedAt <= now + clockSkewSeconds
      && expiresAt > now - clockSkewSeconds
      && expiresAt > issuedAt
      && expiresAt - issuedAt <= maxTokenLifetimeSeconds + clockSkewSeconds;
    if (payload.aud !== expectedAudience
      || !GOOGLE_ISSUERS.has(payload.iss)
      || typeof payload.email !== 'string'
      || !emails.has(payload.email)
      || payload.email_verified !== true
      || typeof payload.sub !== 'string'
      || !payload.sub
      || !validTimes) {
      throw failure(403, 'oidc_claims_invalid', 'Google OIDC claims do not match the worker trust policy');
    }
    return Object.freeze({
      email: payload.email,
      subject: payload.sub,
      audience: payload.aud,
      issuer: payload.iss,
      issued_at: issuedAt,
      expires_at: expiresAt,
    });
  }

  async function verifyRequest({ headers } = {}) {
    return verifyToken(bearerFromHeaders(headers));
  }

  async function verify({ headers, audience: requestAudience } = {}) {
    let suppliedAudience;
    try {
      suppliedAudience = runAppAudience(requestAudience);
    } catch {
      throw failure(401, 'oidc_audience_invalid', 'OIDC request audience does not match the trust policy');
    }
    if (suppliedAudience !== expectedAudience) {
      throw failure(401, 'oidc_audience_invalid', 'OIDC request audience does not match the trust policy');
    }
    return verifyRequest({ headers });
  }

  return Object.freeze({
    verify,
    verifyRequest,
    verifyToken,
    audience: expectedAudience,
    issuers: Object.freeze([...GOOGLE_ISSUERS]),
    allowed_emails: Object.freeze([...emails]),
  });
}
