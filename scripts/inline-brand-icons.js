// Writes the school logo straight into every page <head> as data URIs.
// Browsers then never need a separate /favicon.ico request, so the mark shows
// even on hosts (serverless CDNs) that mishandle static asset responses.
//
//   node scripts/inline-brand-icons.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VIEWS_DIR = path.join(ROOT, 'src', 'views');
const icons = require(path.join(ROOT, 'src', 'brand', 'brand-icons.js'));

const ICON_DATA_URI = `data:image/x-icon;base64,${icons.faviconIco.toString('base64')}`;
const SVG_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(icons.faviconSvg).toString('base64')}`;

const LINK_BLOCK = [
  `  <link rel="icon" href="${SVG_DATA_URI}" type="image/svg+xml">`,
  `  <link rel="icon" href="${ICON_DATA_URI}" sizes="any">`,
  '  <link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '  <meta name="theme-color" content="#1d4ed8">',
].join('\n');

const HEAD_LINK_PATTERN =
  /[ \t]*<link rel="icon"[^>]*>\n[ \t]*<link rel="icon"[^>]*>\n[ \t]*<link rel="apple-touch-icon"[^>]*>\n[ \t]*<meta name="theme-color"[^>]*>/;

let updated = 0;
for (const file of fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.html'))) {
  const full = path.join(VIEWS_DIR, file);
  let html = fs.readFileSync(full, 'utf8');
  if (!HEAD_LINK_PATTERN.test(html)) {
    console.log(`  skip ${file} (icon block not in expected shape)`);
    continue;
  }
  html = html.replace(HEAD_LINK_PATTERN, LINK_BLOCK);
  fs.writeFileSync(full, html);
  updated += 1;
  console.log(`  inlined logo into ${file}`);
}

console.log(`inline-brand-icons: ${updated} view(s) updated (${(LINK_BLOCK.length / 1024).toFixed(1)} KB per page)`);
