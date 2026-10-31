'use strict';
// Runs in a worker thread so the PDF library gets a clean environment (it breaks if Express is loaded
// first) and so a malformed PDF can never take the API down. See menuPdf.js.
const { parentPort, workerData } = require('worker_threads');
const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // the package root runs a self-test on import

// A plain Uint8Array, not a Buffer: the library fails on Buffers once web-server dependencies have patched them.
pdfParse(new Uint8Array(workerData))
  .then((d) => parentPort.postMessage({ text: d.text || '' }))
  .catch((e) => parentPort.postMessage({ error: String((e && e.message) || e) }));
