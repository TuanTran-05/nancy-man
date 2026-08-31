import { Buffer } from 'node:buffer';
import process from 'node:process';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { clearTimeout, setTimeout } from 'node:timers';
import { TextDecoder } from 'node:util';
import { pathToFileURL, URL } from 'node:url';

const ROUTES = Object.freeze([
  Object.freeze({ method: 'GET', path: '/', status: 200 }),
  Object.freeze({ method: 'GET', path: '/api/session', status: 401 }),
  Object.freeze({ method: 'GET', path: '/api/overview', status: 401 })
]);
const ROUTE_KEYS = new Set(ROUTES.map(({ method, path }) => `${method} ${path}`));
export const PUBLIC_ROUTE_OWNERSHIP = Object.freeze({
  canonicalApiPrefix: '/api/v1/',
  canonicalApiUpstream: '127.0.0.1:3100',
  webRootUpstream: '127.0.0.1:3101',
  legacyWebhookPath: '/api/zalo-bot/webhook',
  legacyWebhookUpstream: '127.0.0.1:3101',
  retiredSessionPath: '/api/session',
  retiredStatus: 410
});
const SECURITY_HEADERS = new Set([
  'cache-control',
  'content-security-policy',
  'cross-origin-opener-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options'
]);
const UI_LANDMARKS = Object.freeze([
  Object.freeze({ value: '#root', pattern: /<div\s+[^>]*id=["']root["'][^>]*>/iu }),
  Object.freeze({ value: 'html[lang=vi]', pattern: /<html\s+[^>]*lang=["']vi["'][^>]*>/iu }),
  Object.freeze({
    value: 'meta[name=robots][content=noindex,nofollow]',
    pattern: /<meta\s+(?=[^>]*name=["']robots["'])(?=[^>]*content=["']noindex,nofollow["'])[^>]*>/iu
  }),
  Object.freeze({
    value: 'title=Thien Uy Ops Console',
    pattern: /<title>\s*Thien Uy Ops Console\s*<\/title>/iu
  })
]);
const UI_LANDMARK_VALUES = new Set(UI_LANDMARKS.map(({ value }) => value));
const FORBIDDEN_KEY =
  /(?:^|[_-])(?:cookies?|csrf|csrf_?tokens?|csrftokens?|sessions?|mfas?|totps?|usernames?|user_names?|zalo[a-z0-9]*|passwords?|secrets?|tokens?|nonces?|authorizations?|notes?|incidents?|incident_?notes?|incidentnotes?|raw_incidents?|summar(?:y|ies)|databases?|db_paths?|sql|queries?|statements?|telemetry|payloads?|timestamps?|captured_at|observed_at|expires_at|created_at|updated_at|[a-z0-9]*_?ids?)(?:$|[_-])/iu;
const FORBIDDEN_TEXT =
  /(?:^|[^a-z])(?:cookies?|csrf|sessions?|mfas?|totps?|user[_-]?names?|zalo|passwords?|secrets?|tokens?|nonces?|bearer|authorizations?|incidents?(?:\s+notes?)?|raw\s+incidents?|telemetry|payloads?|sql|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from)(?:$|[^a-z])/iu;
const DATABASE_PATH =
  /(?:\/(?:srv|var|run|etc|home)\/[^\s"']+|[A-Za-z]:\\[^\s"']+|(?:postgres(?:ql)?):\/\/|\.(?:sqlite(?:3)?|db)(?:\b|[-.]))/iu;
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/iu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const MAX_DECODED_VARIANTS = 32;
const MAX_DECODE_STAGES = 8;
const MAX_ENCODED_LENGTH = 4096;
const MAX_ENCODED_TOKENS = 64;
const MAX_ENCODED_TOKEN_CHARACTERS = 16_384;

function fail(code) {
  throw new Error(code);
}

export function validatePublicRouteOwnership(config) {
  if (typeof config !== 'string') fail('PUBLIC_CONTRACT_ROUTING_INVALID');
  const hasCanonicalApi = new RegExp(
    `location (?:\\^~ )?${PUBLIC_ROUTE_OWNERSHIP.canonicalApiPrefix.replaceAll('/', '\\/')}\\s*\\{[\\s\\S]*?proxy_pass http:\\/\\/${PUBLIC_ROUTE_OWNERSHIP.canonicalApiUpstream}`
  ).test(config);
  const hasWebRoot = new RegExp(
    `location \\/\\s*\\{[\\s\\S]*?proxy_pass http:\\/\\/${PUBLIC_ROUTE_OWNERSHIP.webRootUpstream}`
  ).test(config);
  const hasExactWebhook = new RegExp(
    `location = ${PUBLIC_ROUTE_OWNERSHIP.legacyWebhookPath.replaceAll('/', '\\/')}\\s*\\{[\\s\\S]*?proxy_pass http:\\/\\/${PUBLIC_ROUTE_OWNERSHIP.legacyWebhookUpstream}`
  ).test(config);
  const hasRetiredSession = new RegExp(
    `location = ${PUBLIC_ROUTE_OWNERSHIP.retiredSessionPath.replaceAll('/', '\\/')}\\s*\\{[\\s\\S]*?return ${PUBLIC_ROUTE_OWNERSHIP.retiredStatus};`
  ).test(config);
  if (
    !hasCanonicalApi ||
    !hasWebRoot ||
    !hasExactWebhook ||
    !hasRetiredSession ||
    config.includes('location /api/ {')
  )
    fail('PUBLIC_CONTRACT_ROUTING_INVALID');
  return PUBLIC_ROUTE_OWNERSHIP;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function decodeBase64Text(value, encoding) {
  const compact = value.replace(/\s+/gu, '');
  const pattern = encoding === 'base64' ? /^[A-Za-z0-9+/]+=*$/u : /^[A-Za-z0-9_-]+=*$/u;
  const unpadded = compact.replace(/=+$/u, '');
  if (
    unpadded.length < 4 ||
    compact.length > MAX_ENCODED_LENGTH ||
    unpadded.length % 4 === 1 ||
    !pattern.test(compact)
  )
    return null;
  const padded = `${unpadded}${'='.repeat((4 - (unpadded.length % 4)) % 4)}`;
  try {
    const bytes = Buffer.from(padded, encoding);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const canonical = Buffer.from(decoded, 'utf8').toString(encoding).replace(/=+$/u, '');
    return canonical === unpadded ? decoded : null;
  } catch {
    return null;
  }
}

function encodedTokens(value) {
  const tokens = new Set();
  let characterBudget = 0;
  const addToken = (token) => {
    if (token.replace(/=+$/u, '').length < 4 || tokens.has(token)) return;
    if (
      token.length > MAX_ENCODED_LENGTH ||
      tokens.size >= MAX_ENCODED_TOKENS ||
      characterBudget + token.length > MAX_ENCODED_TOKEN_CHARACTERS
    )
      fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
    tokens.add(token);
    characterBudget += token.length;
  };
  for (const match of value.matchAll(/[A-Za-z0-9+/_-]+=*/gu)) {
    const token = match[0];
    addToken(token);
    let segmentStart = 0;
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] !== '_' && token[index] !== '-' && token[index] !== '/') continue;
      addToken(token.slice(0, index));
      addToken(token.slice(index + 1));
      addToken(token.slice(segmentStart, index));
      segmentStart = index + 1;
    }
    addToken(token.slice(segmentStart));
  }
  return tokens;
}

function decodingTransforms(value) {
  const results = [];
  if (/%[0-9a-f]{2}/iu.test(value)) {
    try {
      const percentDecoded = decodeURIComponent(value);
      if (percentDecoded !== value) results.push(percentDecoded);
    } catch {
      // Malformed percent encodings remain covered by the original text scan.
    }
  }
  for (const encoding of ['base64', 'base64url']) {
    const base64Decoded = decodeBase64Text(value, encoding);
    if (base64Decoded !== null && base64Decoded !== value) results.push(base64Decoded);
  }
  for (const token of encodedTokens(value)) {
    if (token === value) continue;
    for (const encoding of ['base64', 'base64url']) {
      const decodedToken = decodeBase64Text(token, encoding);
      if (decodedToken !== null && decodedToken !== token) results.push(decodedToken);
    }
  }
  return results;
}

function decodedVariants(value) {
  const values = new Set([value]);
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.shift();
    const transforms = decodingTransforms(current.value);
    for (const transformed of transforms) {
      if (values.has(transformed)) continue;
      if (current.depth >= MAX_DECODE_STAGES || values.size >= MAX_DECODED_VARIANTS)
        fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
      values.add(transformed);
      pending.push({ value: transformed, depth: current.depth + 1 });
    }
  }
  return values;
}

function forbiddenText(value) {
  for (const candidate of decodedVariants(value)) {
    if (
      FORBIDDEN_TEXT.test(candidate) ||
      DATABASE_PATH.test(candidate) ||
      ISO_TIMESTAMP.test(candidate) ||
      UUID.test(candidate)
    )
      return true;
  }
  return false;
}

function assertSafeMaterial(value, seen = new Set()) {
  if (typeof value === 'string') {
    if (forbiddenText(value)) fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (!value || typeof value !== 'object' || seen.has(value))
    fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertSafeMaterial(item, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
      if (FORBIDDEN_KEY.test(normalizedKey) || forbiddenText(normalizedKey))
        fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
      assertSafeMaterial(item, seen);
    }
  }
  seen.delete(value);
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/gu, ' ');
}

function headerEntries(headers) {
  if (globalThis.Headers && headers instanceof globalThis.Headers) return [...headers.entries()];
  if (!headers || typeof headers !== 'object' || Array.isArray(headers))
    fail('PUBLIC_CONTRACT_RESPONSE_INVALID');
  return Object.entries(headers).map(([name, value]) => [name, String(value)]);
}

function reduceHeaders(headers) {
  const normalized = new Map();
  for (const [rawName, rawValue] of headerEntries(headers)) {
    const name = rawName.toLowerCase();
    const value = normalizeHeaderValue(rawValue);
    if (name === 'cookie' || name === 'set-cookie' || forbiddenText(name) || forbiddenText(value))
      fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
    if (SECURITY_HEADERS.has(name) && value) normalized.set(name, value);
  }
  return Object.fromEntries(
    [...normalized.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

function shapeOf(value, seen = new Set()) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    if (seen.has(value)) fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
    seen.add(value);
    const items = [
      ...new Map(
        value.map((item) => {
          const shape = shapeOf(item, seen);
          return [JSON.stringify(shape), shape];
        })
      ).values()
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    seen.delete(value);
    return { type: 'array', items };
  }
  if (typeof value === 'object') {
    if (seen.has(value)) fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
    seen.add(value);
    const keys = Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, shapeOf(item, seen)])
    );
    seen.delete(value);
    return { type: 'object', keys };
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return { type: typeof value };
  fail('PUBLIC_CONTRACT_RESPONSE_INVALID');
}

function expectedRoute(method, path) {
  if (
    method !== 'GET' ||
    typeof path !== 'string' ||
    path.includes('%') ||
    path.includes('?') ||
    path.includes('#')
  )
    fail('PUBLIC_CONTRACT_ROUTE_INVALID');
  const key = `${method} ${path}`;
  if (!ROUTE_KEYS.has(key)) fail('PUBLIC_CONTRACT_ROUTE_INVALID');
  return ROUTES.find((item) => item.method === method && item.path === path);
}

function reduceResponse(response) {
  if (!exactKeys(response, ['body', 'headers', 'method', 'route', 'status']))
    fail('PUBLIC_CONTRACT_RESPONSE_INVALID');
  const expected = expectedRoute(response.method, response.route);
  if (!Number.isInteger(response.status) || response.status !== expected.status)
    fail('PUBLIC_CONTRACT_STATUS_MISMATCH');
  if (typeof response.body !== 'string') fail('PUBLIC_CONTRACT_RESPONSE_INVALID');
  const securityHeaders = reduceHeaders(response.headers);
  const contentType = new Map(
    headerEntries(response.headers).map(([name, value]) => [name.toLowerCase(), value])
  ).get('content-type');
  let jsonShape = null;
  let uiLandmarks = [];
  if (expected.path === '/') {
    if (!contentType?.toLowerCase().startsWith('text/html'))
      fail('PUBLIC_CONTRACT_CONTENT_TYPE_MISMATCH');
    assertSafeMaterial(response.body);
    uiLandmarks = UI_LANDMARKS.filter(({ pattern }) => pattern.test(response.body))
      .map(({ value }) => value)
      .sort();
    if (uiLandmarks.length !== UI_LANDMARKS.length) fail('PUBLIC_CONTRACT_UI_LANDMARK_MISSING');
  } else {
    if (!contentType?.toLowerCase().startsWith('application/json'))
      fail('PUBLIC_CONTRACT_CONTENT_TYPE_MISMATCH');
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      fail('PUBLIC_CONTRACT_JSON_INVALID');
    }
    assertSafeMaterial(parsed);
    jsonShape = shapeOf(parsed);
  }
  return {
    route: { method: expected.method, path: expected.path },
    status: expected.status,
    jsonShape,
    securityHeaders,
    uiLandmarks
  };
}

function validateShape(shape) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return false;
  if (
    shape.type === 'null' ||
    shape.type === 'string' ||
    shape.type === 'number' ||
    shape.type === 'boolean'
  )
    return exactKeys(shape, ['type']);
  if (shape.type === 'array')
    if (exactKeys(shape, ['items', 'type']) && Array.isArray(shape.items)) {
      const serializedItems = shape.items.map((item) => JSON.stringify(item));
      if (!isSortedUnique(serializedItems)) fail('PUBLIC_CONTRACT_NOT_CANONICAL');
      return shape.items.every(validateShape);
    } else return false;
  if (
    shape.type !== 'object' ||
    !exactKeys(shape, ['keys', 'type']) ||
    !shape.keys ||
    typeof shape.keys !== 'object' ||
    Array.isArray(shape.keys)
  )
    return false;
  const keys = Object.keys(shape.keys);
  if (!isSortedUnique(keys)) fail('PUBLIC_CONTRACT_NOT_CANONICAL');
  if (keys.some((key) => FORBIDDEN_KEY.test(key) || forbiddenText(key)))
    fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
  return keys.every((key) => validateShape(shape.keys[key]));
}

function isSortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0);
}

export function validatePublicContract(value) {
  if (
    !exactKeys(value, ['entries', 'schemaVersion']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.entries)
  )
    fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
  if (value.entries.length !== ROUTES.length) fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
  const keys = [];
  for (const entry of value.entries) {
    if (!exactKeys(entry, ['jsonShape', 'route', 'securityHeaders', 'status', 'uiLandmarks']))
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    if (!exactKeys(entry.route, ['method', 'path'])) fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    const expected = expectedRoute(entry.route.method, entry.route.path);
    if (
      !Number.isInteger(entry.status) ||
      entry.status < 100 ||
      entry.status > 599 ||
      entry.status !== expected.status
    )
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    if (entry.jsonShape !== null && !validateShape(entry.jsonShape))
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    if (expected.path === '/' ? entry.jsonShape !== null : entry.jsonShape === null)
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    if (
      !entry.securityHeaders ||
      typeof entry.securityHeaders !== 'object' ||
      Array.isArray(entry.securityHeaders)
    )
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    const headerNames = Object.keys(entry.securityHeaders);
    if (!isSortedUnique(headerNames) || headerNames.some((name) => !SECURITY_HEADERS.has(name)))
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    for (const valueText of Object.values(entry.securityHeaders)) {
      if (
        typeof valueText !== 'string' ||
        valueText !== normalizeHeaderValue(valueText) ||
        !valueText ||
        forbiddenText(valueText)
      )
        fail('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
    }
    if (!Array.isArray(entry.uiLandmarks) || !isSortedUnique(entry.uiLandmarks))
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    if (
      entry.uiLandmarks.some(
        (landmark) => typeof landmark !== 'string' || !UI_LANDMARK_VALUES.has(landmark)
      )
    )
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    if (
      expected.path === '/'
        ? entry.uiLandmarks.length !== UI_LANDMARKS.length
        : entry.uiLandmarks.length !== 0
    )
      fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
    keys.push(`${entry.route.method} ${entry.route.path}`);
  }
  if (new Set(keys).size !== ROUTES.length) fail('PUBLIC_CONTRACT_SCHEMA_INVALID');
  const sorted = [...keys].sort();
  if (keys.some((key, index) => key !== sorted[index])) fail('PUBLIC_CONTRACT_NOT_CANONICAL');
  return value;
}

export function buildPublicContract(responses) {
  if (!Array.isArray(responses) || responses.length !== ROUTES.length)
    fail('PUBLIC_CONTRACT_RESPONSE_INVALID');
  const entries = responses
    .map(reduceResponse)
    .sort((left, right) =>
      `${left.route.method} ${left.route.path}`.localeCompare(
        `${right.route.method} ${right.route.path}`
      )
    );
  return validatePublicContract({ schemaVersion: 1, entries });
}

export function serializePublicContract(value) {
  validatePublicContract(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateCaptureBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('PUBLIC_CONTRACT_BASE_URL_INVALID');
  }
  if (
    parsed.href !== 'http://127.0.0.1:3101/' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    fail('PUBLIC_CONTRACT_BASE_URL_INVALID');
  return parsed.origin;
}

function cancelBestEffort(cancel) {
  try {
    void Promise.resolve(cancel()).catch(() => {});
  } catch {
    // Cancellation is advisory; the independent deadline/body cap remains authoritative.
  }
}

function cancelBodyBestEffort(response) {
  if (response.body && typeof response.body.cancel === 'function')
    cancelBestEffort(() => response.body.cancel());
}

async function readCappedBody(response, bodyCapBytes, deadline, controller) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > bodyCapBytes) {
    controller.abort();
    cancelBodyBestEffort(response);
    fail('PUBLIC_CONTRACT_BODY_TOO_LARGE');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > bodyCapBytes) {
        controller.abort();
        fail('PUBLIC_CONTRACT_BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } catch (error) {
    const abortedBeforeCleanup = controller.signal.aborted;
    if (!abortedBeforeCleanup) controller.abort();
    cancelBestEffort(() => reader.cancel());
    if (
      !(error instanceof Error && /^PUBLIC_CONTRACT_[A-Z_]+$/u.test(error.message)) &&
      !abortedBeforeCleanup
    )
      fail('PUBLIC_CONTRACT_CONTACT_FAILED');
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancellation already owns release of the pending read.
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export async function capturePublicContract({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2000,
  bodyCapBytes = 65_536,
  onContact = () => {}
}) {
  const origin = validateCaptureBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') fail('PUBLIC_CONTRACT_TRANSPORT_INVALID');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000)
    fail('PUBLIC_CONTRACT_TIMEOUT_INVALID');
  if (!Number.isInteger(bodyCapBytes) || bodyCapBytes < 16 || bodyCapBytes > 65_536)
    fail('PUBLIC_CONTRACT_BODY_CAP_INVALID');
  const entries = [];
  for (const expected of ROUTES) {
    const controller = new globalThis.AbortController();
    let rejectDeadline;
    const deadline = new Promise((_, reject) => {
      rejectDeadline = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectDeadline(new Error('PUBLIC_CONTRACT_CONTACT_TIMEOUT'));
    }, timeoutMs);
    try {
      const response = await Promise.race([
        Promise.resolve().then(() =>
          fetchImpl(new URL(expected.path, `${origin}/`), {
            method: expected.method,
            redirect: 'error',
            credentials: 'omit',
            headers: { accept: expected.path === '/' ? 'text/html' : 'application/json' },
            signal: controller.signal
          })
        ),
        deadline
      ]);
      if (response.status !== expected.status) {
        controller.abort();
        cancelBodyBestEffort(response);
        fail('PUBLIC_CONTRACT_STATUS_MISMATCH');
      }
      const body = await readCappedBody(response, bodyCapBytes, deadline, controller);
      const entry = reduceResponse({
        method: expected.method,
        route: expected.path,
        status: response.status,
        headers: response.headers,
        body
      });
      entries.push(entry);
      onContact({
        method: expected.method,
        route: expected.path,
        expectedPort: 3101,
        timeoutMs,
        bodyCapBytes,
        status: response.status,
        sanitizedFields: ['route', 'status', 'jsonShape', 'securityHeaders', 'uiLandmarks']
      });
    } catch (error) {
      if (error instanceof Error && /^PUBLIC_CONTRACT_[A-Z_]+$/u.test(error.message)) throw error;
      if (controller.signal.aborted) fail('PUBLIC_CONTRACT_CONTACT_TIMEOUT');
      fail('PUBLIC_CONTRACT_CONTACT_FAILED');
    } finally {
      clearTimeout(timeout);
    }
  }
  entries.sort((left, right) =>
    `${left.route.method} ${left.route.path}`.localeCompare(
      `${right.route.method} ${right.route.path}`
    )
  );
  return validatePublicContract({ schemaVersion: 1, entries });
}

function parseArguments(argv) {
  const result = { capture: false, fixture: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--capture') result.capture = true;
    else if (argument === '--fixture' && argv[index + 1]) result.fixture = argv[++index];
    else if (argument === '--output' && argv[index + 1]) result.output = argv[++index];
    else fail('PUBLIC_CONTRACT_USAGE');
  }
  if (result.capture === Boolean(result.fixture)) fail('PUBLIC_CONTRACT_USAGE');
  return result;
}

async function main(argv) {
  const argumentsValue = parseArguments(argv);
  let contract;
  if (argumentsValue.fixture) {
    let fixture;
    try {
      fixture = JSON.parse(await readFile(argumentsValue.fixture, 'utf8'));
    } catch {
      fail('PUBLIC_CONTRACT_FIXTURE_INVALID');
    }
    contract = buildPublicContract(fixture.responses);
  } else {
    contract = await capturePublicContract({
      baseUrl: 'http://127.0.0.1:3101',
      timeoutMs: 2000,
      bodyCapBytes: 65_536,
      onContact: (contact) => {
        process.stderr.write(
          `PUBLIC_CONTRACT_CONTACT method=${contact.method} route=${contact.route} expected_port=${contact.expectedPort} timeout_ms=${contact.timeoutMs} body_cap_bytes=${contact.bodyCapBytes} status=${contact.status} sanitized_fields=${contact.sanitizedFields.join(',')}\n`
        );
      }
    });
  }
  const serialized = serializePublicContract(contract);
  if (argumentsValue.output) {
    const temporary = `${argumentsValue.output}.tmp-${process.pid}`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o644);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await link(temporary, argumentsValue.output);
    } catch {
      fail('PUBLIC_CONTRACT_OUTPUT_FAILED');
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  } else process.stdout.write(serialized);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main(process.argv.slice(2)).catch((error) => {
    const code =
      error instanceof Error && /^PUBLIC_CONTRACT_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'PUBLIC_CONTRACT_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
