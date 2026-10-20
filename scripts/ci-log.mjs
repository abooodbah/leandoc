// CI helper: keeps a copy of each step's output and, when a job fails, turns
// the useful part of it into GitHub annotations, which stay readable through
// the REST API (check-runs/<job>/annotations) where raw logs may not be.
//
//   node scripts/ci-log.mjs run <log-file> -- <command> [arguments...]
//   node scripts/ci-log.mjs annotate <log-file> [title]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [mode, logFile, ...rest] = process.argv.slice(2);

function usage() {
  console.error("Usage: ci-log.mjs run <log> -- <command> [args...] | annotate <log> [title]");
  process.exit(2);
}

if (mode === "run") {
  const separator = rest.indexOf("--");
  const command = separator === -1 ? rest : rest.slice(separator + 1);
  if (!logFile || command.length === 0) {
    usage();
  }
  appendFileSync(logFile, `\n### ${command.join(" ")}\n`);
  const child = spawn(command[0], command.slice(1), {
    stdio: ["inherit", "pipe", "pipe"],
    shell: false
  });
  const copy = (target) => (chunk) => {
    target.write(chunk);
    appendFileSync(logFile, chunk);
  };
  child.stdout.on("data", copy(process.stdout));
  child.stderr.on("data", copy(process.stderr));
  child.on("error", (error) => {
    appendFileSync(logFile, `\nci-log: could not start ${command[0]}: ${error.message}\n`);
    console.error(`ci-log: could not start ${command[0]}: ${error.message}`);
    process.exit(127);
  });
  child.on("close", (code, signal) => {
    if (code !== 0) {
      appendFileSync(logFile, `\nci-log: exit ${code ?? signal}\n`);
    }
    process.exit(code ?? 1);
  });
} else if (mode === "annotate") {
  if (!logFile) {
    usage();
  }
  const title = rest[0] || "Failure log";
  if (!existsSync(logFile)) {
    console.log(`::error title=${title}::No log was captured at ${logFile}.`);
    process.exit(0);
  }
  const lines = readFileSync(logFile, "utf8").replace(/\r/g, "").split("\n");
  // Lines that usually name the cause, then the tail of the log.
  const interesting = /\b(error|errors|fail|failed|failure|fatal|exception|denied|not found|cannot|could not|missing|warning C\d+|FAIL)\b/i;
  const picked = [];
  const seen = new Set();
  const add = (index) => {
    if (index >= 0 && index < lines.length && !seen.has(index)) {
      seen.add(index);
      picked.push(index);
    }
  };
  lines.forEach((line, index) => {
    if (interesting.test(line) || line.startsWith("### ")) {
      add(index);
    }
  });
  const firstPart = picked.slice(0, 150);
  const tail = [];
  for (let index = Math.max(0, lines.length - 120); index < lines.length; index += 1) {
    tail.push(index);
  }
  const chunks = [];
  const render = (indices) => indices.sort((a, b) => a - b).map((index) => lines[index]).join("\n");
  const pushChunks = (label, text) => {
    const size = 6000;
    for (let offset = 0; offset < text.length && chunks.length < 9; offset += size) {
      chunks.push(`${label}\n${text.slice(offset, offset + size)}`);
    }
  };
  pushChunks("Matching lines:", render(firstPart));
  pushChunks("Last lines:", render(tail));
  const escape = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  chunks.forEach((chunk, index) => {
    console.log(`::error title=${title} (${index + 1}/${chunks.length})::${escape(chunk)}`);
  });
} else {
  usage();
}
