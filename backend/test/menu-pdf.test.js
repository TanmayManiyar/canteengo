'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const { buildPdf, SAMPLE_LINES } = require('../scripts/make-menu-pdf');
const { parseMenuText } = require('../src/lib/menuPdf');

let t, f;
beforeEach(async () => {
  t = await start();
  f = await t.seed();
});
afterEach(() => t.close());

const upload = (token, buffer) => t.api('POST', '/api/menu/drafts/upload-pdf', { token, body: { pdf: buffer.toString('base64') } });

test('parser reads names, prices, categories and sold-out markers from menu text', () => {
  const { rows, errors } = parseMenuText(
    ['SNACKS', 'Samosa ........ Rs. 15', 'Vada Pav 20', 'Beverages', 'Masala Chai - 10.50', 'Oreo Shake 65 (sold out)', 'Page 1', 'Open 8 AM to 6 PM daily'].join('\n')
  );
  assert.deepEqual(rows.map((r) => [r.category, r.name, r.price, r.available]), [
    ['Snacks', 'Samosa', 15, true],
    ['Snacks', 'Vada Pav', 20, true],
    ['Beverages', 'Masala Chai', 10.5, true],
    ['Beverages', 'Oreo Shake', 65, false],
  ]);
  assert.equal(errors.length, 1); // the opening-hours line has digits but is not an item
});

test('a text PDF becomes draft entries, nothing is published automatically (REQ-31)', async () => {
  const r = await upload(f.staff, buildPdf(SAMPLE_LINES));
  assert.equal(r.status, 201);
  const names = r.body.drafts.map((d) => d.name);
  assert.ok(names.includes('Paneer Tikka Roll') && names.includes('Curd Rice'));
  assert.equal(r.body.drafts.find((d) => d.name === 'Paneer Tikka Roll').category, 'Snacks');
  assert.equal(r.body.drafts.find((d) => d.name === 'Oreo Shake').available, false);
  assert.equal(r.body.drafts.find((d) => d.name === 'Misal Pav').price, 55);
  const menu = (await t.api('GET', '/api/menu', { token: f.student })).body.categories.flatMap((c) => c.items.map((i) => i.name));
  assert.ok(!menu.includes('Paneer Tikka Roll')); // still only a draft
});

test('PDF drafts are flagged when they duplicate an existing item', async () => {
  const r = await upload(f.staff, buildPdf(['SNACKS', 'Samosa 18', 'Pav Bhaji 60']));
  const dup = r.body.drafts.find((d) => d.name === 'Samosa');
  assert.equal(dup.duplicateOf, f.samosa.id);
  assert.equal(r.body.drafts.find((d) => d.name === 'Pav Bhaji').duplicateOf, null);
});

test('scanned / image-only PDFs are rejected with a clear message (REQ-30)', async () => {
  const r = await upload(f.staff, buildPdf([], { withText: false }));
  assert.equal(r.status, 422);
  assert.match(r.body.error, /text-based/i);
});

test('files that are not PDFs, or PDFs without any prices, are rejected', async () => {
  assert.equal((await upload(f.staff, Buffer.from('name,price\nTea,10'))).status, 400);
  const none = await upload(f.staff, buildPdf(['Welcome to our canteen', 'We open early']));
  assert.equal(none.status, 422);
  assert.equal((await t.api('POST', '/api/menu/drafts/upload-pdf', { token: f.staff, body: {} })).status, 400);
});

test('only staff may upload a PDF', async () => {
  assert.equal((await upload(f.student, buildPdf(SAMPLE_LINES))).status, 403);
});
