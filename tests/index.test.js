/**
 * Main Module (index.js) Tests
 */

import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  handle,
  createServer,
  createRouter,
  compose,
  createRequest,
  createResponse,
  Response,
  FastCGIServer,
} from '../src/index.js';

describe('createRouter()', () => {
  let router;

  beforeEach(() => {
    router = createRouter();
  });

  describe('route registration', () => {
    it('should register GET routes', () => {
      const handler = () => {};
      router.get('/test', handler);
      // Router should be chainable
      assert.ok(router.get('/other', handler) === router);
    });

    it('should register POST routes', () => {
      router.post('/users', () => {});
      assert.ok(true); // Just checking no errors
    });

    it('should register PUT routes', () => {
      router.put('/users/:id', () => {});
      assert.ok(true);
    });

    it('should register DELETE routes', () => {
      router.delete('/users/:id', () => {});
      assert.ok(true);
    });

    it('should register catch-all with all()', () => {
      router.all('/any', () => {});
      assert.ok(true);
    });

    it('should register middleware with use()', () => {
      router.use(() => {});
      assert.ok(true);
    });
  });

  describe('route matching', () => {
    it('should match exact paths', async () => {
      let matched = false;
      router.get('/exact', (req, res) => {
        matched = true;
        res.end();
      });

      const req = { method: 'GET', path: '/exact' };
      const res = { end: () => {}, status: () => res, json: () => {} };

      await router.handle(req, res);
      assert.strictEqual(matched, true);
    });

    it('should match path parameters', async () => {
      let capturedId = null;
      router.get('/users/:id', (req, res) => {
        capturedId = req.params.id;
        res.end();
      });

      const req = { method: 'GET', path: '/users/123' };
      const res = { end: () => {}, status: () => res, json: () => {} };

      await router.handle(req, res);
      assert.strictEqual(capturedId, '123');
    });

    it('should match multiple path parameters', async () => {
      let params = null;
      router.get('/users/:userId/posts/:postId', (req, res) => {
        params = req.params;
        res.end();
      });

      const req = { method: 'GET', path: '/users/42/posts/99' };
      const res = { end: () => {}, status: () => res, json: () => {} };

      await router.handle(req, res);
      assert.deepStrictEqual(params, { userId: '42', postId: '99' });
    });

    it('should respect HTTP method', async () => {
      let getMatched = false;
      let postMatched = false;

      router.get('/resource', () => {
        getMatched = true; 
      });
      router.post('/resource', () => {
        postMatched = true; 
      });

      const req = { method: 'POST', path: '/resource' };
      const res = { end: () => {}, status: () => res, json: () => {} };

      await router.handle(req, res);
      assert.strictEqual(getMatched, false);
      assert.strictEqual(postMatched, true);
    });

    it('should match all methods with all()', async () => {
      let matched = false;
      router.all('/any', () => {
        matched = true; 
      });

      const req = { method: 'PATCH', path: '/any' };
      const res = { end: () => {}, status: () => res, json: () => {} };

      await router.handle(req, res);
      assert.strictEqual(matched, true);
    });

    it('should return 404 for unmatched routes', async () => {
      let statusCode = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: () => {},
      };

      await router.handle({ method: 'GET', path: '/nonexistent' }, res);
      assert.strictEqual(statusCode, 404);
    });

    it('should match wildcard path', async () => {
      let matched = false;
      router.all('*', () => {
        matched = true; 
      });

      const req = { method: 'GET', path: '/anything/at/all' };
      const res = { end: () => {}, status: () => res, json: () => {} };

      await router.handle(req, res);
      assert.strictEqual(matched, true);
    });
  });

  describe('route execution order', () => {
    it('should match first registered route', async () => {
      let which = null;

      router.get('/test', () => {
        which = 'first'; 
      });
      router.get('/test', () => {
        which = 'second'; 
      });

      const req = { method: 'GET', path: '/test' };
      const res = { end: () => {}, status: () => res, json: () => {} };

      await router.handle(req, res);
      assert.strictEqual(which, 'first');
    });
  });
});

describe('compose()', () => {
  it('should execute middlewares in order', async () => {
    const order = [];

    const composed = compose(
      async (req, res, next) => {
        order.push(1);
        await next();
        order.push(4);
      },
      async (req, res, next) => {
        order.push(2);
        await next();
        order.push(3);
      },
    );

    await composed({}, {});
    assert.deepStrictEqual(order, [1, 2, 3, 4]);
  });

  it('should pass req and res through chain', async () => {
    const composed = compose(
      async (req, res, next) => {
        req.first = true;
        await next();
      },
      async (req, res, next) => {
        req.second = true;
        await next();
      },
    );

    const req = {};
    await composed(req, {});

    assert.strictEqual(req.first, true);
    assert.strictEqual(req.second, true);
  });

  it('should stop if next() not called', async () => {
    let secondCalled = false;

    const composed = compose(
      async (_req, _res, _next) => {
        // Don't call next()
      },
      async (_req, _res, _next) => {
        secondCalled = true;
      },
    );

    await composed({}, {});
    assert.strictEqual(secondCalled, false);
  });

  it('should handle empty middleware list', async () => {
    const composed = compose();
    await composed({}, {}); // Should not throw
    assert.ok(true);
  });

  it('should handle async middlewares', async () => {
    const results = [];

    const composed = compose(
      async (_req, _res, next) => {
        await new Promise(r => setTimeout(r, 10));
        results.push('a');
        await next();
      },
      async (_req, _res, next) => {
        results.push('b');
        await next();
      },
    );

    await composed({}, {});
    assert.deepStrictEqual(results, ['a', 'b']);
  });
});

describe('exports', () => {
  it('should export createRequest', () => {
    assert.strictEqual(typeof createRequest, 'function');
  });

  it('should export createResponse', () => {
    assert.strictEqual(typeof createResponse, 'function');
  });

  it('should export Response class', () => {
    assert.strictEqual(typeof Response, 'function');
  });

  it('should export FastCGIServer class', () => {
    assert.strictEqual(typeof FastCGIServer, 'function');
  });

  it('should export handle function', () => {
    assert.strictEqual(typeof handle, 'function');
  });

  it('should export createServer function', () => {
    assert.strictEqual(typeof createServer, 'function');
  });

  it('should export createRouter function', () => {
    assert.strictEqual(typeof createRouter, 'function');
  });

  it('should export compose function', () => {
    assert.strictEqual(typeof compose, 'function');
  });
});

describe('createServer()', () => {
  let server;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it('should create FastCGI server with handler', () => {
    server = createServer((req, res) => {
      res.json({ ok: true });
    });

    assert.ok(server instanceof FastCGIServer);
  });

  it('should handle requests with provided handler', async () => {
    let handlerCalled = false;

    server = createServer((req, res) => {
      handlerCalled = true;
      res.end();
    });

    // Manually emit a request event with mock response
    let endCalled = false;
    const mockRes = {
      _finished: false,
      _headersSent: false,
      end: function() {
        if (!endCalled) {
          endCalled = true;
          this._finished = true;
        }
      },
      status: function() {
        return this; 
      },
      type: function() {
        return this; 
      },
      send: function() {
        this.end(); 
      },
    };

    server.emit('request', { method: 'GET', path: '/' }, mockRes);

    // Give async handler time to complete
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(handlerCalled, true);
  });

  it('should handle errors in handler', async () => {
    server = createServer((_req, _res) => {
      throw new Error('Test error');
    });

    let statusSet = null;
    let sendCalled = false;
    const mockRes = {
      _finished: false,
      _headersSent: false,
      status: function(code) {
        statusSet = code;
        return this;
      },
      type: function() {
        return this; 
      },
      send: function() {
        sendCalled = true;
        this._finished = true;
      },
      end: function() {
        this._finished = true; 
      },
    };

    server.emit('request', { method: 'GET', path: '/' }, mockRes);

    // Give async error handler time to complete
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(statusSet, 500);
    assert.strictEqual(sendCalled, true);
  });
});

describe('integration', () => {
  it('should create working router with multiple routes', async () => {
    const router = createRouter();
    const responses = [];

    router.get('/users', (_req, res) => {
      responses.push('list');
      res.json([]);
    });

    router.get('/users/:id', (req, res) => {
      responses.push(`get-${req.params.id}`);
      res.json({});
    });

    router.post('/users', (_req, res) => {
      responses.push('create');
      res.json({});
    });

    const mockRes = {
      json: () => {},
      status: function() {
        return this; 
      },
    };

    await router.handle({ method: 'GET', path: '/users' }, mockRes);
    await router.handle({ method: 'GET', path: '/users/42' }, mockRes);
    await router.handle({ method: 'POST', path: '/users' }, mockRes);

    assert.deepStrictEqual(responses, ['list', 'get-42', 'create']);
  });

  it('should work with compose for middleware', async () => {
    const logs = [];

    const logger = async (req, _res, next) => {
      logs.push(`${req.method} ${req.path}`);
      await next();
    };

    const auth = async (req, _res, next) => {
      if (req.headers?.authorization) {
        req.user = 'authenticated';
      }
      await next();
    };

    const handler = async (req, _res) => {
      logs.push(`user: ${req.user || 'anonymous'}`);
    };

    const composed = compose(logger, auth, handler);

    await composed({ method: 'GET', path: '/test', headers: { authorization: 'Bearer xxx' } }, {});
    await composed({ method: 'POST', path: '/data', headers: {} }, {});

    assert.deepStrictEqual(logs, [
      'GET /test',
      'user: authenticated',
      'POST /data',
      'user: anonymous',
    ]);
  });
});
