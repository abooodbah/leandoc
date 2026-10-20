// A fake LeanDoc host for the reader tests. It serves the staged reader at
// https://app.leandoc.invalid/, answers /pkg/<tab>/<generation>/document.docx
// from memory, aborts and records every other request, implements the
// WebView2 bridge, and delivers host messages the way the real hosts do.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright-core");

export const ORIGIN = "https://app.leandoc.invalid";
export const READER_URL = `${ORIGIN}/reader.html`;
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json"
};
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function findChromium() {
  if (process.env.LEANDOC_CHROMIUM) {
    return process.env.LEANDOC_CHROMIUM;
  }
  const playwrightRoot = "/opt/pw-browsers";
  if (existsSync(playwrightRoot)) {
    const builds = readdirSync(playwrightRoot)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((left, right) => Number(right.split("-")[1]) - Number(left.split("-")[1]));
    for (const build of builds) {
      const candidate = path.join(playwrightRoot, build, "chrome-linux", "chrome");
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (found) {
        return found;
      }
    } catch {
      // Try the next name.
    }
  }
  throw new Error("No Chromium found. Set LEANDOC_CHROMIUM to a Chromium or Chrome binary.");
}

export function stageAssets() {
  const destination = mkdtempSync(path.join(os.tmpdir(), "leandoc-reader-assets-"));
  execFileSync(process.execPath, [path.join(repositoryRoot, "scripts", "stage-runtime-assets.mjs"), destination], {
    stdio: "pipe"
  });
  return destination;
}

export async function launchBrowser() {
  return chromium.launch({
    executablePath: findChromium(),
    args: ["--disable-gpu", "--font-render-hinting=none", "--disable-lcd-text"]
  });
}

// The init script runs before the reader's own scripts, as the real hosts'
// bridges do. It also records Content Security Policy violations.
const INIT_SCRIPT = `(() => {
  window.__cspViolations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    window.__cspViolations.push({
      directive: event.violatedDirective,
      blocked: event.blockedURI,
      sample: event.sample || ""
    });
  });
  const listeners = [];
  const webview = {
    postMessage(message) { window.__leandocPost(message); },
    addEventListener(type, listener) { if (type === "message") listeners.push(listener); },
    removeEventListener(type, listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
  window.chrome = window.chrome || {};
  Object.defineProperty(window.chrome, "webview", { value: webview, configurable: false });
  window.__leandocWebMessage = (data) => listeners.forEach((listener) => listener({ data }));
})();`;

export class FakeHost {
  constructor(page, assetsDirectory, options) {
    this.page = page;
    this.assetsDirectory = assetsDirectory;
    this.options = options;
    this.messages = [];
    this.offOrigin = [];
    this.requests = [];
    this.packages = new Map();
    this.waiters = [];
    this.consoleErrors = [];
  }

  static async open(browser, assetsDirectory, options = {}) {
    const settings = {
      platform: "windows",
      version: "0.1.0",
      editor: { kind: "word", label: "Word" },
      tabs: true,
      theme: "light",
      view: "page",
      viewport: { width: 1280, height: 860 },
      colorScheme: "light",
      handshake: true,
      ...options
    };
    const context = await browser.newContext({
      viewport: settings.viewport,
      colorScheme: settings.colorScheme,
      deviceScaleFactor: settings.deviceScaleFactor || 1,
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    const host = new FakeHost(page, assetsDirectory, settings);
    host.context = context;
    await page.exposeBinding("__leandocPost", (_source, text) => host.receive(text));
    await page.addInitScript(INIT_SCRIPT);
    page.on("console", (message) => {
      if (message.type() === "error") {
        host.consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => host.consoleErrors.push(String(error)));
    await page.route("**/*", (route) => host.route(route));
    const ready = host.waitFor((message) => message.type === "ready");
    await page.goto(READER_URL);
    await ready;
    if (settings.handshake) {
      await host.send({
        type: "host",
        platform: settings.platform,
        version: settings.version,
        editor: settings.editor,
        tabs: settings.tabs
      });
      await host.send({ type: "theme", theme: settings.theme, view: settings.view });
    }
    return host;
  }

  async close() {
    await this.context.close();
  }

  async route(route) {
    const request = route.request();
    const url = new URL(request.url());
    this.requests.push(url.href);
    if (url.origin !== ORIGIN) {
      this.offOrigin.push(url.href);
      return route.abort("blockedbyclient");
    }
    if (url.pathname.startsWith("/pkg/")) {
      const entry = this.packages.get(url.pathname);
      if (!entry) {
        return route.fulfill({ status: 404, body: "" });
      }
      if (entry.delay) {
        await new Promise((resolve) => setTimeout(resolve, entry.delay));
      }
      return route.fulfill({ status: 200, body: entry.bytes, contentType: DOCX_TYPE });
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(this.assetsDirectory, relative);
    if (!file.startsWith(this.assetsDirectory + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fulfill({
      status: 200,
      body: readFileSync(file),
      contentType: CONTENT_TYPES[path.extname(file)] || "application/octet-stream"
    });
  }

  receive(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      message = { type: "invalid", raw: text };
    }
    this.messages.push(message);
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  }

  waitFor(predicate, timeout = 15000, { includePast = false } = {}) {
    if (includePast) {
      const found = this.messages.find(predicate);
      if (found) {
        return Promise.resolve(found);
      }
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for a reader message. Received: ${JSON.stringify(this.messages.slice(-8))}`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  ofType(type) {
    return this.messages.filter((message) => message.type === type);
  }

  // How every real host delivers a message: a "leandoc-message" event on
  // window whose detail is the message object.
  async send(message) {
    await this.page.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent("leandoc-message", { detail }));
    }, message);
  }

  async sendViaReceive(message) {
    await this.page.evaluate((detail) => window.LeanDocHost.receive(detail), message);
  }

  async sendViaWebMessage(message) {
    await this.page.evaluate((detail) => window.__leandocWebMessage(detail), message);
  }

  addPackage(tab, generation, bytes, delay = 0) {
    const pathname = `/pkg/${tab}/${generation}/document.docx`;
    this.packages.set(pathname, { bytes, delay });
    return `${ORIGIN}${pathname}`;
  }

  // Sends a document message and resolves with the reader's rendered message.
  async openDocument({ tab = 1, generation = 1, bytes, report, fileName = "document.docx", displayPath, delay = 0, wait = true }) {
    const packageUrl = this.addPackage(tab, generation, bytes, delay);
    const rendered = wait
      ? this.waitFor((message) =>
        (message.type === "rendered" || message.type === "renderFailed") &&
        message.tab === tab && message.generation === generation, 30000)
      : null;
    await this.send({
      type: "document",
      tab,
      generation,
      fileName,
      displayPath: displayPath || `C:\\Users\\reader\\Documents\\${fileName}`,
      packageUrl,
      report
    });
    if (!wait) {
      return null;
    }
    const result = await rendered;
    if (result.type === "renderFailed") {
      throw new Error(`Render failed: ${result.message}`);
    }
    return result;
  }

  async cspViolations() {
    return this.page.evaluate(() => window.__cspViolations.slice());
  }
}

// Fixtures: cases.json names the fixture directory and the static reports in
// one place. With LEANDOC_INSPECT set, reports and sanitized packages come
// from the core's command-line tool instead.
export function loadCases() {
  const casesFile = path.join(repositoryRoot, "tests", "reader", "cases.json");
  const config = JSON.parse(readFileSync(casesFile, "utf8"));
  const fixtureDirectory = path.resolve(repositoryRoot, config.fixtureDir);
  const reportsFile = config.reportsFile ? path.resolve(repositoryRoot, config.reportsFile) : "";
  const reports = reportsFile && existsSync(reportsFile) ? JSON.parse(readFileSync(reportsFile, "utf8")) : {};
  return { config, fixtureDirectory, reports };
}

export function defaultReport(bytes) {
  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    kind: "docx",
    sourceBytes: bytes.length,
    features: [],
    outline: [],
    properties: { title: "", creator: "", rightToLeft: false }
  };
}

export function prepareFixture(fixtures, file, overrides = {}) {
  const absolute = path.resolve(fixtures.fixtureDirectory, file);
  const inspect = process.env.LEANDOC_INSPECT;
  if (inspect) {
    const lines = execFileSync(inspect, [absolute], { encoding: "utf8" }).trim().split("\n");
    const report = JSON.parse(lines[lines.length - 1]);
    const output = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-sanitized-")), "document.docx");
    execFileSync(inspect, ["--write-sanitized", output, absolute], { stdio: "pipe" });
    return { bytes: readFileSync(output), report: { ...report, ...overrides } };
  }
  const bytes = readFileSync(absolute);
  return {
    bytes,
    report: { ...defaultReport(bytes), ...(fixtures.reports[file] || {}), ...overrides }
  };
}
