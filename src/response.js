/**
 * CGI Response Handler
 * Provides an Express-like API for writing CGI responses
 */

import { Buffer } from 'node:buffer';

/**
 * HTTP Status code messages
 */
const STATUS_MESSAGES = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export class Response {
  constructor(stdout = process.stdout) {
    this.stdout = stdout;
    this._statusCode = 200;
    this._headers = {
      'Content-Type': 'text/html; charset=utf-8',
    };
    this._headersSent = false;
    this._finished = false;
    this._cookies = [];
  }

  /**
   * Get/set status code
   */
  status(code) {
    if (this._headersSent) {
      throw new Error('Cannot set status after headers sent');
    }
    this._statusCode = code;
    return this;
  }

  get statusCode() {
    return this._statusCode;
  }

  set statusCode(code) {
    this.status(code);
  }

  get headersSent() {
    return this._headersSent;
  }

  /**
   * Set a header
   */
  set(name, value) {
    if (this._headersSent) {
      throw new Error('Cannot set headers after they are sent');
    }

    if (typeof name === 'object') {
      // set({ 'Content-Type': 'text/html', ... })
      for (const [key, val] of Object.entries(name)) {
        this._headers[key] = val;
      }
    } else {
      this._headers[name] = value;
    }

    return this;
  }

  // Alias for set
  header(name, value) {
    return this.set(name, value);
  }

  setHeader(name, value) {
    return this.set(name, value);
  }

  /**
   * Get a header value
   */
  get(name) {
    return this._headers[name];
  }

  getHeader(name) {
    return this.get(name);
  }

  /**
   * Remove a header
   */
  removeHeader(name) {
    delete this._headers[name];
    return this;
  }

  /**
   * Set Content-Type header
   */
  type(contentType) {
    // Handle shorthand types
    const types = {
      html: 'text/html; charset=utf-8',
      text: 'text/plain; charset=utf-8',
      json: 'application/json; charset=utf-8',
      xml: 'application/xml; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'application/javascript; charset=utf-8',
    };

    return this.set('Content-Type', types[contentType] || contentType);
  }

  /**
   * Set a cookie
   */
  cookie(name, value, options = {}) {
    if (this._headersSent) {
      throw new Error('Cannot set cookie after headers sent');
    }

    let cookieStr = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

    if (options.maxAge) {
      cookieStr += `; Max-Age=${options.maxAge}`;
    }
    if (options.expires) {
      cookieStr += `; Expires=${options.expires.toUTCString()}`;
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

  /**
   * Clear a cookie
   */
  clearCookie(name, options = {}) {
    return this.cookie(name, '', {
      ...options,
      expires: new Date(0),
    });
  }

  /**
   * Write CGI headers to stdout
   */
  _writeHeaders() {
    if (this._headersSent) {
      return;
    }

    // CGI uses "Status:" header instead of HTTP status line
    const statusMessage = STATUS_MESSAGES[this._statusCode] || 'Unknown';
    this.stdout.write(`Status: ${this._statusCode} ${statusMessage}\r\n`);

    // Write all headers
    for (const [name, value] of Object.entries(this._headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          this.stdout.write(`${name}: ${v}\r\n`);
        }
      } else {
        this.stdout.write(`${name}: ${value}\r\n`);
      }
    }

    // Write cookies
    for (const cookie of this._cookies) {
      this.stdout.write(`Set-Cookie: ${cookie}\r\n`);
    }

    // End headers
    this.stdout.write('\r\n');
    this._headersSent = true;
  }

  /**
   * Write data to response body
   */
  write(chunk) {
    if (this._finished) {
      throw new Error('Cannot write after response finished');
    }

    this._writeHeaders();

    if (typeof chunk === 'string') {
      this.stdout.write(chunk);
    } else if (Buffer.isBuffer(chunk)) {
      this.stdout.write(chunk);
    } else {
      this.stdout.write(String(chunk));
    }

    return this;
  }

  /**
   * End the response
   */
  end(data) {
    if (this._finished) {
      return this;
    }

    if (data !== undefined) {
      this.write(data);
    } else {
      this._writeHeaders();
    }

    this._finished = true;
    return this;
  }

  /**
   * Send a response (like Express res.send)
   */
  send(body) {
    if (body === undefined || body === null) {
      return this.end();
    }

    if (typeof body === 'string') {
      if (!this._headers['Content-Type']) {
        this.type('html');
      }
      return this.end(body);
    }

    if (Buffer.isBuffer(body)) {
      if (!this._headers['Content-Type']) {
        this.type('application/octet-stream');
      }
      return this.end(body);
    }

    // Object or array - send as JSON
    return this.json(body);
  }

  /**
   * Send JSON response
   */
  json(data) {
    this.type('json');
    const body = JSON.stringify(data);
    this.set('Content-Length', Buffer.byteLength(body));
    return this.end(body);
  }

  /**
   * Send file (basic implementation)
   */
  async sendFile(filePath) {
    const { createReadStream, stat } = await import('node:fs');
    const { promisify } = await import('node:util');
    const path = await import('node:path');
    const statAsync = promisify(stat);

    try {
      const stats = await statAsync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      // Simple mime type mapping
      const mimeTypes = {
        '.html': 'text/html',
        '.htm': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
      };

      this.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      this.set('Content-Length', stats.size);
      this._writeHeaders();

      return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.pipe(this.stdout, { end: false });
        stream.on('end', () => {
          this._finished = true;
          resolve(this);
        });
        stream.on('error', reject);
      });
    } catch (_err) {
      this.status(404).send('File not found');
      return this;
    }
  }

  /**
   * Redirect to URL
   */
  redirect(url, statusCode = 302) {
    this.status(statusCode);
    this.set('Location', url);
    return this.end();
  }
}

/**
 * Create a new response object
 */
export function createResponse(stdout = process.stdout) {
  return new Response(stdout);
}

export default {
  Response,
  createResponse,
};
