// Prints a results file (and, optionally, the log lines that match a
// pattern) as one GitHub notice, so a passing run's numbers are readable
// through the REST API (check-runs/<job>/annotations) like a failing one's:
//   node tests/perf/annotate-results.mjs <results.md> <title> [<log> <pattern>]
import { existsSync, readFileSync } from "node:fs";

const [file, title, log, pattern] = process.argv.slice(2);
if (!file || !title) {
  console.error("Usage: annotate-results.mjs <results.md> <title> [<log> <pattern>]");
  process.exit(2);
}
let body = existsSync(file) ? readFileSync(file, "utf8") : `${file} was not written.`;
if (log && pattern && existsSync(log)) {
  const expression = new RegExp(pattern);
  const lines = readFileSync(log, "utf8").split(/\r?\n/).filter((line) => expression.test(line));
  if (lines.length) {
    body += `\n${lines.join("\n")}`;
  }
}
// Annotations hold up to 64 KB.
body = body.slice(0, 60000);
console.log(`::notice title=${title}::${body.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
