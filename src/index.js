/**
 * node-cgi-handler
 * PHP-style CGI/FastCGI handler for Node.js
 *
 * Run Node.js scripts per-request, just like traditional PHP
 */

import { createRequest, parseCGIEnv, parseHeaders, parseQueryString, parseCookies } from './cgi.js';
import { Response, createResponse } from './response.js';
import { FastCGIServer, FCGIResponse, createFastCGIServer } from './fastcgi.js';

/**
 * Main handler function - use this in your CGI scripts
 *
 * @example
 * // hello.js
 * import { handle } from 'node-cgi-handler';
 *
 * handle(async (req, res) => {
 *   res.json({ message: 'Hello World!', method: req.method });
 * });
 */
export async function handle(callback) {
  const req = await createRequest();
  const res = createResponse();

  try {
    await callback(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500);
      res.type('text/plain');
      res.send(`Internal Server Error: ${error.message}`);
    }
    // Log error to stderr (NGINX will capture this)
    console.error(error);
  }

  // Ensure response is ended
  if (!res._finished) {
    res.end();
  }
}

/**
 * Create a FastCGI server for handling multiple requests
 *
 * @example
 * import { createServer } from 'node-cgi-handler';
 *
 * const server = createServer((req, res) => {
 *   res.json({ message: 'Hello from FastCGI!' });
 * });
 *
 * server.listen(9000);
 */
export function createServer(handler) {
  const server = createFastCGIServer();

  server.on('request', async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res._headersSent) {
        res.status(500);
        res.type('text/plain');
        res.send(`Internal Server Error: ${error.message}`);
      }
    }

    if (!res._finished) {
      res.end();
    }
  });

  return server;
}

/**
 * Middleware-style handler that can be composed
 */
export function compose(...middlewares) {
  return async (req, res) => {
    let index = 0;

    async function next() {
      if (index >= middlewares.length) {
        return;
      }
      const middleware = middlewares[index++];
      await middleware(req, res, next);
    }

    await next();
  };
}

/**
 * Simple router for CGI scripts
 */
export function createRouter() {
  const routes = [];

  const router = {
    get(path, handler) {
      routes.push({ method: 'GET', path, handler });
      return router;
    },

    post(path, handler) {
      routes.push({ method: 'POST', path, handler });
      return router;
    },

    put(path, handler) {
      routes.push({ method: 'PUT', path, handler });
      return router;
    },

    delete(path, handler) {
      routes.push({ method: 'DELETE', path, handler });
      return router;
    },

    all(path, handler) {
      routes.push({ method: '*', path, handler });
      return router;
    },

    use(handler) {
      routes.push({ method: '*', path: '*', handler });
      return router;
    },

    async handle(req, res) {
      for (const route of routes) {
        if (route.method !== '*' && route.method !== req.method) {
          continue;
        }

        const match = matchPath(route.path, req.path);
        if (match) {
          req.params = match.params;
          await route.handler(req, res);
          return;
        }
      }

      // No route matched
      res.status(404).json({ error: 'Not Found' });
    },
  };

  return router;
}

/**
 * Match a path pattern against a request path
 */
function matchPath(pattern, path) {
  if (pattern === '*') {
    return { params: {} };
  }

  if (pattern === path) {
    return { params: {} };
  }

  // Handle :param patterns
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = pathPart;
    } else if (patternPart !== pathPart) {
      return null;
    }
  }

  return { params };
}

// Export all components
export {
  // CGI
  createRequest,
  parseCGIEnv,
  parseHeaders,
  parseQueryString,
  parseCookies,

  // Response
  Response,
  createResponse,

  // FastCGI
  FastCGIServer,
  FCGIResponse,
  createFastCGIServer,
};

export default {
  handle,
  createServer,
  createRouter,
  compose,
  createRequest,
  createResponse,
  createFastCGIServer,
  Response,
  FastCGIServer,
};
