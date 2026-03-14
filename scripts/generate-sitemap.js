#!/usr/bin/env node
// scripts/generate-sitemap.js
//
// Regenerates sitemap.xml from all blog article HTML files.
// Run from the repo root:
//
//   node scripts/generate-sitemap.js
//
// After running, commit the updated sitemap.xml.

'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_URL      = 'https://prooflink.co';
const ARTICLES_DIR  = path.join(__dirname, '..', 'blog', 'articles');
const SITEMAP_PATH  = path.join(__dirname, '..', 'sitemap.xml');
const TODAY         = new Date().toISOString().split('T')[0];

// ── Static public pages ────────────────────────────────────────────────────
const STATIC_PAGES = [
  { loc: '/',     priority: '1.0', changefreq: 'weekly'  },
  { loc: '/join', priority: '0.9', changefreq: 'monthly' },
  { loc: '/blog', priority: '0.9', changefreq: 'weekly'  },
];

// ── Discover all article HTML files ───────────────────────────────────────
const articleFiles = fs
  .readdirSync(ARTICLES_DIR)
  .filter(f => f.endsWith('.html'))
  .sort()
  .reverse(); // newest slug alphabetically first

const articleUrls = articleFiles.map(file => ({
  loc       : `/blog/articles/${file}`,
  priority  : '0.8',
  changefreq: 'monthly',
}));

// ── Build XML ──────────────────────────────────────────────────────────────
function urlEntry({ loc, priority, changefreq }) {
  return `
  <url>
    <loc>${BASE_URL}${loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <!-- ── Core public pages ──────────────────────────────────────────────── -->${STATIC_PAGES.map(urlEntry).join('')}

  <!-- ── Blog articles (${articleUrls.length} total) ──────────────────────────────────────── -->${articleUrls.map(urlEntry).join('')}

</urlset>
`;

fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
console.log(`✓ sitemap.xml updated — ${STATIC_PAGES.length} static + ${articleUrls.length} articles`);
console.log(`  Articles found:`);
articleFiles.forEach(f => console.log(`    /blog/articles/${f}`));
