#!/usr/bin/env node
/**
 * API Handler Example with Routing
 *
 * This demonstrates how to build a small API using node-cgi-handler.
 * Use with FastCGI mode: node-cgi --fastcgi --port 9000 examples/api-handler.js
 */

import { createRouter } from '../src/index.js';

// Create a router
const router = createRouter();

// In-memory data store (resets between CGI requests, persists in FastCGI mode)
const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
];

// GET /api/users - List all users
router.get('/api/users', (req, res) => {
  res.json({ users });
});

// GET /api/users/:id - Get single user
router.get('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user });
});

// POST /api/users - Create user
router.post('/api/users', (req, res) => {
  const { name, email } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email required' });
  }

  const user = {
    id: users.length + 1,
    name,
    email,
  };

  users.push(user);
  res.status(201).json({ user });
});

// DELETE /api/users/:id - Delete user
router.delete('/api/users/:id', (req, res) => {
  const index = users.findIndex(u => u.id === parseInt(req.params.id));

  if (index === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const [deleted] = users.splice(index, 1);
  res.json({ deleted });
});

// GET /api/health - Health check
router.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Export handler for FastCGI mode
export default router.handle.bind(router);

// Also run in CGI mode if executed directly
import { handle } from '../src/index.js';
handle(router.handle.bind(router));
