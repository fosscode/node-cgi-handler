#!/usr/bin/env node
/**
 * FastCGI Server Example
 *
 * This starts a persistent FastCGI server that handles multiple requests.
 * Much more efficient than spawning a new process per request.
 *
 * Run: node examples/fastcgi-server.js
 * Then configure NGINX to proxy to port 9000
 */

import { createServer } from '../src/index.js';

// Request counter (persists across requests since server is long-running)
let requestCount = 0;

const server = createServer(async (req, res) => {
  requestCount++;

  // Log request to stderr (goes to NGINX error log)
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} (#${requestCount})`);

  // Route handling
  if (req.path === '/') {
    return res.type('html').send(`
      <!DOCTYPE html>
      <html>
        <head><title>Node.js FastCGI</title></head>
        <body>
          <h1>Hello from Node.js FastCGI!</h1>
          <p>Request #${requestCount}</p>
          <p>Server uptime: ${Math.floor(process.uptime())}s</p>
          <ul>
            <li><a href="/api/info">API Info</a></li>
            <li><a href="/api/echo?foo=bar">Echo API</a></li>
          </ul>
        </body>
      </html>
    `);
  }

  if (req.path === '/api/info') {
    return res.json({
      requests: requestCount,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      node: process.version,
    });
  }

  if (req.path === '/api/echo') {
    return res.json({
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      body: req.body,
    });
  }

  // 404 for everything else
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.FCGI_PORT || 9000;

server.listen(PORT, () => {
  console.log(`FastCGI server running on port ${PORT}`);
  console.log('Configure NGINX with: fastcgi_pass 127.0.0.1:' + PORT);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
