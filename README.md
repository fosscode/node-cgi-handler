# node-cgi-handler

**PHP-style CGI/FastCGI handler for Node.js** - Run scripts per-request, just like traditional PHP.

Drop a `.js` file on your server and it just works. No persistent server process needed.

## Why?

Traditional **PHP** works beautifully on cheap shared hosting:
- NGINX receives request → spawns PHP process → script runs → outputs response → exits
- No always-on process eating RAM
- Stateless, simple, reliable

**Node.js** typically requires:
- A persistent Express/Fastify server running 24/7
- Process managers (PM2, systemd)
- Reverse proxy configuration
- Constant memory usage even with zero traffic

**node-cgi-handler** brings PHP's simplicity to Node.js:
- Drop a `.js` file in your web directory
- NGINX spawns Node.js per-request (or use FastCGI for efficiency)
- Script handles request and exits
- Zero memory when idle - perfect for low-traffic sites

## Installation

```bash
npm install node-cgi-handler

# Or globally for CLI access
npm install -g node-cgi-handler
```

## Quick Start

### CGI Mode (simplest)

Create `hello.js`:

```javascript
import { handle } from 'node-cgi-handler';

handle((req, res) => {
  res.json({
    message: 'Hello from Node.js!',
    path: req.path,
    query: req.query,
  });
});
```

Test locally:
```bash
REQUEST_METHOD=GET REQUEST_URI=/test?name=world node hello.js
```

### FastCGI Mode (recommended for production)

For better performance, run a persistent FastCGI server:

```javascript
import { createServer } from 'node-cgi-handler';

const server = createServer((req, res) => {
  res.json({ message: 'Hello from FastCGI!' });
});

server.listen(9000, () => {
  console.log('FastCGI server on port 9000');
});
```

Or use the CLI:
```bash
node-cgi --fastcgi --port 9000 handler.js
```

## API Reference

### `handle(callback)`

Main function for CGI mode. Parses request from environment variables and stdin.

```javascript
import { handle } from 'node-cgi-handler';

handle(async (req, res) => {
  // req - Request object with method, path, query, headers, body, cookies
  // res - Response object with Express-like API

  res.status(200).json({ success: true });
});
```

### Request Object

| Property | Type | Description |
|----------|------|-------------|
| `method` | string | HTTP method (GET, POST, etc.) |
| `path` | string | Request path without query string |
| `uri` | string | Full request URI |
| `query` | object | Parsed query string parameters |
| `headers` | object | HTTP headers (lowercase keys) |
| `cookies` | object | Parsed cookies |
| `body` | any | Parsed request body (JSON, form data) |
| `rawBody` | Buffer | Raw request body |
| `contentType` | string | Content-Type header |
| `remoteAddr` | string | Client IP address |

### Response Object

Express-like API for building responses:

```javascript
// Set status code
res.status(404);

// Set headers
res.set('X-Custom-Header', 'value');
res.header('Content-Type', 'text/plain');
res.type('json'); // shorthand for Content-Type

// Set cookies
res.cookie('session', 'abc123', {
  httpOnly: true,
  maxAge: 3600,
  path: '/',
});

// Send response
res.send('Hello World');           // Auto-detects content type
res.json({ message: 'Hello' });    // JSON response
res.redirect('/other-page');       // Redirect
res.sendFile('/path/to/file.pdf'); // Send file
```

### `createServer(handler)`

Create a FastCGI server for handling multiple requests efficiently:

```javascript
import { createServer } from 'node-cgi-handler';

const server = createServer((req, res) => {
  res.json({ uptime: process.uptime() });
});

server.listen(9000);
// Or Unix socket: server.listen('/var/run/node-cgi.sock');
```

### `createRouter()`

Simple router for organizing endpoints:

```javascript
import { handle, createRouter } from 'node-cgi-handler';

const router = createRouter();

router.get('/users', (req, res) => {
  res.json({ users: [] });
});

router.post('/users', (req, res) => {
  res.status(201).json({ created: req.body });
});

router.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id });
});

handle(router.handle.bind(router));
```

## NGINX Configuration

### FastCGI Mode (recommended)

Start the server:
```bash
node-cgi --fastcgi --port 9000 handler.js
```

NGINX config:
```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/myapp;

    # Serve static files directly
    location / {
        try_files $uri $uri/ @node;
    }

    # Proxy to Node.js FastCGI
    location /api {
        include fastcgi_params;
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }

    location @node {
        include fastcgi_params;
        fastcgi_pass 127.0.0.1:9000;
    }
}
```

### CGI Mode (via fcgiwrap)

For true PHP-style "drop file and run" behavior:

1. Install fcgiwrap: `apt install fcgiwrap`

2. NGINX config:
```nginx
location ~ \.js$ {
    gzip off;
    fastcgi_pass unix:/var/run/fcgiwrap.socket;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}
```

## CLI Reference

```
node-cgi - PHP-style CGI/FastCGI handler for Node.js

USAGE:
  node-cgi <script.js>              Run script in CGI mode
  node-cgi --fastcgi [options]      Start FastCGI server

OPTIONS:
  -f, --fastcgi          Start as FastCGI server
  -p, --port <port>      FastCGI port (default: 9000)
  -s, --socket <path>    Use Unix socket instead of TCP
  -h, --help             Show help
  -v, --version          Show version
```

## Examples

### Simple JSON API

```javascript
import { handle } from 'node-cgi-handler';

handle((req, res) => {
  if (req.method === 'GET') {
    res.json({ time: new Date().toISOString() });
  } else if (req.method === 'POST') {
    res.json({ received: req.body });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
});
```

### Form Handler

```javascript
import { handle } from 'node-cgi-handler';

handle((req, res) => {
  if (req.method === 'GET') {
    res.type('html').send(`
      <form method="POST">
        <input name="email" type="email" required>
        <button>Subscribe</button>
      </form>
    `);
  } else if (req.method === 'POST') {
    const { email } = req.body;
    // Save to database...
    res.send(`Thanks for subscribing, ${email}!`);
  }
});
```

### Database Query

```javascript
import { handle } from 'node-cgi-handler';
import { createPool } from 'mysql2/promise';

const pool = createPool({
  host: 'localhost',
  user: 'root',
  database: 'myapp',
});

handle(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM users LIMIT 10');
  res.json({ users: rows });
});
```

## CGI vs FastCGI

| Feature | CGI Mode | FastCGI Mode |
|---------|----------|--------------|
| Process per request | Yes (new process each time) | No (persistent server) |
| Cold start time | Higher (~50-100ms) | None after first request |
| Memory when idle | Zero | ~30-50MB |
| Shared state | No (stateless) | Yes (in-memory caching) |
| Best for | Low traffic, simplicity | Higher traffic, performance |
| Setup complexity | Lower | Slightly higher |

## When to Use This

**Good fit:**
- Shared hosting with only PHP support
- Low-traffic sites/APIs
- Serverless-style deployment
- Simple scripts and tools
- Resource-constrained environments
- Sites with bursty traffic (zero resources when idle)

**Not ideal for:**
- High-concurrency real-time apps
- WebSocket applications
- Apps requiring persistent connections
- Very high traffic (use traditional Node.js server)

## License

MIT
