#!/usr/bin/env node
// Checks the LeanDoc site with Node.js built-ins only, in the style of
// LeanRows' site/validate.mjs:
//
//   node site/validate.mjs
//
// It checks the page structure, links and local assets, alt text, scripts,
// the writing rules, the version against package.json, and every release
// asset name against the names .github/workflows/build.yml publishes.
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(siteRoot, "..");
const failures = [];
const fail = (message) => failures.push(message);
function requireMatch(value, pattern, message) {
  if (!pattern.test(value)) fail(message);
}

const html = await readFile(resolve(siteRoot, "index.html"), "utf8");
const css = await readFile(resolve(siteRoot, "styles.css"), "utf8");
const version = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")).version;
const tag = `v${version}`;
const workflow = await readFile(resolve(repoRoot, ".github/workflows/build.yml"), "utf8");

// --- Required files ----------------------------------------------------------

const required = [
  ".nojekyll",
  "index.html",
  "styles.css",
  "robots.txt",
  "sitemap.xml",
  "site.webmanifest",
  "assets/leandoc-icon.png",
  "assets/leandoc-icon.svg",
  "assets/leandoc-window.png",
  "assets/leandoc-fidelity-bar.png",
  "assets/social-preview.png",
];
for (const file of required) {
  try {
    if (!(await stat(resolve(siteRoot, file))).isFile()) fail(`required path is not a file: ${file}`);
  } catch {
    fail(`missing required site file: ${file}`);
  }
}

// --- Document structure -------------------------------------------------------

requireMatch(html, /^<!doctype html>/i, "index.html must start with an HTML5 doctype");
requireMatch(html, /<html\s+lang="en">/i, "the document language must be declared");
requireMatch(html, /<meta\s+charset="utf-8">/i, "the character set must be declared");
requireMatch(html, /<meta\s+name="viewport"/i, "the viewport meta tag is required");
requireMatch(html, /<meta\s+name="description"\s+content="[^"]{40,}"/i, "a meta description is required");
requireMatch(html, /<title>[^<]*LeanDoc[^<]*<\/title>/i, "the title must name LeanDoc");
requireMatch(html, /<link\s+rel="canonical"\s+href="https:\/\/abooodbah\.github\.io\/leandoc\/">/i,
  "the canonical URL must be https://abooodbah.github.io/leandoc/");
requireMatch(html, /<meta\s+property="og:image"\s+content="https:\/\/abooodbah\.github\.io\/leandoc\/assets\/social-preview\.png">/i,
  "the Open Graph image must be the social preview");
requireMatch(html, /<main\s+id="main-content">/i, "a named main landmark is required");
requireMatch(html, /class="skip-link"\s+href="#main-content"/i, "a skip link to the main content is required");
requireMatch(html, /Read the document, not the office suite\./, "the hero must state the promise");
requireMatch(html, /<figcaption>[^<]*Linux build[^<]*real capture/i,
  "the hero screenshot caption must say it is a real capture of the Linux build");
requireMatch(html, /href="https:\/\/abooodbah\.github\.io\/leanmark\/"/, "the family section must link the LeanMark site");
requireMatch(html, /href="https:\/\/abooodbah\.github\.io\/leanrows\/"/, "the family section must link the LeanRows site");
requireMatch(html, /unsigned/i, "the unsigned Windows build must be disclosed");
requireMatch(html, /not notarized/i, "the macOS preview must say it is not notarized");
requireMatch(html, /<section class="section" id="privacy-policy" aria-labelledby="privacy-policy-heading">/,
  "the privacy policy section must keep its #privacy-policy anchor");
requireMatch(html, /<h2 id="privacy-policy-heading">Privacy policy<\/h2>/,
  "the page must have a section titled Privacy policy");
if (/signpath/i.test(html)) {
  fail("the SignPath Foundation application was declined; the page must not claim SignPath signing");
}
requireMatch(html, /This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it\./,
  "the privacy policy must state the privacy sentence");
requireMatch(html, /Pending review in winget; until then, download from/,
  "winget must be marked as pending review");

const h1Count = (html.match(/<h1\b/gi) ?? []).length;
if (h1Count !== 1) fail(`expected exactly one h1; found ${h1Count}`);

// --- Version and structured data ----------------------------------------------

const structured = html.match(/<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i);
if (!structured) {
  fail("SoftwareApplication JSON-LD is required");
} else {
  try {
    const data = JSON.parse(structured[1]);
    if (data["@type"] !== "SoftwareApplication" || data.name !== "LeanDoc") {
      fail("JSON-LD must describe the LeanDoc SoftwareApplication");
    }
    if (data.softwareVersion !== version) {
      fail(`JSON-LD softwareVersion is ${data.softwareVersion}; package.json is ${version}`);
    }
    if (data.downloadUrl !== `https://github.com/abooodbah/leandoc/releases/tag/${tag}`) {
      fail(`JSON-LD downloadUrl must be the ${tag} release page`);
    }
  } catch (error) {
    fail(`JSON-LD must contain valid JSON: ${error.message}`);
  }
}
for (const match of html.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)) {
  if (match[1] !== version) fail(`the page names v${match[1]}; package.json is ${version}`);
}
if (!html.includes(`${tag} ·`)) fail(`the release line must name ${tag}`);

// --- Release asset names ---------------------------------------------------------

const expectedBlock = workflow.match(/expected=\(\s*([\s\S]*?)\)/);
const workflowAssets = expectedBlock
  ? [...expectedBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace("${LEANDOC_VERSION}", version))
  : [];
if (workflowAssets.length !== 7) {
  fail(`could not read the seven release assets from build.yml; found ${workflowAssets.length}`);
}
const mentioned = [...html.matchAll(/LeanDoc-v[0-9A-Za-z.]+-(?:windows|linux|macos)[0-9A-Za-z._-]*/g)]
  .map((m) => m[0].replace(/[.]+$/, ""));
for (const name of mentioned) {
  if (!workflowAssets.includes(name)) fail(`the page names ${name}, which build.yml does not publish`);
}
const downloadBase = `https://github.com/abooodbah/leandoc/releases/download/${tag}/`;
for (const asset of workflowAssets.filter((name) => /\.(zip|deb)$/.test(name))) {
  if (!html.includes(`href="${downloadBase}${asset}"`)) {
    fail(`the page must link the release asset ${downloadBase}${asset}`);
  }
}
for (const match of html.matchAll(/href="(https:\/\/github\.com\/abooodbah\/leandoc\/releases\/download\/[^"]+)"/g)) {
  const asset = match[1].slice(downloadBase.length);
  if (!match[1].startsWith(downloadBase) || !workflowAssets.includes(asset)) {
    fail(`download link does not point at a ${tag} release asset: ${match[1]}`);
  }
}

// --- Links, assets, images, and scripts -----------------------------------------

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const match of html.matchAll(/href="#([^"]*)"/g)) {
  if (!ids.has(match[1])) fail(`same-page link has no target: #${match[1]}`);
}

async function checkLocal(value, from) {
  if (/^(?:https?:|mailto:|data:|#)/i.test(value)) return;
  const path = resolve(siteRoot, value.split(/[?#]/, 1)[0]);
  if (path !== siteRoot && !path.startsWith(siteRoot + sep)) {
    fail(`${from}: local reference escapes site/: ${value}`);
    return;
  }
  try {
    if (!(await stat(path)).isFile()) fail(`${from}: local reference is not a file: ${value}`);
  } catch {
    fail(`${from}: missing local reference: ${value}`);
  }
}
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) await checkLocal(match[1], "index.html");
for (const match of css.matchAll(/url\("?([^")]+)"?\)/g)) await checkLocal(match[1], "styles.css");
const manifest = JSON.parse(await readFile(resolve(siteRoot, "site.webmanifest"), "utf8"));
for (const icon of manifest.icons ?? []) await checkLocal(icon.src, "site.webmanifest");
if (manifest.name !== "LeanDoc") fail("site.webmanifest must name LeanDoc");

const allowedHosts = new Set(["https://github.com", "https://abooodbah.github.io", "https://opensource.org", "https://schema.org"]);
for (const match of html.matchAll(/(?:href|src|content)="(https?:\/\/[^"/]+)/g)) {
  if (!allowedHosts.has(match[1])) fail(`unexpected external host: ${match[1]}`);
}
for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
  if (!/type="application\/ld\+json"/i.test(match[1])) {
    fail(`only the JSON-LD block may be a script; found <script${match[1]}>`);
  }
}
if (/@import\s+url\(\s*["']?https?:/i.test(css) || /url\(\s*["']?https?:/i.test(css)) {
  fail("styles.css must not load anything from another host");
}

for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
  const attributes = match[1];
  const alt = attributes.match(/\salt="([^"]*)"/);
  const src = attributes.match(/\ssrc="([^"]+)"/)?.[1] ?? "(no src)";
  if (!alt) {
    fail(`image has no alt attribute: ${src}`);
    continue;
  }
  const decorative = /leandoc-icon\.(svg|png)$/.test(src);
  if (!decorative && alt[1].trim().length < 20) fail(`image needs descriptive alt text: ${src}`);
  if (!/\swidth="\d+"/.test(attributes) || !/\sheight="\d+"/.test(attributes)) {
    fail(`image needs width and height attributes: ${src}`);
  }
  if (src.endsWith(".png")) {
    try {
      const png = await readFile(resolve(siteRoot, src));
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      const declared = [attributes.match(/\swidth="(\d+)"/)?.[1], attributes.match(/\sheight="(\d+)"/)?.[1]].map(Number);
      if (!src.includes("icon") && (declared[0] !== width || declared[1] !== height)) {
        fail(`${src} is ${width}x${height} but the page declares ${declared[0]}x${declared[1]}`);
      }
    } catch (error) {
      fail(`${src} could not be inspected: ${error.message}`);
    }
  }
}
try {
  const preview = await readFile(resolve(siteRoot, "assets/social-preview.png"));
  if (preview.readUInt32BE(16) !== 1280 || preview.readUInt32BE(20) !== 640) {
    fail("assets/social-preview.png must be 1280x640");
  }
} catch {
  // Reported above as a missing required file.
}

// --- Search engine files -----------------------------------------------------------

const robots = await readFile(resolve(siteRoot, "robots.txt"), "utf8").catch(() => "");
requireMatch(robots, /^Sitemap: https:\/\/abooodbah\.github\.io\/leandoc\/sitemap\.xml$/m,
  "robots.txt must name the sitemap");
const sitemap = await readFile(resolve(siteRoot, "sitemap.xml"), "utf8").catch(() => "");
requireMatch(sitemap, /<loc>https:\/\/abooodbah\.github\.io\/leandoc\/<\/loc>/, "sitemap.xml must list the site URL");

// --- Accessibility and responsive CSS --------------------------------------------------

requireMatch(css, /:focus-visible\s*\{[^}]*outline:/s, "visible focus styles are required");
requireMatch(css, /prefers-reduced-motion:\s*reduce/i, "reduced-motion support is required");
requireMatch(css, /prefers-color-scheme:\s*dark/i, "dark appearance support is required");
requireMatch(css, /@media\s*\(max-width:\s*68rem\)/i, "tablet layout rules are required");
requireMatch(css, /@media\s*\(max-width:\s*52rem\)/i, "phone layout rules are required");

// --- Writing rules over every text file in site/ ---------------------------------------

// Built from parts so this file does not contain the phrases it bans.
const join = (...parts) => parts.join("");
const banned = [
  join("ultra", "-lightweight"), join("blazing", " fast"), join("zero", " dependency"),
  join("zero", "-dependency"), join("completely", " secure"), join("no network", " access"),
  "lorem ipsum", "TODO", "TBD",
];
const attribution = [join("Co-Authored", "-By"), join("Claude", "-Session"), join("Generated", " with")];
const textTypes = new Set([".html", ".css", ".mjs", ".md", ".txt", ".xml", ".webmanifest", ".svg"]);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}
for (const path of await walk(siteRoot)) {
  if (!textTypes.has(extname(path))) continue;
  const name = relative(siteRoot, path);
  const text = await readFile(path, "utf8");
  if (text.includes("\u2014")) fail(`${name} contains an em dash`);
  if (name === "validate.mjs") continue;
  const lower = text.toLowerCase();
  for (const phrase of banned) {
    const hit = phrase === phrase.toUpperCase() ? text.includes(phrase) : lower.includes(phrase.toLowerCase());
    if (hit) fail(`${name} uses the banned phrase "${phrase}"`);
  }
  for (const marker of attribution) {
    if (lower.includes(marker.toLowerCase())) fail(`${name} contains attribution (${marker})`);
  }
  if (/\bsecure\b/i.test(text)) fail(`${name} claims "secure"; state what the code does instead`);
}

if (failures.length > 0) {
  console.error("LeanDoc site validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`LeanDoc site validation passed for ${tag} (structure, links, assets, release names, and wording).`);
}
