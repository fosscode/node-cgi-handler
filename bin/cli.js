#!/usr/bin/env node

/**
 * node-cgi CLI
 *
 * Usage:
 *   node-cgi script.js           # Run script in CGI mode
 *   node-cgi --fastcgi           # Start FastCGI server (uses handler.js)
 *   node-cgi --fastcgi script.js # Start FastCGI server with specific script
 *   node-cgi --help              # Show help
 */

import { spawn, fork } from 'node:child_process';
import { createServer, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFastCGIServer, createRequest, createResponse } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

// Parse CLI arguments
const options = {
  fastcgi: false,
  port: 9000,
  socket: null,
  script: null,
  watch: false,
  help: false,
  version: false,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  switch (arg) {
    case '--fastcgi':
    case '-f':
      options.fastcgi = true;
      break;

    case '--port':
    case '-p':
      options.port = parseInt(args[++i], 10);
      break;

    case '--socket':
    case '-s':
      options.socket = args[++i];
      break;

    case '--watch':
    case '-w':
      options.watch = true;
      break;

    case '--help':
    case '-h':
      options.help = true;
      break;

    case '--version':
    case '-v':
      options.version = true;
      break;

    default:
      if (!arg.startsWith('-')) {
        options.script = arg;
      }
      break;
  }
}

// Show help
if (options.help) {
  console.log(`
node-cgi - PHP-style CGI/FastCGI handler for Node.js

USAGE:
  node-cgi <script.js>              Run script in CGI mode (single request)
  node-cgi --fastcgi [options]      Start FastCGI server

OPTIONS:
  -f, --fastcgi          Start as FastCGI server instead of CGI
  -p, --port <port>      FastCGI port (default: 9000)
  -s, --socket <path>    Use Unix socket instead of TCP port
  -w, --watch            Watch for file changes and reload
  -h, --help             Show this help message
  -v, --version          Show version number

CGI MODE:
  In CGI mode, the script receives request data via environment variables
  and stdin, and writes the response to stdout. This is how NGINX/Apache
  spawn PHP scripts.

  Example script:
    import { handle } from 'node-cgi-handler';

    handle((req, res) => {
      res.json({ message: 'Hello!', path: req.path });
    });

FASTCGI MODE:
  In FastCGI mode, a persistent server handles multiple requests efficiently.
  Configure NGINX to proxy to this server.

  Example:
    node-cgi --fastcgi --port 9000 handler.js

NGINX CONFIGURATION:
  # For CGI mode
  location ~ \\.js$ {
    gzip off;
    fastcgi_pass unix:/var/run/fcgiwrap.socket;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
  }

  # For FastCGI mode
  location /api {
    fastcgi_pass 127.0.0.1:9000;
    include fastcgi_params;
  }

For more info: https://github.com/your-username/node-cgi-handler
`);
  process.exit(0);
}

// Show version
if (options.version) {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  console.log(`node-cgi-handler v${pkg.version}`);
  process.exit(0);
}

// FastCGI server mode
if (options.fastcgi) {
  startFastCGIServer();
} else if (options.script) {
  // CGI mode - run script
  runCGIScript(options.script);
} else {
  // No script and not fastcgi - try to read from stdin (like PHP-CGI)
  runCGIMode();
}

/**
 * Start FastCGI server
 */
async function startFastCGIServer() {
  const scriptPath = options.script ? resolve(options.script) : null;

  if (scriptPath && !existsSync(scriptPath)) {
    console.error(`Error: Script not found: ${scriptPath}`);
    process.exit(1);
  }

  // Import the handler script
  let handler;
  if (scriptPath) {
    try {
      const module = await import(scriptPath);
      handler = module.default || module.handler || module;

      if (typeof handler !== 'function') {
        console.error('Error: Script must export a handler function');
        console.error('Example: export default (req, res) => { res.send("Hello"); }');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error loading script: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Default handler
    handler = (req, res) => {
      res.json({
        message: 'node-cgi-handler FastCGI server running',
        method: req.method,
        path: req.path,
        query: req.query,
      });
    };
  }

  const server = createFastCGIServer();

  server.on('request', async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`Request error: ${err.message}`);
      if (!res._headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }

    if (!res._finished) {
      res.end();
    }
  });

  server.on('error', (err) => {
    console.error(`Server error: ${err.message}`);
  });

  const listenTarget = options.socket || options.port;

  server.listen(listenTarget, () => {
    const target = options.socket || `port ${options.port}`;
    console.log(`FastCGI server listening on ${target}`);
    if (scriptPath) {
      console.log(`Handler: ${scriptPath}`);
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.close(() => process.exit(0));
  });
}

/**
 * Run a script in CGI mode
 */
async function runCGIScript(scriptPath) {
  const fullPath = resolve(scriptPath);

  if (!existsSync(fullPath)) {
    console.error(`Error: Script not found: ${fullPath}`);
    process.exit(1);
  }

  // Import and run the script
  try {
    await import(fullPath);
  } catch (err) {
    // Output CGI error response
    console.log('Status: 500 Internal Server Error');
    console.log('Content-Type: text/plain');
    console.log('');
    console.log(`Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Run in pure CGI mode (for fcgiwrap or similar)
 */
async function runCGIMode() {
  // In pure CGI mode, SCRIPT_FILENAME tells us what to run
  const scriptPath = process.env.SCRIPT_FILENAME;

  if (!scriptPath) {
    console.log('Status: 400 Bad Request');
    console.log('Content-Type: text/plain');
    console.log('');
    console.log('Error: No script specified. Set SCRIPT_FILENAME environment variable.');
    process.exit(1);
  }

  await runCGIScript(scriptPath);
}
