/**
 * FastCGI Protocol Handler
 * Implements the FastCGI binary protocol for high-performance CGI
 * Reference: https://fastcgi-archives.github.io/FastCGI_Specification.html
 */

import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { parseCGIEnv, parseBody } from './cgi.js';

// FastCGI Record Types
const FCGI_BEGIN_REQUEST = 1;
const FCGI_ABORT_REQUEST = 2;
const FCGI_END_REQUEST = 3;
const FCGI_PARAMS = 4;
const FCGI_STDIN = 5;
const FCGI_STDOUT = 6;
const _FCGI_STDERR = 7; // Reserved for future use
const _FCGI_DATA = 8; // Reserved for future use
const FCGI_GET_VALUES = 9;
const FCGI_GET_VALUES_RESULT = 10;

// FastCGI Roles (used in protocol parsing)
const _FCGI_RESPONDER = 1;
const _FCGI_AUTHORIZER = 2;
const _FCGI_FILTER = 3;

// Protocol status
const FCGI_REQUEST_COMPLETE = 0;
const _FCGI_CANT_MPX_CONN = 1;
const _FCGI_OVERLOADED = 2;
const _FCGI_UNKNOWN_ROLE = 3;

// Header size
const FCGI_HEADER_LEN = 8;
const FCGI_VERSION_1 = 1;

/**
 * Parse FastCGI record header
 */
function parseHeader(buffer) {
  if (buffer.length < FCGI_HEADER_LEN) {
    return null;
  }

  return {
    version: buffer.readUInt8(0),
    type: buffer.readUInt8(1),
    requestId: buffer.readUInt16BE(2),
    contentLength: buffer.readUInt16BE(4),
    paddingLength: buffer.readUInt8(6),
    reserved: buffer.readUInt8(7),
  };
}

/**
 * Build FastCGI record header
 */
function buildHeader(type, requestId, contentLength, paddingLength = 0) {
  const header = Buffer.alloc(FCGI_HEADER_LEN);
  header.writeUInt8(FCGI_VERSION_1, 0);
  header.writeUInt8(type, 1);
  header.writeUInt16BE(requestId, 2);
  header.writeUInt16BE(contentLength, 4);
  header.writeUInt8(paddingLength, 6);
  header.writeUInt8(0, 7); // reserved
  return header;
}

/**
 * Build FastCGI end request record
 */
function buildEndRequest(requestId, appStatus = 0, protocolStatus = FCGI_REQUEST_COMPLETE) {
  const header = buildHeader(FCGI_END_REQUEST, requestId, 8);
  const body = Buffer.alloc(8);
  body.writeUInt32BE(appStatus, 0);
  body.writeUInt8(protocolStatus, 4);
  // bytes 5-7 are reserved
  return Buffer.concat([header, body]);
}

/**
 * Build FastCGI stdout/stderr record
 */
function buildStreamRecord(type, requestId, data) {
  const chunks = [];
  const maxChunkSize = 65535; // Max content length per record

  let offset = 0;
  while (offset < data.length) {
    const chunkSize = Math.min(maxChunkSize, data.length - offset);
    const chunk = data.slice(offset, offset + chunkSize);

    // Calculate padding to align to 8 bytes
    const paddingLength = (8 - (chunkSize % 8)) % 8;
    const padding = Buffer.alloc(paddingLength);

    const header = buildHeader(type, requestId, chunkSize, paddingLength);
    chunks.push(header, chunk, padding);

    offset += chunkSize;
  }

  return Buffer.concat(chunks);
}

/**
 * Parse FastCGI name-value pairs (PARAMS)
 */
function parseNameValuePairs(buffer) {
  const params = {};
  let offset = 0;

  while (offset < buffer.length) {
    // Read name length
    let nameLength = buffer.readUInt8(offset);
    offset += 1;
    if (nameLength >> 7 === 1) {
      // High bit set - 4 byte length
      offset -= 1;
      nameLength = buffer.readUInt32BE(offset) & 0x7fffffff;
      offset += 4;
    }

    // Read value length
    let valueLength = buffer.readUInt8(offset);
    offset += 1;
    if (valueLength >> 7 === 1) {
      offset -= 1;
      valueLength = buffer.readUInt32BE(offset) & 0x7fffffff;
      offset += 4;
    }

    // Read name and value
    const name = buffer.slice(offset, offset + nameLength).toString('utf8');
    offset += nameLength;
    const value = buffer.slice(offset, offset + valueLength).toString('utf8');
    offset += valueLength;

    params[name] = value;
  }

  return params;
}

/**
 * FastCGI Request object - accumulates data for a single request
 */
class FCGIRequest {
  constructor(requestId, role, keepConn) {
    this.requestId = requestId;
    this.role = role;
    this.keepConn = keepConn;
    this.params = {};
    this.paramsComplete = false;
    this.stdin = [];
    this.stdinComplete = false;
    this.data = [];
    this.dataComplete = false;
  }

  addParams(buffer) {
    if (buffer.length === 0) {
      this.paramsComplete = true;
    } else {
      Object.assign(this.params, parseNameValuePairs(buffer));
    }
  }

  addStdin(buffer) {
    if (buffer.length === 0) {
      this.stdinComplete = true;
    } else {
      this.stdin.push(buffer);
    }
  }

  getStdinBuffer() {
    return Buffer.concat(this.stdin);
  }

  isReady() {
    return this.paramsComplete && this.stdinComplete;
  }
}

/**
 * FastCGI Response writer
 */
export class FCGIResponse {
  constructor(socket, requestId) {
    this.socket = socket;
    this.requestId = requestId;
    this._statusCode = 200;
    this._headers = {
      'Content-Type': 'text/html; charset=utf-8',
    };
    this._headersSent = false;
    this._finished = false;
    this._cookies = [];
    this._buffer = [];
  }

  status(code) {
    this._statusCode = code;
    return this;
  }

  get statusCode() {
    return this._statusCode;
  }

  set(name, value) {
    if (typeof name === 'object') {
      Object.assign(this._headers, name);
    } else {
      this._headers[name] = value;
    }
    return this;
  }

  header(name, value) {
    return this.set(name, value);
  }

  type(contentType) {
    const types = {
      html: 'text/html; charset=utf-8',
      text: 'text/plain; charset=utf-8',
      json: 'application/json; charset=utf-8',
    };
    return this.set('Content-Type', types[contentType] || contentType);
  }

  cookie(name, value, options = {}) {
    let cookieStr = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    if (options.maxAge) {
      cookieStr += `; Max-Age=${options.maxAge}`;
    }
    if (options.path) {
      cookieStr += `; Path=${options.path}`;
    }
    if (options.domain) {
      cookieStr += `; Domain=${options.domain}`;
    }
    if (options.secure) {
      cookieStr += '; Secure';
    }
    if (options.httpOnly) {
      cookieStr += '; HttpOnly';
    }
    if (options.sameSite) {
      cookieStr += `; SameSite=${options.sameSite}`;
    }
    this._cookies.push(cookieStr);
    return this;
  }

  _buildHeaders() {
    const STATUS_MESSAGES = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
      404: 'Not Found', 500: 'Internal Server Error',
    };

    let headerStr = `Status: ${this._statusCode} ${STATUS_MESSAGES[this._statusCode] || 'Unknown'}\r\n`;

    for (const [name, value] of Object.entries(this._headers)) {
      headerStr += `${name}: ${value}\r\n`;
    }

    for (const cookie of this._cookies) {
      headerStr += `Set-Cookie: ${cookie}\r\n`;
    }

    headerStr += '\r\n';
    return Buffer.from(headerStr);
  }

  write(chunk) {
    if (!this._headersSent) {
      this._buffer.push(this._buildHeaders());
      this._headersSent = true;
    }

    if (typeof chunk === 'string') {
      this._buffer.push(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      this._buffer.push(chunk);
    }

    return this;
  }

  end(data) {
    if (this._finished) {
      return this;
    }

    if (data !== undefined) {
      this.write(data);
    } else if (!this._headersSent) {
      this._buffer.push(this._buildHeaders());
      this._headersSent = true;
    }

    // Send all buffered data as STDOUT records
    const fullBody = Buffer.concat(this._buffer);
    if (fullBody.length > 0) {
      const stdoutRecords = buildStreamRecord(FCGI_STDOUT, this.requestId, fullBody);
      this.socket.write(stdoutRecords);
    }

    // Send empty STDOUT to signal end
    const emptyStdout = buildHeader(FCGI_STDOUT, this.requestId, 0);
    this.socket.write(emptyStdout);

    // Send END_REQUEST
    const endRequest = buildEndRequest(this.requestId, 0, FCGI_REQUEST_COMPLETE);
    this.socket.write(endRequest);

    this._finished = true;
    return this;
  }

  send(body) {
    if (typeof body === 'object' && !Buffer.isBuffer(body)) {
      return this.json(body);
    }
    return this.end(body);
  }

  json(data) {
    this.type('json');
    return this.end(JSON.stringify(data));
  }

  redirect(url, statusCode = 302) {
    this.status(statusCode);
    this.set('Location', url);
    return this.end();
  }
}

/**
 * FastCGI Server
 */
export class FastCGIServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      maxConns: options.maxConns || 100,
      maxReqs: options.maxReqs || 100,
      ...options,
    };
    this.server = null;
    this.connections = new Set();
  }

  /**
   * Start listening on a port or socket
   */
  listen(portOrPath, callback) {
    this.server = createServer((socket) => this._handleConnection(socket));

    this.server.listen(portOrPath, () => {
      this.emit('listening', portOrPath);
      if (callback) {
        callback();
      }
    });

    this.server.on('error', (err) => this.emit('error', err));

    return this;
  }

  /**
   * Handle new connection
   */
  _handleConnection(socket) {
    this.connections.add(socket);
    const requests = new Map();
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= FCGI_HEADER_LEN) {
        const header = parseHeader(buffer);
        if (!header) {
          break;
        }

        const totalLength = FCGI_HEADER_LEN + header.contentLength + header.paddingLength;
        if (buffer.length < totalLength) {
          break;
        }

        const content = buffer.slice(FCGI_HEADER_LEN, FCGI_HEADER_LEN + header.contentLength);
        buffer = buffer.slice(totalLength);

        this._processRecord(socket, requests, header, content);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      requests.clear();
    });

    socket.on('error', (err) => {
      this.emit('error', err);
      socket.destroy();
    });
  }

  /**
   * Process a single FastCGI record
   */
  _processRecord(socket, requests, header, content) {
    const { type, requestId } = header;

    switch (type) {
    case FCGI_BEGIN_REQUEST: {
      const role = content.readUInt16BE(0);
      const flags = content.readUInt8(2);
      const keepConn = (flags & 1) !== 0;
      requests.set(requestId, new FCGIRequest(requestId, role, keepConn));
      break;
    }

    case FCGI_PARAMS: {
      const req = requests.get(requestId);
      if (req) {
        req.addParams(content);
      }
      this._tryHandleRequest(socket, requests, requestId);
      break;
    }

    case FCGI_STDIN: {
      const req = requests.get(requestId);
      if (req) {
        req.addStdin(content);
      }
      this._tryHandleRequest(socket, requests, requestId);
      break;
    }

    case FCGI_ABORT_REQUEST: {
      requests.delete(requestId);
      break;
    }

    case FCGI_GET_VALUES: {
      // Respond with server capabilities
      const response = this._buildGetValuesResult(requestId, content);
      socket.write(response);
      break;
    }
    }
  }

  /**
   * Try to handle request if all data received
   */
  _tryHandleRequest(socket, requests, requestId) {
    const fcgiReq = requests.get(requestId);
    if (!fcgiReq || !fcgiReq.isReady()) {
      return;
    }

    requests.delete(requestId);

    // Build request object similar to CGI
    const request = parseCGIEnv(fcgiReq.params);

    // Parse body
    const stdinBuffer = fcgiReq.getStdinBuffer();
    if (stdinBuffer.length > 0) {
      const { raw, parsed } = parseBody(stdinBuffer, request.contentType);
      request.rawBody = raw;
      request.body = parsed;
    } else {
      request.rawBody = Buffer.alloc(0);
      request.body = null;
    }

    // Create response object
    const response = new FCGIResponse(socket, requestId);

    // Emit request event
    this.emit('request', request, response);
  }

  /**
   * Build GET_VALUES_RESULT response
   */
  _buildGetValuesResult(requestId, content) {
    const params = parseNameValuePairs(content);
    const results = {};

    if ('FCGI_MAX_CONNS' in params) {
      results.FCGI_MAX_CONNS = String(this.options.maxConns);
    }
    if ('FCGI_MAX_REQS' in params) {
      results.FCGI_MAX_REQS = String(this.options.maxReqs);
    }
    if ('FCGI_MPXS_CONNS' in params) {
      results.FCGI_MPXS_CONNS = '1'; // We support multiplexing
    }

    // Build name-value pairs
    let resultBuffer = Buffer.alloc(0);
    for (const [name, value] of Object.entries(results)) {
      const nameLen = Buffer.byteLength(name);
      const valueLen = Buffer.byteLength(value);
      const pair = Buffer.alloc(2 + nameLen + valueLen);
      pair.writeUInt8(nameLen, 0);
      pair.writeUInt8(valueLen, 1);
      pair.write(name, 2);
      pair.write(value, 2 + nameLen);
      resultBuffer = Buffer.concat([resultBuffer, pair]);
    }

    const header = buildHeader(FCGI_GET_VALUES_RESULT, 0, resultBuffer.length);
    return Buffer.concat([header, resultBuffer]);
  }

  /**
   * Close the server
   */
  close(callback) {
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    if (this.server) {
      this.server.close(callback);
    } else if (callback) {
      callback();
    }
  }
}

/**
 * Create a new FastCGI server
 */
export function createFastCGIServer(options) {
  return new FastCGIServer(options);
}

export default {
  FastCGIServer,
  FCGIResponse,
  createFastCGIServer,
};
