/**
 * FastCGI Module Tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';
import { FastCGIServer, FCGIResponse, createFastCGIServer } from '../src/fastcgi.js';

// FastCGI constants for testing
const FCGI_VERSION_1 = 1;
const FCGI_BEGIN_REQUEST = 1;
const FCGI_END_REQUEST = 3;
const FCGI_PARAMS = 4;
const FCGI_STDIN = 5;
const FCGI_STDOUT = 6;
const FCGI_RESPONDER = 1;

/**
 * Build a FastCGI header
 */
function buildHeader(type, requestId, contentLength, paddingLength = 0) {
  const header = Buffer.alloc(8);
  header.writeUInt8(FCGI_VERSION_1, 0);
  header.writeUInt8(type, 1);
  header.writeUInt16BE(requestId, 2);
  header.writeUInt16BE(contentLength, 4);
  header.writeUInt8(paddingLength, 6);
  header.writeUInt8(0, 7);
  return header;
}

/**
 * Build FCGI_BEGIN_REQUEST record
 */
function buildBeginRequest(requestId, role = FCGI_RESPONDER, keepConn = false) {
  const header = buildHeader(FCGI_BEGIN_REQUEST, requestId, 8);
  const body = Buffer.alloc(8);
  body.writeUInt16BE(role, 0);
  body.writeUInt8(keepConn ? 1 : 0, 2);
  return Buffer.concat([header, body]);
}

/**
 * Build FCGI_PARAMS record with name-value pairs
 */
function buildParams(requestId, params) {
  if (Object.keys(params).length === 0) {
    // Empty params record signals end of params
    return buildHeader(FCGI_PARAMS, requestId, 0);
  }

  const pairs = [];
  for (const [name, value] of Object.entries(params)) {
    const nameLen = Buffer.byteLength(name);
    const valueLen = Buffer.byteLength(value);

    // Simple encoding (lengths < 128)
    const pair = Buffer.alloc(2 + nameLen + valueLen);
    pair.writeUInt8(nameLen, 0);
    pair.writeUInt8(valueLen, 1);
    pair.write(name, 2);
    pair.write(value, 2 + nameLen);
    pairs.push(pair);
  }

  const content = Buffer.concat(pairs);
  const header = buildHeader(FCGI_PARAMS, requestId, content.length);
  return Buffer.concat([header, content]);
}

/**
 * Build FCGI_STDIN record
 */
function buildStdin(requestId, data = '') {
  const content = Buffer.from(data);
  const header = buildHeader(FCGI_STDIN, requestId, content.length);
  return Buffer.concat([header, content]);
}

/**
 * Create a mock socket for testing
 */
function createMockSocket() {
  const written = [];
  const socket = new Writable({
    write(chunk, encoding, callback) {
      written.push(chunk);
      callback();
    },
  });
  socket.getWritten = () => Buffer.concat(written);
  socket.destroy = () => {};
  return socket;
}

describe('FCGIResponse', () => {
  let socket;
  let res;

  beforeEach(() => {
    socket = createMockSocket();
    res = new FCGIResponse(socket, 1);
  });

  describe('status()', () => {
    it('should set status code', () => {
      res.status(404);
      assert.strictEqual(res.statusCode, 404);
    });

    it('should be chainable', () => {
      const result = res.status(201);
      assert.strictEqual(result, res);
    });
  });

  describe('set() / header()', () => {
    it('should set headers', () => {
      res.set('X-Custom', 'value');
      assert.strictEqual(res._headers['X-Custom'], 'value');
    });

    it('should set multiple headers from object', () => {
      res.set({ 'X-One': '1', 'X-Two': '2' });
      assert.strictEqual(res._headers['X-One'], '1');
      assert.strictEqual(res._headers['X-Two'], '2');
    });
  });

  describe('type()', () => {
    it('should set Content-Type for shorthand', () => {
      res.type('json');
      assert.strictEqual(res._headers['Content-Type'], 'application/json; charset=utf-8');
    });
  });

  describe('cookie()', () => {
    it('should add cookie to list', () => {
      res.cookie('session', 'abc123');
      assert.strictEqual(res._cookies.length, 1);
      assert.ok(res._cookies[0].includes('session=abc123'));
    });

    it('should handle cookie options', () => {
      res.cookie('token', 'xyz', { httpOnly: true, secure: true });
      assert.ok(res._cookies[0].includes('HttpOnly'));
      assert.ok(res._cookies[0].includes('Secure'));
    });
  });

  describe('write()', () => {
    it('should buffer content', () => {
      res.write('Hello');
      res.write(' World');
      assert.strictEqual(res._buffer.length, 3); // headers + 2 writes
    });

    it('should add headers on first write', () => {
      res.write('test');
      assert.strictEqual(res._headersSent, true);
    });
  });

  describe('end()', () => {
    it('should send STDOUT records', () => {
      res.end('Hello');
      const written = socket.getWritten();

      // Should contain FCGI_STDOUT records
      assert.ok(written.length > 0);
    });

    it('should send END_REQUEST record', () => {
      res.end();
      const written = socket.getWritten();

      // Last 16 bytes should be empty STDOUT (8) + END_REQUEST (8+8)
      // Check for END_REQUEST type (3)
      let foundEndRequest = false;
      for (let i = 0; i < written.length - 7; i++) {
        if (written[i] === 1 && written[i + 1] === FCGI_END_REQUEST) {
          foundEndRequest = true;
          break;
        }
      }
      assert.ok(foundEndRequest, 'Should contain END_REQUEST record');
    });

    it('should mark response as finished', () => {
      res.end();
      assert.strictEqual(res._finished, true);
    });

    it('should be idempotent', () => {
      res.end('First');
      const len1 = socket.getWritten().length;
      res.end('Second');
      const len2 = socket.getWritten().length;

      assert.strictEqual(len1, len2);
    });
  });

  describe('send()', () => {
    it('should send string content', () => {
      res.send('Hello');
      assert.strictEqual(res._finished, true);
    });

    it('should send object as JSON', () => {
      res.send({ test: true });
      assert.strictEqual(res._headers['Content-Type'], 'application/json; charset=utf-8');
    });
  });

  describe('json()', () => {
    it('should set JSON content type', () => {
      res.json({ data: 123 });
      assert.strictEqual(res._headers['Content-Type'], 'application/json; charset=utf-8');
    });
  });

  describe('redirect()', () => {
    it('should set location header and status', () => {
      res.redirect('/new-path');
      assert.strictEqual(res._statusCode, 302);
      assert.strictEqual(res._headers['Location'], '/new-path');
    });

    it('should support custom status code', () => {
      res.redirect('/permanent', 301);
      assert.strictEqual(res._statusCode, 301);
    });
  });
});

describe('FastCGIServer', () => {
  let server;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  describe('constructor', () => {
    it('should create server with default options', () => {
      server = new FastCGIServer();
      assert.strictEqual(server.options.maxConns, 100);
      assert.strictEqual(server.options.maxReqs, 100);
    });

    it('should accept custom options', () => {
      server = new FastCGIServer({ maxConns: 50, maxReqs: 200 });
      assert.strictEqual(server.options.maxConns, 50);
      assert.strictEqual(server.options.maxReqs, 200);
    });
  });

  describe('listen()', () => {
    it('should start listening on port', (_, done) => {
      server = new FastCGIServer();

      server.on('listening', (port) => {
        assert.strictEqual(port, 19001);
        done();
      });

      server.listen(19001);
    });

    it('should emit error on already-used port', async () => {
      // First server takes the port
      const server1 = new FastCGIServer();
      await new Promise(resolve => server1.listen(19010, resolve));

      // Second server should fail
      server = new FastCGIServer();
      let errorEmitted = false;

      server.on('error', (err) => {
        errorEmitted = true;
        assert.ok(err.code === 'EADDRINUSE');
      });

      server.listen(19010);

      // Wait for error to be emitted
      await new Promise(r => setTimeout(r, 100));
      server1.close();
      assert.strictEqual(errorEmitted, true);
    });
  });

  describe('request handling', () => {
    it('should emit request event with parsed request', (_, done) => {
      server = new FastCGIServer();

      server.on('request', (req, res) => {
        assert.strictEqual(req.method, 'GET');
        assert.strictEqual(req.uri, '/test');
        assert.ok(res instanceof FCGIResponse);
        res.end();
        done();
      });

      server.listen(19002, () => {
        // Simulate client connection
        const client = new Socket();
        client.connect(19002, '127.0.0.1', () => {
          // Send BEGIN_REQUEST
          client.write(buildBeginRequest(1));

          // Send PARAMS
          client.write(buildParams(1, {
            REQUEST_METHOD: 'GET',
            REQUEST_URI: '/test',
            HTTP_HOST: 'localhost',
          }));
          client.write(buildParams(1, {})); // Empty params = end

          // Send empty STDIN
          client.write(buildStdin(1, ''));
        });
      });
    });

    it('should parse POST body', (_, done) => {
      server = new FastCGIServer();

      server.on('request', (req, res) => {
        assert.strictEqual(req.method, 'POST');
        assert.deepStrictEqual(req.body, { name: 'John' });
        res.end();
        done();
      });

      server.listen(19003, () => {
        const client = new Socket();
        client.connect(19003, '127.0.0.1', () => {
          const body = '{"name":"John"}';

          client.write(buildBeginRequest(1));
          client.write(buildParams(1, {
            REQUEST_METHOD: 'POST',
            CONTENT_TYPE: 'application/json',
            CONTENT_LENGTH: String(body.length),
          }));
          client.write(buildParams(1, {}));
          client.write(buildStdin(1, body));
          client.write(buildStdin(1, '')); // Empty stdin = end
        });
      });
    });
  });

  describe('close()', () => {
    it('should close server', (_, done) => {
      server = new FastCGIServer();

      server.listen(19004, () => {
        server.close(() => {
          server = null;
          done();
        });
      });
    });

    it('should close all connections', (_, done) => {
      server = new FastCGIServer();

      server.listen(19005, () => {
        // Create a connection
        const client = new Socket();
        client.connect(19005, '127.0.0.1', () => {
          assert.strictEqual(server.connections.size, 1);

          server.close(() => {
            assert.strictEqual(server.connections.size, 0);
            server = null;
            done();
          });
        });
      });
    });
  });
});

describe('createFastCGIServer()', () => {
  it('should create FastCGIServer instance', () => {
    const server = createFastCGIServer();
    assert.ok(server instanceof FastCGIServer);
    server.close();
  });

  it('should pass options to server', () => {
    const server = createFastCGIServer({ maxConns: 25 });
    assert.strictEqual(server.options.maxConns, 25);
    server.close();
  });
});
