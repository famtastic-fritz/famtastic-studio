import http from 'node:http';

const JSON_TYPE = 'application/json';

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw failure(503, 'http_config_invalid', `${label} is required`);
  }
  return value;
}

function checkedConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw failure(503, 'http_config_required', 'An explicit HTTP configuration is required');
  }
  if (!Number.isSafeInteger(config.maxJsonBytes) || config.maxJsonBytes < 2) {
    throw failure(503, 'http_config_invalid', 'config.maxJsonBytes must be an integer of at least 2 bytes');
  }
  if (!config.allowedPrincipals || typeof config.allowedPrincipals !== 'object' || Array.isArray(config.allowedPrincipals)) {
    throw failure(503, 'http_config_invalid', 'config.allowedPrincipals is required');
  }
  const principalKeys = Object.keys(config.allowedPrincipals).sort();
  if (principalKeys.length !== 3 || principalKeys.some((key, index) => key !== ['accept', 'execute', 'reconcile'][index])) {
    throw failure(503, 'http_config_invalid', 'config.allowedPrincipals must contain only accept, reconcile, and execute');
  }
  const allowedPrincipals = {};
  for (const principalKey of principalKeys) {
    const emails = config.allowedPrincipals[principalKey];
    if (!Array.isArray(emails) || emails.length === 0
      || new Set(emails).size !== emails.length
      || emails.some((email) => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw failure(503, 'http_config_invalid', `config.allowedPrincipals.${principalKey} must be a nonempty exact email array`);
    }
    allowedPrincipals[principalKey] = Object.freeze([...emails]);
  }
  return Object.freeze({
    audience: requiredString(config.audience, 'config.audience'),
    maxJsonBytes: config.maxJsonBytes,
    allowedPrincipals: Object.freeze(allowedPrincipals),
  });
}

function checkedAuth(auth) {
  if (!auth || typeof auth.verify !== 'function') {
    throw failure(503, 'http_auth_required', 'An auth service with verify() is required');
  }
  return auth;
}

function checkedRoutes(routes) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw failure(503, 'http_routes_required', 'At least one explicit HTTP route is required');
  }
  const seen = new Set();
  return routes.map((route) => {
    const key = `${route?.method} ${route?.path}`;
    if (route?.method !== 'POST' || !/^\/[A-Za-z0-9/_-]+$/.test(route?.path || '')
      || !/^[a-z][a-z0-9_]*$/.test(route?.principalKey || '')
      || typeof route.validate !== 'function' || typeof route.invoke !== 'function' || seen.has(key)) {
      throw failure(503, 'http_route_invalid', 'Every route must be one unique explicit POST path with principalKey, validate(), and invoke()');
    }
    seen.add(key);
    return Object.freeze({ ...route });
  });
}

function requestHeaders(headers = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])));
}

function requireJsonContentType(headers) {
  const supplied = headers['content-type'];
  if (typeof supplied !== 'string') {
    throw failure(415, 'json_content_type_required', 'Content-Type must be application/json');
  }
  const parts = supplied.split(';').map((part) => part.trim().toLowerCase());
  if (parts[0] !== JSON_TYPE || parts.slice(1).some((part) => part !== 'charset=utf-8')) {
    throw failure(415, 'json_content_type_required', 'Content-Type must be application/json with an optional UTF-8 charset');
  }
}

function checkDeclaredLength(headers, maxJsonBytes) {
  const value = headers['content-length'];
  if (value === undefined) return;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw failure(400, 'content_length_invalid', 'Content-Length must be an exact non-negative integer');
  }
  if (Number(value) > maxJsonBytes) {
    throw failure(413, 'json_body_too_large', `JSON body exceeds ${maxJsonBytes} bytes`);
  }
}

export function readExactJson(req, { maxJsonBytes } = {}) {
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 2) {
    return Promise.reject(failure(503, 'http_config_invalid', 'A valid JSON byte limit is required'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const stop = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxJsonBytes) {
        stop(failure(413, 'json_body_too_large', `JSON body exceeds ${maxJsonBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks, bytes);
      if (raw.length === 0) {
        reject(failure(400, 'json_body_invalid', 'Request body must contain JSON'));
        return;
      }
      try {
        const text = raw.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(raw)) throw new Error('invalid UTF-8');
        resolve({ raw, body: JSON.parse(text) });
      } catch {
        reject(failure(400, 'json_body_invalid', 'Request body is not valid JSON'));
      }
    });
    req.on('aborted', () => stop(failure(400, 'request_aborted', 'Request body was aborted')));
    req.on('error', () => stop(failure(400, 'request_stream_failed', 'Request body could not be read')));
  });
}

function jsonResponse(res, statusCode, body) {
  if (res.writableEnded) return;
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': String(bytes.length),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}

function publicError(error) {
  const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode : 500;
  const code = typeof error?.code === 'string' && error.code ? error.code : 'request_failed';
  return { statusCode, body: { error: code } };
}

function resultStatus(result, fallback) {
  const candidate = result?.statusCode ?? result?.status;
  return Number.isInteger(candidate) && candidate >= 200 && candidate <= 299 ? candidate : fallback;
}

export function createPhase2Handler({ role, schema, auth, config, routes } = {}) {
  const serviceRole = requiredString(role, 'role');
  const serviceSchema = requiredString(schema, 'schema');
  const serviceAuth = checkedAuth(auth);
  const serviceRoutes = checkedRoutes(routes);
  const serviceConfig = checkedConfig(config);

  return async function phase2Handler(req, res) {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        jsonResponse(res, 200, { status: 'ok', role: serviceRole, schema: serviceSchema });
        return;
      }
      const route = serviceRoutes.find((candidate) => candidate.method === req.method && candidate.path === req.url);
      if (!route) throw failure(404, 'route_not_found', 'Route not found');
      const headers = requestHeaders(req.headers);
      requireJsonContentType(headers);
      checkDeclaredLength(headers, serviceConfig.maxJsonBytes);
      let principal;
      try {
        principal = await serviceAuth.verify({ headers, audience: serviceConfig.audience });
      } catch {
        throw failure(401, 'authentication_failed', 'Authentication failed');
      }
      if (!principal) throw failure(401, 'authentication_required', 'Authentication failed');
      const principalEmail = typeof principal === 'string' ? principal : principal.email;
      if (!serviceConfig.allowedPrincipals[route.principalKey].includes(principalEmail)) {
        throw failure(403, 'principal_forbidden', 'Principal is not permitted for this route');
      }
      const { raw, body } = await readExactJson(req, serviceConfig);
      route.validate(body);
      const result = await route.invoke({ raw, body, headers, principal });
      const responseBody = result?.body === undefined ? result : result.body;
      jsonResponse(res, resultStatus(result, route.successStatus), responseBody ?? {});
    } catch (error) {
      const response = publicError(error);
      jsonResponse(res, response.statusCode, response.body);
    }
  };
}

export function createPhase2Server(options) {
  return http.createServer(createPhase2Handler(options));
}

export async function listenPhase2Server({ server, config } = {}) {
  if (!server || typeof server.listen !== 'function') {
    throw failure(503, 'http_server_required', 'An HTTP server is required');
  }
  if (!config || typeof config !== 'object') {
    throw failure(503, 'http_config_required', 'An explicit listen configuration is required');
  }
  const host = requiredString(config.host, 'config.host');
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw failure(503, 'http_config_invalid', 'config.port must be an integer from 0 through 65535');
  }
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(config.port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  return server;
}
