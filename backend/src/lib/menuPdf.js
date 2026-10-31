'use strict';
// Reads a text-based menu PDF (REQ-30). Expected layout, one item per line, optional category headings:
//
//   SNACKS
//   Samosa ........ Rs. 15
//   Vada Pav 20
//   Beverages
//   Masala Chai - 10.50
//
// Scanned / image-only PDFs contain no text and are rejected by the caller.
const path = require('path');
const { Worker } = require('worker_threads');

const ITEM = /^(.*?[A-Za-z].*?)[\s.\-–—:|_]*(?:₹|Rs\.?|INR)?\s*(\d{1,5}(?:\.\d{1,2})?)\s*(?:\/-|rs\.?|₹)?\s*$/i;
const SOLD_OUT = /\(?\b(sold out|unavailable|not available|n\/a)\b\)?/i;
const IGNORABLE = /^(page\s*\d+(\s*of\s*\d+)?|\d+)$/i;

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function parseMenuText(text) {
  const rows = [];
  const errors = [];
  let category = 'Menu';
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());

  lines.forEach((raw, i) => {
    if (!raw || IGNORABLE.test(raw)) return;
    const available = !SOLD_OUT.test(raw);
    const line = raw.replace(SOLD_OUT, '').trim();
    const m = line.match(ITEM);
    if (m) {
      const name = m[1].replace(/[\s.\-–—:|_]+$/, '').trim();
      if (name) {
        rows.push({ name, category, price: Number(m[2]), available });
        return;
      }
    }
    if (!/\d/.test(line) && line.length <= 40 && !/[.!?,;]$/.test(line)) {
      category = /^[A-Z0-9 &/'-]+$/.test(line) ? titleCase(line) : line; // a heading such as "SNACKS" or "Beverages"
      return;
    }
    errors.push({ line: i + 1, reason: `Could not find an item name and price: "${raw.slice(0, 60)}"` });
  });
  return { rows, errors };
}

// Returns { text } for a PDF buffer, or throws an Error with .code 'NO_TEXT' / 'UNREADABLE'.
async function extractText(buffer) {
  // Parsed in a worker thread: the PDF library needs a clean environment, and a broken PDF cannot affect the API.
  const raw = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'menuPdfWorker.js'), { workerData: new Uint8Array(buffer) });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('timeout'));
    }, 20_000);
    worker.once('message', (m) => {
      clearTimeout(timer);
      worker.terminate();
      m.error ? reject(new Error(m.error)) : resolve(m.text);
    });
    worker.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  }).catch(() => {
    throw Object.assign(new Error('unreadable'), { code: 'UNREADABLE' });
  });
  const text = raw.trim();
  if (!text) throw Object.assign(new Error('no text'), { code: 'NO_TEXT' });
  return text;
}

module.exports = { parseMenuText, extractText };
