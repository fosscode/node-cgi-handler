/**
 * Response Module Tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Writable } from 'node:stream';
import { Response, createResponse } from '../src/response.js';

/**
 * Create a mock stdout that captures output
 */
function createMockStdout() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  stream.getOutput = () => chunks.join('');
  stream.getChunks = () => chunks;
  return stream;
}

describe('Response', () => {
  let stdout;
  let res;

  beforeEach(() => {
    stdout = createMockStdout();
    res = new Response(stdout);
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

    it('should throw if headers already sent', () => {
      res.end();
      assert.throws(() => res.status(500), /Cannot set status after headers sent/);
    });
  });

  describe('set() / header() / setHeader()', () => {
    it('should set a single header', () => {
      res.set('X-Custom', 'value');
      assert.strictEqual(res.get('X-Custom'), 'value');
    });

    it('should set multiple headers from object', () => {
      res.set({
        'X-First': 'one',
        'X-Second': 'two',
      });
      assert.strictEqual(res.get('X-First'), 'one');
      assert.strictEqual(res.get('X-Second'), 'two');
    });

    it('should be chainable', () => {
      const result = res.set('X-Test', 'value');
      assert.strictEqual(result, res);
    });

    it('header() should alias set()', () => {
      res.header('X-Via-Header', 'test');
      assert.strictEqual(res.get('X-Via-Header'), 'test');
    });

    it('setHeader() should alias set()', () => {
      res.setHeader('X-Via-SetHeader', 'test');
      assert.strictEqual(res.getHeader('X-Via-SetHeader'), 'test');
    });

    it('should throw if headers already sent', () => {
      res.end();
      assert.throws(() => res.set('X-Test', 'value'), /Cannot set headers after they are sent/);
    });
  });

  describe('removeHeader()', () => {
    it('should remove a header', () => {
      res.set('X-Remove-Me', 'value');
      res.removeHeader('X-Remove-Me');
      assert.strictEqual(res.get('X-Remove-Me'), undefined);
    });
  });

  describe('type()', () => {
    it('should set Content-Type for shorthand types', () => {
      res.type('json');
      assert.strictEqual(res.get('Content-Type'), 'application/json; charset=utf-8');
    });

    it('should handle html shorthand', () => {
      res.type('html');
      assert.strictEqual(res.get('Content-Type'), 'text/html; charset=utf-8');
    });

    it('should handle text shorthand', () => {
      res.type('text');
      assert.strictEqual(res.get('Content-Type'), 'text/plain; charset=utf-8');
    });

    it('should pass through full content type', () => {
      res.type('image/png');
      assert.strictEqual(res.get('Content-Type'), 'image/png');
    });
  });

  describe('cookie()', () => {
    it('should set a simple cookie', () => {
      res.cookie('session', 'abc123');
      res.end();

      const output = stdout.getOutput();
      assert.ok(output.includes('Set-Cookie: session=abc123'));
    });

    it('should set cookie with options', () => {
      res.cookie('token', 'xyz', {
        httpOnly: true,
        secure: true,
        maxAge: 3600,
        path: '/',
        sameSite: 'Strict',
      });
      res.end();

      const output = stdout.getOutput();
      assert.ok(output.includes('Set-Cookie:'));
      assert.ok(output.includes('HttpOnly'));
      assert.ok(output.includes('Secure'));
      assert.ok(output.includes('Max-Age=3600'));
      assert.ok(output.includes('Path=/'));
      assert.ok(output.includes('SameSite=Strict'));
    });

    it('should URL encode cookie values', () => {
      res.cookie('data', 'hello world');
      res.end();

      const output = stdout.getOutput();
      assert.ok(output.includes('Set-Cookie: data=hello%20world'));
    });

    it('should handle expires option', () => {
      const expires = new Date('2025-12-31T23:59:59Z');
      res.cookie('temp', 'value', { expires });
      res.end();

      const output = stdout.getOutput();
      assert.ok(output.includes('Expires='));
    });
  });

  describe('clearCookie()', () => {
    it('should set cookie with expired date', () => {
      res.clearCookie('session');
      res.end();

      const output = stdout.getOutput();
      assert.ok(output.includes('Set-Cookie: session='));
      assert.ok(output.includes('Expires=Thu, 01 Jan 1970'));
    });
  });

  describe('write()', () => {
    it('should write headers before first write', () => {
      res.write('Hello');

      const output = stdout.getOutput();
      assert.ok(output.includes('Status: 200 OK'));
      assert.ok(output.includes('Content-Type:'));
      assert.ok(output.includes('\r\n\r\n'));
      assert.ok(output.includes('Hello'));
    });

    it('should write string content', () => {
      res.write('Hello');
      res.write(' World');

      const output = stdout.getOutput();
      assert.ok(output.includes('Hello World'));
    });

    it('should write buffer content', () => {
      res.write(Buffer.from('Binary'));

      const output = stdout.getOutput();
      assert.ok(output.includes('Binary'));
    });

    it('should be chainable', () => {
      const result = res.write('test');
      assert.strictEqual(result, res);
    });

    it('should throw if response finished', () => {
      res.end();
      assert.throws(() => res.write('more'), /Cannot write after response finished/);
    });
  });

  describe('end()', () => {
    it('should write headers even without body', () => {
      res.end();

      const output = stdout.getOutput();
      assert.ok(output.includes('Status: 200 OK'));
      assert.ok(output.includes('\r\n\r\n'));
    });

    it('should write final data if provided', () => {
      res.end('Final');

      const output = stdout.getOutput();
      assert.ok(output.includes('Final'));
    });

    it('should mark response as finished', () => {
      res.end();
      assert.strictEqual(res._finished, true);
    });

    it('should be idempotent', () => {
      res.end('First');
      res.end('Second'); // Should not throw or write more

      const output = stdout.getOutput();
      assert.ok(output.includes('First'));
      assert.ok(!output.includes('Second'));
    });
  });

  describe('send()', () => {
    it('should send string as HTML', () => {
      res.send('<h1>Hello</h1>');

      const output = stdout.getOutput();
      assert.ok(output.includes('text/html'));
      assert.ok(output.includes('<h1>Hello</h1>'));
    });

    it('should send object as JSON', () => {
      res.send({ message: 'Hello' });

      const output = stdout.getOutput();
      assert.ok(output.includes('application/json'));
      assert.ok(output.includes('{"message":"Hello"}'));
    });

    it('should send buffer content', () => {
      // Remove default content-type to test buffer detection
      res.removeHeader('Content-Type');
      res.send(Buffer.from([0x00, 0x01, 0x02]));

      const output = stdout.getOutput();
      assert.ok(output.includes('application/octet-stream'));
    });

    it('should handle null/undefined', () => {
      res.send(null);
      assert.strictEqual(res._finished, true);
    });
  });

  describe('json()', () => {
    it('should send JSON response', () => {
      res.json({ success: true, data: [1, 2, 3] });

      const output = stdout.getOutput();
      assert.ok(output.includes('Content-Type: application/json'));
      assert.ok(output.includes('{"success":true,"data":[1,2,3]}'));
    });

    it('should set Content-Length header', () => {
      res.json({ test: true });

      const output = stdout.getOutput();
      assert.ok(output.includes('Content-Length:'));
    });

    it('should handle arrays', () => {
      res.json([1, 2, 3]);

      const output = stdout.getOutput();
      assert.ok(output.includes('[1,2,3]'));
    });

    it('should handle nested objects', () => {
      res.json({ user: { name: 'John', age: 30 } });

      const output = stdout.getOutput();
      assert.ok(output.includes('"user":{"name":"John","age":30}'));
    });
  });

  describe('redirect()', () => {
    it('should redirect with 302 by default', () => {
      res.redirect('/new-location');

      const output = stdout.getOutput();
      assert.ok(output.includes('Status: 302 Found'));
      assert.ok(output.includes('Location: /new-location'));
    });

    it('should support custom status code', () => {
      res.redirect('/permanent', 301);

      const output = stdout.getOutput();
      assert.ok(output.includes('Status: 301 Moved Permanently'));
      assert.ok(output.includes('Location: /permanent'));
    });

    it('should handle absolute URLs', () => {
      res.redirect('https://example.com/page');

      const output = stdout.getOutput();
      assert.ok(output.includes('Location: https://example.com/page'));
    });
  });

  describe('headersSent', () => {
    it('should be false initially', () => {
      assert.strictEqual(res.headersSent, false);
    });

    it('should be true after write', () => {
      res.write('test');
      assert.strictEqual(res.headersSent, true);
    });

    it('should be true after end', () => {
      res.end();
      assert.strictEqual(res.headersSent, true);
    });
  });
});

describe('createResponse()', () => {
  it('should create Response instance', () => {
    const stdout = createMockStdout();
    const res = createResponse(stdout);

    assert.ok(res instanceof Response);
  });

  it('should use provided stdout', () => {
    const stdout = createMockStdout();
    const res = createResponse(stdout);

    res.send('test');
    assert.ok(stdout.getOutput().includes('test'));
  });
});

describe('CGI Output Format', () => {
  it('should output proper CGI format', () => {
    const stdout = createMockStdout();
    const res = new Response(stdout);

    res.status(200);
    res.set('X-Custom', 'value');
    res.send('Body content');

    const output = stdout.getOutput();

    // Should have Status line
    assert.ok(output.startsWith('Status: 200 OK\r\n'));

    // Should have headers
    assert.ok(output.includes('X-Custom: value\r\n'));
    assert.ok(output.includes('Content-Type:'));

    // Should have blank line before body
    assert.ok(output.includes('\r\n\r\n'));

    // Body should come after blank line
    const parts = output.split('\r\n\r\n');
    assert.strictEqual(parts.length, 2);
    assert.ok(parts[1].includes('Body content'));
  });

  it('should handle multiple Set-Cookie headers', () => {
    const stdout = createMockStdout();
    const res = new Response(stdout);

    res.cookie('first', '1');
    res.cookie('second', '2');
    res.end();

    const output = stdout.getOutput();
    const cookieMatches = output.match(/Set-Cookie:/g);

    assert.strictEqual(cookieMatches.length, 2);
  });
});
