// Build the teaching document without changing application dependencies.
// Install docx and @resvg/resvg-js in HANDLINK_GUIDE_TOOLS, then run this file.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createRequire } = require('node:module');
const toolsDir = process.env.HANDLINK_GUIDE_TOOLS || path.join(os.tmpdir(), 'handlink-defense-doc-tools');
const req = createRequire(path.join(toolsDir, 'package.json'));
const { Resvg } = req('@resvg/resvg-js');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ImageRun, Header, Footer,
  PageNumber, ShadingType, BorderStyle, TableOfContents
} = req('docx');
const root = path.resolve(__dirname, '../..');
const out = __dirname;
const source = path.join(out, 'HandLink-System-Defense-Guide.md');
const diagrams = path.join(out, 'flowcharts');
fs.mkdirSync(diagrams, { recursive: true });
const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const wrap = (s, max = 43) => {
  const rows = [''];
  for (const w of s.split(/\s+/)) {
    if ((rows.at(-1) + ' ' + w).trim().length > max && rows.at(-1)) rows.push(w);
    else rows[rows.length - 1] = (rows.at(-1) + ' ' + w).trim();
  }
  return rows;
};
function label(text, cx, cy, max = 43, color = '#16352e') {
  const lines = wrap(text, max);
  return `<text text-anchor="middle" font-family="Arial" font-size="23" fill="${color}">${lines.map((line, i) => `<tspan x="${cx}" y="${cy + (i - (lines.length - 1) / 2) * 26 + 8}">${xml(line)}</tspan>`).join('')}</text>`;
}
let diagramCount = 0;
function flowchart(lines) {
  const title = lines.shift();
  const nodes = lines.filter(Boolean).map(line => {
    const decision = line.startsWith('? ');
    const [text, fail] = line.replace(/^\? /, '').split(' | ');
    return { text, fail, decision };
  });
  const w = 1050, h = 80 + nodes.length * 122;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#ffffff"/><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#47695d"/></marker></defs>`;
  svg += label(title, 525, 27, 78);
  nodes.forEach((n, i) => {
    const x = 45, y = 70 + i * 122, bw = 620, bh = 86;
    const cx = x + bw / 2, cy = y + bh / 2;
    if (n.decision) {
      svg += `<path d="M${cx},${y - 4} L${x + bw},${cy} L${cx},${y + bh + 4} L${x},${cy} Z" fill="#fff1cc" stroke="#a77b25" stroke-width="2"/>`;
      svg += label(n.text, cx, cy, 28);
    } else {
      const fill = i === 0 || i === nodes.length - 1 ? '#dbece4' : '#eef4f1';
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${i === 0 || i === nodes.length - 1 ? 38 : 12}" fill="${fill}" stroke="#497963" stroke-width="2"/>`;
      svg += label(n.text, cx, cy);
    }
    if (n.fail) {
      svg += `<path d="M665,${cy} L748,${cy}" stroke="#47695d" stroke-width="2" marker-end="url(#arrow)"/>`;
      svg += `<text x="695" y="${cy - 12}" text-anchor="middle" font-family="Arial" font-size="19">No</text>`;
      svg += `<rect x="758" y="${y}" width="265" height="${bh}" rx="12" fill="#fce8e6" stroke="#b86d65" stroke-width="2"/>`;
      svg += label(n.fail, 890, cy, 21, '#653a35');
    }
    if (i < nodes.length - 1) {
      svg += `<path d="M${cx},${y + bh + (n.decision ? 4 : 0)} L${cx},${y + 113}" stroke="#47695d" stroke-width="2" marker-end="url(#arrow)"/>`;
      if (n.decision) svg += `<text x="${cx + 28}" y="${y + bh + 24}" font-family="Arial" font-size="18">Yes</text>`;
    }
  });
  svg += '</svg>';
  diagramCount++;
  const base = `${String(diagramCount).padStart(2, '0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  fs.writeFileSync(path.join(diagrams, base + '.svg'), svg);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 2100 } }).render().asPng();
  fs.writeFileSync(path.join(diagrams, base + '.png'), png);
  const width = Math.min(624, 624 * 680 / (h * 624 / w));
  const height = width * h / w;
  return [
    new Paragraph({ text: `Flowchart ${diagramCount}. ${title}`, style: 'Caption', keepNext: true }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: png, transformation: { width, height }, altText: { title, description: nodes.map(n => n.text + (n.fail ? '; if no: ' + n.fail : '')).join('. '), name: base } })] })
  ];
}
function runs(s) {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map(t =>
    t.startsWith('`') ? new TextRun({ text: t.slice(1, -1), font: 'Consolas', size: 19, color: '245347' }) :
      t.startsWith('**') ? new TextRun({ text: t.slice(2, -2), bold: true }) : new TextRun(t));
}
function table(rows) {
  const cols = rows[0].length;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array(cols).fill(Math.floor(9360 / cols)),
    rows: rows.map((row, idx) => new TableRow({ tableHeader: idx === 0, cantSplit: true, children: row.map(cell => new TableCell({
      shading: idx === 0 ? { fill: 'DFEBE5', type: ShadingType.CLEAR } : undefined,
      margins: { top: 90, bottom: 90, left: 100, right: 100 },
      children: [new Paragraph({ children: runs(cell.trim()), spacing: { after: 0 }, style: idx === 0 ? 'TableHeader' : 'TableBody' })]
    })) }))
  });
}
function parseMarkdown(md) {
  const lines = md.split(/\r?\n/), children = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim(), block = [];
      while (++i < lines.length && !lines[i].startsWith('```')) block.push(lines[i]);
      if (lang === 'flow') children.push(...flowchart(block));
      else block.forEach((code, index) => children.push(new Paragraph({ style: 'Code', keepNext: index < block.length - 1, children: [new TextRun({ text: code || ' ', font: 'Consolas', size: 17 })] })));
    } else if (line.startsWith('|')) {
      const rows = [];
      do {
        if (!/^\|[\s:|\-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|'));
        i++;
      } while (i < lines.length && lines[i].startsWith('|'));
      i--;
      children.push(table(rows), new Paragraph({ text: '', spacing: { after: 30 } }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_2 }));
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.TITLE }));
    } else if (line.startsWith('- ')) {
      children.push(new Paragraph({ children: runs(line.slice(2)), bullet: { level: 0 } }));
    } else if (/^\d+\. /.test(line)) {
      children.push(new Paragraph({ children: runs(line), indent: { left: 120 } }));
    } else {
      let text = line;
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||-|\d+\. |```)/.test(lines[i + 1])) text += ' ' + lines[++i];
      children.push(new Paragraph({ children: runs(text.replace(/^> /, '')), style: line.startsWith('> ') ? 'Defense' : undefined }));
    }
  }
  return children;
}
const fileDescriptions = JSON.parse(fs.readFileSync(path.join(out, 'file-notes.json'), 'utf8'));
function description(p) {
  if (fileDescriptions[p]) return fileDescriptions[p];
  if (p.startsWith('src/routes/api/')) {
    const t = fs.readFileSync(path.join(root, p), 'utf8');
    const methods = [...t.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map(x => x[1]).join(', ');
    return `${methods || 'Handler'} for /${p.slice('src/routes/'.length).replace('/+server.ts', '')}. Calls server helpers; see the endpoint index.`;
  }
  if (p.startsWith('src/lib/demo/') || p.startsWith('src/routes/demo/')) return 'Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior.';
  if (p.endsWith('.e2e.ts')) return 'Automated browser/API test. Checks behavior; not part of normal request handling.';
  if (p.endsWith('+page.svelte')) return `Visible page for /${p.slice(11).replace('/+page.svelte', '')}. Displays data and initiates user actions.`;
  if (p.endsWith('+layout.server.ts')) return 'Server layout loader. Supplies page data and enforces portal access before rendering.';
  if (p.endsWith('+layout.svelte')) return 'Shared interface shell for nested pages. Owns layout and shared navigation/state.';
  if (p.endsWith('+page.server.ts')) return 'Page server loader/actions. Reads trusted server data for the corresponding page.';
  if (p.endsWith('+page.ts')) return 'Page load or redirect logic. Check target before treating it as a standalone feature.';
  if (p.endsWith('.java')) return 'Android-native implementation. Compiled into the APK; native edits require rebuilding.';
  if (p.startsWith('scripts/')) return 'Operator/build utility. Run only for its documented setup or maintenance task.';
  if (p.startsWith('src/lib/components/')) return 'Reusable staff/UI component. Server endpoints remain the authority for data access.';
  return 'Supporting source module. Follow its imports and exports to trace its callers.';
}
let appendix = '\n## Appendix A | File-by-file map\n\nPaths are relative to the repository root. Generated Android build files and dependencies are excluded. This map explains source ownership, not every generated artifact.\n';
for (const [name, dirs] of [
  ['Shared and server modules', ['src/lib']],
  ['Pages, layouts, and endpoints', ['src/routes']],
  ['Native Android source', ['android/app/src/main/java']],
  ['Operator scripts', ['scripts']]
]) {
  appendix += `\n### ${name}\n\n| File | Responsibility |\n|---|---|\n`;
  for (const file of dirs.flatMap(d => walk(path.join(root, d))).filter(p => /\.(ts|svelte|java|mjs)$/.test(p)).sort()) {
    const p = rel(file);
    appendix += `| ${p} | ${description(p)} |\n`;
  }
}
appendix += '\n## Appendix B | Complete custom API index\n\nThe methods below come from exported handlers. [id] is a URL parameter. Authentication endpoints are provided by Better Auth through hooks and listed separately in the lessons.\n\n| Methods and endpoint | Source file |\n|---|---|\n';
for (const file of walk(path.join(root, 'src/routes/api')).filter(p => p.endsWith('+server.ts')).sort()) {
  const p = rel(file), t = fs.readFileSync(file, 'utf8');
  const methods = [...t.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map(x => x[1]).join(', ');
  appendix += `| ${methods} /${p.slice('src/routes/'.length).replace('/+server.ts', '')} | ${p} |\n`;
}
appendix += '\n## Appendix C | Configuration and supporting assets\n\nPrivate settings are described by purpose only. Do not include real credentials in this guide.\n\n| File or folder | Responsibility |\n|---|---|\n';
for (const [file, purpose] of [
  ['src/hooks.server.ts', 'Checks incoming sessions; invokes Better Auth integration; starts expiry/push timers outside build mode.'],
  ['src/env.ts', 'Environment typing/configuration support; actual runtime private settings remain server-side.'],
  ['src/app.html', 'Base HTML document used by the web application.'],
  ['src/app.d.ts', 'Shared application/request-local TypeScript declarations.'],
  ['src/routes/layout.css', 'Global theme, layout, and component styles. CSS does not enforce access permissions.'],
  ['package.json / pnpm-lock.yaml', 'Declared package versions, scripts, and locked dependency resolution.'],
  ['svelte.config.js / vite.config.ts', 'Framework adapter/build/test-runtime configuration.'],
  ['tsconfig.json', 'TypeScript checking and module configuration.'],
  ['drizzle.config.ts / drizzle/', 'Database migration configuration and committed SQL migration history.'],
  ['.env / .env.example', 'Private local runtime values versus a shareable settings template. Never distribute the real .env.'],
  ['Dockerfile / docker-entrypoint.sh', 'Image build, runtime permission/setup checks, migration, seed, and start sequence.'],
  ['compose.production.yaml', 'Application container, private runtime values, persistent data mount, Cloudflare Tunnel service.'],
  ['compose.firebase.yaml', 'Optional read-only Firebase service-account mount and in-container credential path.'],
  ['.github/workflows/docker-publish.yml', 'Conditional image build/publication workflow. Does not establish that a managed server pulled the image.'],
  ['capacitor.config.ts', 'Native app identity, bundled assets directory, and selected server configuration.'],
  ['mobile-www/index.html', 'Packaged bootstrap/fallback HTML; not a complete offline copy of server/database features.'],
  ['android/app/src/main/AndroidManifest.xml', 'Native permissions, activity/service declarations, special-use overlay foreground service, network policy.'],
  ['android/app/src/main/res', 'Launcher assets, four-dot vector, network/file-provider resources. Generated build outputs are not source.'],
  ['android/app/google-services.json', 'Android Firebase project configuration; private server signing credential is a different file.'],
  ['static/', 'Public images and other served assets. Never place private JSON keys or database files here.'],
  ['playwright*.config.ts / tests/', 'Isolated test servers, mock external dependencies, and API/browser policy checks.'],
  ['docs/', 'Setup, database, AI, Android, and push notes. Historical descriptions can lag current source.'],
  ['android/app/build/outputs/apk/debug/app-debug.apk', 'Generated installable debug APK. Rebuild native changes; do not edit generated Java output.']
]) appendix += `| ${file} | ${purpose} |\n`;
const md = fs.readFileSync(source, 'utf8') + appendix;
fs.writeFileSync(path.join(out, 'HandLink-System-Defense-Guide-complete.md'), md);
const commit = cp.execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const cover = [
  new Paragraph({ text: 'HANDLINK', heading: HeadingLevel.TITLE, spacing: { before: 1800, after: 260 } }),
  new Paragraph({ text: 'System walkthrough & defense guide', heading: HeadingLevel.SUBTITLE }),
  new Paragraph({ text: 'Read the code. Trace the request. Explain the reason.', spacing: { before: 500, after: 400 } }),
  new Paragraph({ text: 'Prepared 19 October 2026 · Asia/Manila' }),
  new Paragraph({ text: `Source snapshot: ${commit}, plus current workspace changes.` }),
  new Paragraph({ text: 'Local implementation guide. Public deployment and physical-device behavior may differ.' }),
  new Paragraph({ text: 'Short sentences. Detailed coverage. One moving part per lesson.', spacing: { before: 500 } })
];
const doc = new Document({
  creator: 'HandLink project documentation', title: 'HandLink System Walkthrough and Defense Guide',
  subject: 'Code-grounded role workflows, architecture, flowcharts, and defense preparation',
  description: 'Teaching guide generated from the HandLink repository. No private environment values or credentials included.',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22, color: '23342e' }, paragraph: { spacing: { after: 120, line: 276 } } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 52, bold: true, color: '194c3c' } },
      { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', run: { size: 32, color: '497963' } },
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: '194c3c' }, paragraph: { keepNext: true, spacing: { before: 100, after: 240 } } },
      { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '315f4d' }, paragraph: { keepNext: true, spacing: { before: 220, after: 100 } } },
      { id: 'Code', name: 'Code', basedOn: 'Normal', paragraph: { spacing: { before: 0, after: 0, line: 240 }, shading: { fill: 'F0F3F1', type: ShadingType.CLEAR }, indent: { left: 120, right: 100 } } },
      { id: 'Defense', name: 'Defense answer', basedOn: 'Normal', run: { italics: true, color: '194c3c' }, paragraph: { indent: { left: 180 }, border: { left: { color: '76A38E', size: 15, space: 8, style: BorderStyle.SINGLE } } } },
      { id: 'Caption', name: 'Caption', basedOn: 'Normal', run: { size: 20, italics: true, color: '526c5d' }, paragraph: { keepNext: true, spacing: { before: 180, after: 100 } } },
      { id: 'TableBody', name: 'Table body', basedOn: 'Normal', run: { size: 18 }, paragraph: { spacing: { after: 0, line: 240 } } },
      { id: 'TableHeader', name: 'Table header', basedOn: 'TableBody', run: { size: 18, bold: true } }
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1000, bottom: 1000, left: 1080, right: 1080 } } },
    headers: { default: new Header({ children: [new Paragraph({ text: 'HANDLINK  |  Code, workflows, defense', style: 'Caption' })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'HandLink guide  ·  ', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
    children: [...cover,
      new Paragraph({ text: 'Contents', heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
      new TableOfContents('Lessons and reference sections', { hyperlink: true, headingStyleRange: '1-1' }),
      ...parseMarkdown(md)]
  }]
});
(async () => {
  const file = path.join(out, 'HandLink-System-Defense-Guide.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(file, buffer);
  const meta = { file: rel(file), bytes: buffer.length, diagrams: diagramCount, words: md.split(/\s+/).length, chapters: (md.match(/^## /gm) || []).length, commit };
  fs.writeFileSync(path.join(out, 'build-summary.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
