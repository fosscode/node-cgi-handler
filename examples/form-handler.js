#!/usr/bin/env node
/**
 * Form Handler Example
 *
 * Demonstrates handling HTML form submissions with POST data.
 * Run with: node-cgi examples/form-handler.js
 */

import { handle } from '../src/index.js';

handle((req, res) => {
  if (req.method === 'GET') {
    // Show the form
    res.type('html').send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Contact Form</title>
          <style>
            body { font-family: system-ui; max-width: 500px; margin: 50px auto; padding: 20px; }
            label { display: block; margin-top: 15px; }
            input, textarea { width: 100%; padding: 8px; margin-top: 5px; }
            button { margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>Contact Form</h1>
          <form method="POST">
            <label>
              Name:
              <input type="text" name="name" required>
            </label>
            <label>
              Email:
              <input type="email" name="email" required>
            </label>
            <label>
              Message:
              <textarea name="message" rows="4" required></textarea>
            </label>
            <button type="submit">Send Message</button>
          </form>
        </body>
      </html>
    `);
  } else if (req.method === 'POST') {
    // Handle form submission
    const { name, email, message } = req.body || {};

    if (!name || !email || !message) {
      res.status(400).type('html').send(`
        <h1>Error</h1>
        <p>All fields are required.</p>
        <a href="javascript:history.back()">Go back</a>
      `);
      return;
    }

    // In a real app, you'd save to database, send email, etc.
    console.error(`New contact: ${name} <${email}>`);

    res.type('html').send(`
      <!DOCTYPE html>
      <html>
        <head><title>Message Sent</title></head>
        <body style="font-family: system-ui; max-width: 500px; margin: 50px auto; padding: 20px;">
          <h1>Thank You!</h1>
          <p>Your message has been received.</p>
          <dl>
            <dt><strong>Name:</strong></dt>
            <dd>${escapeHtml(name)}</dd>
            <dt><strong>Email:</strong></dt>
            <dd>${escapeHtml(email)}</dd>
            <dt><strong>Message:</strong></dt>
            <dd>${escapeHtml(message)}</dd>
          </dl>
          <a href="${req.path}">Send another message</a>
        </body>
      </html>
    `);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
