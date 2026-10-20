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
// The API returns at most 4,096 characters of a notice (and a title ends at
// its first comma), so the text goes out in parts of whole lines, at most
// eight of them.
const parts = [];
let part = "";
for (const line of body.split("\n")) {
  if (part.length + line.length + 1 > 4000 && part) {
    parts.push(part);
    part = "";
  }
  part += (part ? "\n" : "") + line.slice(0, 4000);
}
if (part) {
  parts.push(part);
}
const label = title.replace(/,/g, " ");
parts.slice(0, 8).forEach((text, index) => {
  const name = parts.length > 1 ? `${label} part ${index + 1} of ${Math.min(parts.length, 8)}` : label;
  console.log(`::notice title=${name}::${text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
});
