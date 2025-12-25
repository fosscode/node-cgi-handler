/**
 * CGI Module Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import {
  parseCGIEnv,
  parseHeaders,
  parseQueryString,
  parseCookies,
  parseBody,
  readBody,
  createRequest,
} from '../src/cgi.js';

describe('parseHeaders', () => {
  it('should parse HTTP_* environment variables to headers', () => {
    const env = {
      HTTP_HOST: 'example.com',
      HTTP_USER_AGENT: 'Mozilla/5.0',
      HTTP_ACCEPT: 'text/html',
      HTTP_X_CUSTOM_HEADER: 'custom-value',
    };

    const headers = parseHeaders(env);

    assert.strictEqual(headers['host'], 'example.com');
    assert.strictEqual(headers['user-agent'], 'Mozilla/5.0');
    assert.strictEqual(headers['accept'], 'text/html');
    assert.strictEqual(headers['x-custom-header'], 'custom-value');
  });

  it('should handle Content-Type and Content-Length specially', () => {
    const env = {
      CONTENT_TYPE: 'application/json',
      CONTENT_LENGTH: '42',
    };

    const headers = parseHeaders(env);

    assert.strictEqual(headers['content-type'], 'application/json');
    assert.strictEqual(headers['content-length'], '42');
  });

  it('should return empty object for no headers', () => {
    const headers = parseHeaders({});
    assert.deepStrictEqual(headers, {});
  });

  it('should convert underscores to hyphens and lowercase', () => {
    const env = {
      HTTP_X_FORWARDED_FOR: '192.168.1.1',
      HTTP_X_REAL_IP: '10.0.0.1',
    };

    const headers = parseHeaders(env);

    assert.strictEqual(headers['x-forwarded-for'], '192.168.1.1');
    assert.strictEqual(headers['x-real-ip'], '10.0.0.1');
  });
});

describe('parseQueryString', () => {
  it('should parse simple query string', () => {
    const result = parseQueryString('name=John&age=30');

    assert.strictEqual(result.name, 'John');
    assert.strictEqual(result.age, '30');
  });

  it('should handle URL encoded values', () => {
    const result = parseQueryString('message=Hello%20World&email=test%40example.com');

    assert.strictEqual(result.message, 'Hello World');
    assert.strictEqual(result.email, 'test@example.com');
  });

  it('should handle array notation (PHP-style)', () => {
    const result = parseQueryString('colors[]=red&colors[]=blue&colors[]=green');

    assert.deepStrictEqual(result.colors, ['red', 'blue', 'green']);
  });

  it('should handle duplicate keys as arrays', () => {
    const result = parseQueryString('tag=js&tag=node&tag=cgi');

    assert.deepStrictEqual(result.tag, ['js', 'node', 'cgi']);
  });

  it('should return empty object for empty/null query string', () => {
    assert.deepStrictEqual(parseQueryString(''), {});
    assert.deepStrictEqual(parseQueryString(null), {});
    assert.deepStrictEqual(parseQueryString(undefined), {});
  });

  it('should handle query string with empty values', () => {
    const result = parseQueryString('flag=&name=test');

    assert.strictEqual(result.flag, '');
    assert.strictEqual(result.name, 'test');
  });
});

describe('parseCookies', () => {
  it('should parse simple cookies', () => {
    const cookies = parseCookies('session=abc123; user=john');

    assert.strictEqual(cookies.session, 'abc123');
    assert.strictEqual(cookies.user, 'john');
  });

  it('should handle URL encoded cookie values', () => {
    const cookies = parseCookies('data=hello%20world');

    assert.strictEqual(cookies.data, 'hello world');
  });

  it('should return empty object for no cookies', () => {
    assert.deepStrictEqual(parseCookies(''), {});
    assert.deepStrictEqual(parseCookies(null), {});
    assert.deepStrictEqual(parseCookies(undefined), {});
  });

  it('should handle cookies with equals in value', () => {
    const cookies = parseCookies('token=abc=def=ghi');

    assert.strictEqual(cookies.token, 'abc=def=ghi');
  });

  it('should handle whitespace in cookie string', () => {
    const cookies = parseCookies('name=value; other=test');

    assert.strictEqual(cookies.name, 'value');
    assert.strictEqual(cookies.other, 'test');
  });
});

describe('parseBody', () => {
  it('should parse JSON body', () => {
    const body = Buffer.from('{"name":"John","age":30}');
    const { raw, parsed } = parseBody(body, 'application/json');

    assert.deepStrictEqual(parsed, { name: 'John', age: 30 });
    assert.strictEqual(raw.toString(), '{"name":"John","age":30}');
  });

  it('should parse form-urlencoded body', () => {
    const body = Buffer.from('name=John&age=30');
    const { parsed } = parseBody(body, 'application/x-www-form-urlencoded');

    assert.strictEqual(parsed.name, 'John');
    assert.strictEqual(parsed.age, '30');
  });

  it('should return string for text content types', () => {
    const body = Buffer.from('<html><body>Hello</body></html>');
    const { parsed } = parseBody(body, 'text/html');

    assert.strictEqual(parsed, '<html><body>Hello</body></html>');
  });

  it('should handle invalid JSON gracefully', () => {
    const body = Buffer.from('not valid json');
    const { parsed } = parseBody(body, 'application/json');

    assert.strictEqual(parsed, 'not valid json');
  });

  it('should return null for binary content types', () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const { raw, parsed } = parseBody(body, 'image/png');

    assert.strictEqual(parsed, null);
    assert.ok(Buffer.isBuffer(raw));
  });

  it('should handle empty body', () => {
    const body = Buffer.alloc(0);
    const { parsed } = parseBody(body, 'application/json');

    assert.strictEqual(parsed, null);
  });

  it('should handle content-type with charset', () => {
    const body = Buffer.from('{"test":true}');
    const { parsed } = parseBody(body, 'application/json; charset=utf-8');

    assert.deepStrictEqual(parsed, { test: true });
  });
});

describe('readBody', () => {
  it('should read entire body from stream', async () => {
    const stdin = Readable.from(['Hello', ' ', 'World']);
    const body = await readBody(stdin);

    assert.strictEqual(body.toString(), 'Hello World');
  });

  it('should respect content length limit', async () => {
    const stdin = Readable.from(['Hello World']);
    const body = await readBody(stdin, '5');

    assert.strictEqual(body.toString(), 'Hello');
  });

  it('should handle empty stream', async () => {
    const stdin = Readable.from([]);
    const body = await readBody(stdin);

    assert.strictEqual(body.length, 0);
  });

  it('should handle chunked data', async () => {
    const chunks = ['{"na', 'me":', '"Jo', 'hn"}'];
    const stdin = Readable.from(chunks);
    const body = await readBody(stdin);

    assert.strictEqual(body.toString(), '{"name":"John"}');
  });
});

describe('parseCGIEnv', () => {
  it('should parse standard CGI environment variables', () => {
    const env = {
      REQUEST_METHOD: 'POST',
      REQUEST_URI: '/api/users?page=1',
      QUERY_STRING: 'page=1',
      SCRIPT_NAME: '/api/users',
      SERVER_NAME: 'example.com',
      SERVER_PORT: '443',
      HTTPS: 'on',
      REMOTE_ADDR: '192.168.1.100',
      CONTENT_TYPE: 'application/json',
      CONTENT_LENGTH: '50',
      HTTP_HOST: 'example.com',
      HTTP_COOKIE: 'session=abc123',
    };

    const request = parseCGIEnv(env);

    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.uri, '/api/users?page=1');
    assert.strictEqual(request.queryString, 'page=1');
    assert.strictEqual(request.serverName, 'example.com');
    assert.strictEqual(request.serverPort, '443');
    assert.strictEqual(request.https, 'on');
    assert.strictEqual(request.remoteAddr, '192.168.1.100');
    assert.strictEqual(request.contentType, 'application/json');
    assert.deepStrictEqual(request.query, { page: '1' });
    assert.deepStrictEqual(request.cookies, { session: 'abc123' });
  });

  it('should build correct URL for HTTPS', () => {
    const env = {
      HTTPS: 'on',
      HTTP_HOST: 'secure.example.com',
      REQUEST_URI: '/path',
    };

    const request = parseCGIEnv(env);

    assert.strictEqual(request.url, 'https://secure.example.com/path');
  });

  it('should build correct URL for HTTP', () => {
    const env = {
      HTTP_HOST: 'example.com',
      REQUEST_URI: '/path?query=1',
    };

    const request = parseCGIEnv(env);

    assert.strictEqual(request.url, 'http://example.com/path?query=1');
  });

  it('should default to GET method', () => {
    const request = parseCGIEnv({});

    assert.strictEqual(request.method, 'GET');
  });

  it('should normalize method to uppercase', () => {
    const env = { REQUEST_METHOD: 'post' };
    const request = parseCGIEnv(env);

    assert.strictEqual(request.method, 'POST');
  });
});

describe('createRequest', () => {
  it('should create full request object for GET', async () => {
    const env = {
      REQUEST_METHOD: 'GET',
      REQUEST_URI: '/test?foo=bar',
      QUERY_STRING: 'foo=bar',
      HTTP_HOST: 'localhost',
    };

    const stdin = Readable.from([]);
    const request = await createRequest(env, stdin);

    assert.strictEqual(request.method, 'GET');
    assert.deepStrictEqual(request.query, { foo: 'bar' });
    assert.strictEqual(request.body, null);
  });

  it('should parse body for POST requests', async () => {
    const env = {
      REQUEST_METHOD: 'POST',
      CONTENT_TYPE: 'application/json',
      CONTENT_LENGTH: '17',
    };

    const stdin = Readable.from(['{"name":"John"}']);
    const request = await createRequest(env, stdin);

    assert.strictEqual(request.method, 'POST');
    assert.deepStrictEqual(request.body, { name: 'John' });
  });

  it('should parse body for PUT requests', async () => {
    const env = {
      REQUEST_METHOD: 'PUT',
      CONTENT_TYPE: 'application/x-www-form-urlencoded',
    };

    const stdin = Readable.from(['name=Updated']);
    const request = await createRequest(env, stdin);

    assert.strictEqual(request.method, 'PUT');
    assert.deepStrictEqual(request.body, { name: 'Updated' });
  });

  it('should parse body for PATCH requests', async () => {
    const env = {
      REQUEST_METHOD: 'PATCH',
      CONTENT_TYPE: 'application/json',
    };

    const stdin = Readable.from(['{"status":"active"}']);
    const request = await createRequest(env, stdin);

    assert.strictEqual(request.method, 'PATCH');
    assert.deepStrictEqual(request.body, { status: 'active' });
  });
});
