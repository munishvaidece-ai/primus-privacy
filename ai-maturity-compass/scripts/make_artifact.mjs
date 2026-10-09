#!/usr/bin/env node
/**
 * Reshape the single-file Vite build (dist-artifact/index.html) into the page an Artifact publish expects:
 * no <!doctype>/<html>/<head>/<body> of its own — a <title>, the inlined <style>, the mount node, then the inlined script.
 * Output: dist-artifact/artifact.html
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist-artifact', 'index.html');
const out = join(root, 'dist-artifact', 'artifact.html');
const html = readFileSync(src, 'utf8');

const take = (re) => [...html.matchAll(re)].map((m) => m[0]);
const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || 'AI Maturity Compass';
const styles = take(/<style\b[^>]*>[\s\S]*?<\/style>/g);
const scripts = take(/<script\b[^>]*>[\s\S]*?<\/script>/g);
const external = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](?!data:|#)[^"']+["'][^>]*>/g)].map((m) => m[0]).filter((t) => !/rel=["']icon["']/.test(t));

if (styles.length === 0 || scripts.length === 0) throw new Error('single-file build is missing inlined CSS or JS');
if (external.length) throw new Error('build still references external resources: ' + external.join(' | ').slice(0, 300));
const mount = /<div id="root"><\/div>/.test(html) ? '<div id="root"></div>' : null;
if (!mount) throw new Error('mount node #root not found');

const page = `<title>${title}</title>\n${styles.join('\n')}\n${mount}\n${scripts.join('\n')}\n`;
writeFileSync(out, page);
console.log(`wrote ${out} — ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB, ${styles.length} style block(s), ${scripts.length} script(s)`);
