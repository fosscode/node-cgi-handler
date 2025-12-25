#!/usr/bin/env node
/**
 * Simple Hello World example
 *
 * Run with: node-cgi examples/hello.js
 * Or test locally: REQUEST_METHOD=GET REQUEST_URI=/test node examples/hello.js
 */

import { handle } from '../src/index.js';

handle((req, res) => {
  res.json({
    message: 'Hello from Node.js CGI!',
    method: req.method,
    path: req.path,
    query: req.query,
    timestamp: new Date().toISOString(),
  });
});
