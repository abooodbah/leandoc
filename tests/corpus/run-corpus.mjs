#!/usr/bin/env node
// Runs leandoc-inspect --time on every cached corpus file and prints a
// summary table. Fails on a crash, a run over 10 s, or an error code the
// manifest does not expect. Files over 2 s are reported.
//
// Usage: node tests/corpus/run-corpus.mjs [--inspect PATH] [--markdown]
// The inspect path can also come from LEANDOC_INSPECT. Without either, the
// script looks in build/*/tools/inspect/.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "..", "..");
const cacheRoot = join(here, "cache");
const hangMilliseconds = 10_000;
const slowMilliseconds = 2_000;
const markdown = process.argv.includes("--markdown");

function findInspect() {
  const flag = process.argv.indexOf("--inspect");
  if (flag >= 0 && process.argv[flag + 1]) {
    return resolve(process.argv[flag + 1]);
  }
  if (process.env.LEANDOC_INSPECT) {
    return resolve(process.env.LEANDOC_INSPECT);
  }
  const executable = process.platform === "win32" ? "leandoc-inspect.exe" : "leandoc-inspect";
  const build = join(repository, "build");
  if (existsSync(build)) {
    for (const entry of readdirSync(build).sort()) {
      for (const candidate of [
        join(build, entry, "tools", "inspect", executable),
        join(build, entry, "tools", "inspect", "Release", executable),
      ]) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  throw new Error("leandoc-inspect not found; pass --inspect PATH or set LEANDOC_INSPECT");
}

const inspect = findInspect();
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const rows = [];
let failures = 0;
let missing = 0;

for (const file of manifest.files) {
  const path = join(cacheRoot, file.name);
  if (!existsSync(path)) {
    missing += 1;
    continue;
  }
  const run = spawnSync(inspect, ["--time", path], {
    encoding: "utf8",
    timeout: hangMilliseconds,
    maxBuffer: 64 * 1024 * 1024,
  });
  const row = { name: file.name, kind: "", ok: "", errorCode: "", features: "", ms: "", status: "pass" };
  if (run.error?.code === "ETIMEDOUT" || run.signal === "SIGTERM") {
    row.status = "FAIL: over 10 s";
  } else if (run.error || run.signal || run.status !== 0) {
    row.status = `FAIL: crashed (${run.error?.message ?? run.signal ?? `exit ${run.status}`})`;
  } else {
    try {
      const report = JSON.parse(run.stdout.trim().split("\n")[0]);
      row.kind = report.kind;
      row.ok = report.ok ? "yes" : "no";
      row.errorCode = report.errorCode;
      row.features = report.features.map((feature) => `${feature.code} ${feature.count}`).join(", ");
      row.ms = report.ms;
      if (report.errorCode !== (file.expectedErrorCode ?? "")) {
        row.status = `FAIL: expected "${file.expectedErrorCode ?? ""}"`;
      } else if (report.ms > slowMilliseconds) {
        row.status = "pass (slow)";
      }
    } catch (error) {
      row.status = `FAIL: unreadable report (${error.message})`;
    }
  }
  if (row.status.startsWith("FAIL")) {
    failures += 1;
  }
  rows.push(row);
}

const columns = ["name", "kind", "ok", "errorCode", "features", "ms", "status"];
if (markdown) {
  console.log(`| ${columns.join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    console.log(`| ${columns.map((column) => String(row[column]).replaceAll("|", "\\|")).join(" | ")} |`);
  }
} else {
  const widths = columns.map((column) =>
    Math.min(60, Math.max(column.length, ...rows.map((row) => String(row[column]).length))));
  const line = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join("  ");
  console.log(line(columns));
  for (const row of rows) {
    console.log(line(columns.map((column) => row[column])));
  }
}

const times = rows.map((row) => Number(row.ms)).filter((value) => Number.isFinite(value) && value > 0);
const slowest = times.length ? Math.max(...times) : 0;
console.log(
  `\n${rows.length} files run, ${failures} failed, ${missing} not fetched; ` +
    `slowest ${slowest.toFixed(1)} ms; inspect: ${inspect}`);
process.exit(failures === 0 && rows.length > 0 ? 0 : 1);
