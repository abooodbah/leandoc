// CI helper: keeps a copy of each step's output and, when a job fails, turns
// the useful part of it into GitHub annotations, which stay readable through
// the REST API (check-runs/<job>/annotations) where raw logs may not be.
//
//   node scripts/ci-log.mjs run <log-file> [--timeout SECONDS] -- <command> [arguments...]
//   node scripts/ci-log.mjs annotate <log-file> [title]
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [mode, logFile, ...rest] = process.argv.slice(2);

function usage() {
  console.error("Usage: ci-log.mjs run <log> [--timeout SECONDS] -- <command> [args...] | annotate <log> [title]");
  process.exit(2);
}

if (mode === "run") {
  const separator = rest.indexOf("--");
  const command = separator === -1 ? rest : rest.slice(separator + 1);
  const options = separator === -1 ? [] : rest.slice(0, separator);
  const timeoutIndex = options.indexOf("--timeout");
  const timeoutSeconds = timeoutIndex === -1 ? 0 : Number(options[timeoutIndex + 1]);
  if (!logFile || command.length === 0 || !(timeoutSeconds >= 0)) {
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
  // A step timeout does not always stop a Windows process that is stuck in a
  // native call, so the wrapper ends the whole tree itself and says where.
  let timedOut = false;
  if (timeoutSeconds > 0) {
    setTimeout(() => {
      timedOut = true;
      const message = `\nci-log: timed out after ${timeoutSeconds} s; stopping ${command[0]} and its process tree\n`;
      appendFileSync(logFile, message);
      console.error(message.trim());
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "inherit" });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutSeconds * 1000).unref();
  }
  child.on("close", (code, signal) => {
    if (timedOut) {
      process.exit(124);
    }
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
  // Colour codes from pwsh and compilers would only clutter the annotation.
  const lines = readFileSync(logFile, "utf8")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .split("\n");
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
  // Compiler command lines are long and rarely the cause; keep lines short.
  const firstPart = picked.filter((index) => lines[index].length < 1000).slice(0, 150);
  const tail = [];
  for (let index = Math.max(0, lines.length - 150); index < lines.length; index += 1) {
    tail.push(index);
  }
  const chunks = [];
  const render = (indices) => indices.sort((a, b) => a - b)
    .map((index) => (lines[index].length > 300 ? `${lines[index].slice(0, 300)} ...` : lines[index]))
    .join("\n");
  // GitHub keeps only the first 4,096 characters of an annotation message.
  const pushChunks = (label, text) => {
    const size = 4096 - label.length - 16;
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
