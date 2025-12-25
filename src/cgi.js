/**
 * CGI Protocol Handler
 * Parses CGI environment variables and stdin to construct request data
 * Similar to how PHP-CGI receives request information
 */

import { Buffer } from 'node:buffer';

/**
 * Standard CGI environment variables mapping
 */
const CGI_ENV_VARS = {
  // Request metadata
  REQUEST_METHOD: 'method',
  REQUEST_URI: 'uri',
  QUERY_STRING: 'queryString',
  SCRIPT_NAME: 'scriptName',
  SCRIPT_FILENAME: 'scriptFilename',
  PATH_INFO: 'pathInfo',
  PATH_TRANSLATED: 'pathTranslated',

  // Content
  CONTENT_TYPE: 'contentType',
  CONTENT_LENGTH: 'contentLength',

  // Server info
  SERVER_NAME: 'serverName',
  SERVER_PORT: 'serverPort',
  SERVER_PROTOCOL: 'protocol',
  SERVER_SOFTWARE: 'serverSoftware',

  // Client info
  REMOTE_ADDR: 'remoteAddr',
  REMOTE_PORT: 'remotePort',
  REMOTE_HOST: 'remoteHost',

  // Auth
  AUTH_TYPE: 'authType',
  REMOTE_USER: 'remoteUser',
  REMOTE_IDENT: 'remoteIdent',

  // HTTPS
  HTTPS: 'https',

  // Gateway
  GATEWAY_INTERFACE: 'gatewayInterface',
  DOCUMENT_ROOT: 'documentRoot',
};

/**
 * Parse HTTP headers from CGI environment variables
 * HTTP headers are passed as HTTP_* environment variables
 */
export function parseHeaders(env) {
  const headers = {};

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('HTTP_')) {
      // Convert HTTP_CONTENT_TYPE to content-type
      const headerName = key
        .slice(5)
        .toLowerCase()
        .replace(/_/g, '-');
      headers[headerName] = value;
    }
  }

  // Content-Type and Content-Length are special - not prefixed with HTTP_
  if (env.CONTENT_TYPE) {
    headers['content-type'] = env.CONTENT_TYPE;
  }
  if (env.CONTENT_LENGTH) {
    headers['content-length'] = env.CONTENT_LENGTH;
  }

  return headers;
}

/**
 * Parse query string into object
 */
export function parseQueryString(queryString) {
  if (!queryString) {
    return {};
  }

  const params = new URLSearchParams(queryString);
  const result = {};

  for (const [key, value] of params) {
    // Handle array notation like foo[]=bar
    if (key.endsWith('[]')) {
      const arrayKey = key.slice(0, -2);
      if (!result[arrayKey]) {
        result[arrayKey] = [];
      }
      result[arrayKey].push(value);
    } else if (result[key] !== undefined) {
      // Convert to array if duplicate key
      if (!Array.isArray(result[key])) {
        result[key] = [result[key]];
      }
      result[key].push(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Parse cookies from Cookie header
 */
export function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  const cookies = {};
  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      cookies[name.trim()] = decodeURIComponent(rest.join('='));
    }
  }

  return cookies;
}

/**
 * Read request body from stdin using async iteration
 */
export async function readBody(stdin, contentLength) {
  const chunks = [];
  let bytesRead = 0;
  const maxBytes = contentLength ? parseInt(contentLength, 10) : Infinity;

  try {
    for await (const chunk of stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += buffer.length;

      if (bytesRead <= maxBytes) {
        chunks.push(buffer);
      } else {
        // Trim to exact content length
        const excess = bytesRead - maxBytes;
        chunks.push(buffer.slice(0, buffer.length - excess));
        break;
      }
    }
  } catch (err) {
    // Handle stream errors
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      throw err;
    }
  }

  return Buffer.concat(chunks);
}

/**
 * Parse request body based on content type
 */
export function parseBody(body, contentType) {
  if (!body || body.length === 0) {
    return { raw: body, parsed: null };
  }

  const bodyStr = body.toString('utf8');

  if (!contentType) {
    return { raw: body, parsed: bodyStr };
  }

  const type = contentType.toLowerCase().split(';')[0].trim();

  switch (type) {
  case 'application/json':
    try {
      return { raw: body, parsed: JSON.parse(bodyStr) };
    } catch {
      return { raw: body, parsed: bodyStr };
    }

  case 'application/x-www-form-urlencoded':
    return { raw: body, parsed: parseQueryString(bodyStr) };

  case 'text/plain':
  case 'text/html':
  case 'text/xml':
  case 'application/xml':
    return { raw: body, parsed: bodyStr };

  default:
    // Return raw buffer for binary types
    return { raw: body, parsed: null };
  }
}

/**
 * Parse CGI environment into structured request object
 */
export function parseCGIEnv(env) {
  const request = {};

  // Map standard CGI variables
  for (const [envKey, propKey] of Object.entries(CGI_ENV_VARS)) {
    if (env[envKey] !== undefined) {
      request[propKey] = env[envKey];
    }
  }

  // Parse headers
  request.headers = parseHeaders(env);

  // Parse query string
  request.query = parseQueryString(request.queryString || '');

  // Parse cookies
  request.cookies = parseCookies(request.headers.cookie);

  // Build full URL
  const protocol = request.https === 'on' ? 'https' : 'http';
  const host = request.headers.host || request.serverName || 'localhost';
  const path = request.uri || request.scriptName || '/';

  request.url = `${protocol}://${host}${path}`;
  request.path = path.split('?')[0];

  // Normalize method
  request.method = (request.method || 'GET').toUpperCase();

  return request;
}

/**
 * Create full request object from CGI environment and stdin
 */
export async function createRequest(env = process.env, stdin = process.stdin) {
  const request = parseCGIEnv(env);

  // Read and parse body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const rawBody = await readBody(stdin, request.contentLength);
    const { raw, parsed } = parseBody(rawBody, request.contentType);
    request.rawBody = raw;
    request.body = parsed;
  } else {
    request.rawBody = Buffer.alloc(0);
    request.body = null;
  }

  return request;
}

export default {
  parseCGIEnv,
  parseHeaders,
  parseQueryString,
  parseCookies,
  parseBody,
  readBody,
  createRequest,
};
