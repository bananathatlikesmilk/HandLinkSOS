const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const req = createRequire(path.join(process.env.HANDLINK_GUIDE_TOOLS || path.join(os.tmpdir(), 'handlink-defense-doc-tools'), 'package.json'));
(async () => {
  const canvasLib = req('@napi-rs/canvas');
  const pdfjs = await import(pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const pdfPath = path.join(__dirname, 'HandLink-System-Defense-Guide.pdf');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise;
  const pages = [], sections = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map(x => x.str).join(' ');
    pages.push({ page: n, characters: text.length });
    if (/01 \| Purpose|14 \| SOS|18 \| Local AI|26 \| Admin|Appendix A/.test(text)) sections.push(n);
  }
  const picks = [...new Set([1, 2, 3, 4, 6, 8, ...sections, pdf.numPages])].filter(n => n <= pdf.numPages);
  const preview = path.join(__dirname, 'preview');
  fs.mkdirSync(preview, { recursive: true });
  const sheet = canvasLib.createCanvas(1100, Math.ceil(picks.length / 3) * 530);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#d9e0db'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < picks.length; i++) {
    const n = picks[i], page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1.3 });
    const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
    fs.writeFileSync(path.join(preview, `page-${n}.png`), canvas.toBuffer('image/png'));
    const x = (i % 3) * 365 + 12, y = Math.floor(i / 3) * 530 + 25;
    ctx.drawImage(canvas, x, y, 340, 440);
    ctx.fillStyle = '#173b2c'; ctx.font = '18px Arial'; ctx.fillText(`Page ${n}`, x, y - 6);
  }
  fs.writeFileSync(path.join(preview, 'contact-sheet.png'), sheet.toBuffer('image/png'));
  const result = { pages: pdf.numPages, sampledPages: picks, nearEmptyPages: pages.filter(p => p.characters < 45) };
  fs.writeFileSync(path.join(__dirname, 'pdf-layout-summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await pdf.destroy();
})().catch(e => { console.error(e); process.exitCode = 1; });
