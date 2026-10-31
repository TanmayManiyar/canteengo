'use strict';
// Builds a minimal one-page text PDF (Helvetica) from lines of text. Used for the sample menu and in tests.
//   node scripts/make-menu-pdf.js ../demo/sample-menu.pdf
const fs = require('fs');

function buildPdf(lines, { withText = true } = {}) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const body = withText ? ['BT', '/F1 12 Tf', '15 TL', '50 800 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n') : '0 0 100 100 re f'; // no text = like a scan
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => (out += `${String(off).padStart(10, '0')} 00000 n \n`));
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const SAMPLE_LINES = [
  'CANTEENGO MENU',
  'SNACKS',
  'Paneer Tikka Roll .......... Rs. 70',
  'Veg Spring Roll - 55',
  'Egg Bhurji Pav 45',
  'Misal Pav Rs 55',
  'BEVERAGES',
  'Hot Chocolate .......... Rs. 60',
  'Iced Tea - 35',
  'Buttermilk 20',
  'Oreo Shake 65 (sold out)',
  'DESSERTS',
  'Jalebi .......... Rs. 35',
  'Fruit Salad - 45',
  'MEALS',
  'Aloo Paratha 55',
  'Curd Rice Rs. 60',
  'Lemon Rice - 55',
];

module.exports = { buildPdf, SAMPLE_LINES };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) throw new Error('Usage: node scripts/make-menu-pdf.js <output.pdf>');
  fs.writeFileSync(target, buildPdf(SAMPLE_LINES));
  console.log('wrote', target);
}
