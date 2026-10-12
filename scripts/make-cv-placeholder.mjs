/**
 * Write a minimal, valid single-page PDF so the "Download CV" button never
 * 404s out of the box. Replace public/assets/cv.pdf with your real CV —
 * everything else is driven by content.json already.
 *
 *   node scripts/make-cv-placeholder.mjs   (or: npm run gen:assets)
 */
import { writeFile, mkdir } from 'node:fs/promises';

const stream =
  'BT /F1 22 Tf 72 750 Td (Curriculum Vitae) Tj ET\n' +
  'BT /F1 12 Tf 72 712 Td (Placeholder file - replace public/assets/cv.pdf with your real CV.) Tj ET\n' +
  'BT /F1 12 Tf 72 690 Td (The Download CV button and label come from content.json -> cv.) Tj ET';

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, index) => {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefOffset = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

await mkdir('public/assets', { recursive: true });
// Pure ASCII → byte offsets equal string offsets; latin1 writes 1 byte/char.
await writeFile('public/assets/cv.pdf', pdf, 'latin1');
console.log('make-cv-placeholder: public/assets/cv.pdf written (replace it with your real CV).');
