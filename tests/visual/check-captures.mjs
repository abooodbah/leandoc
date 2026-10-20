// UI-01 checks on the Windows and macOS screenshots, run in CI right after
// the capture, so their result is readable from the job's annotations:
//   node tests/visual/check-captures.mjs <directory> <platform>
// Every feature fixture must have four captures (page and reading view,
// light and dark). Each capture must show something (not one flat colour),
// and the dark capture must be darker than the light one. The step prints a
// table of mean luminance and contrast, and a coarse text thumbnail of each
// page-view light capture, as notices, so the layout can be reviewed without
// downloading the artifact. Exits 1 on a failed check.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";

const [directory, platform = "unknown"] = process.argv.slice(2);
if (!directory) {
  console.error("Usage: check-captures.mjs <directory> <platform>");
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtures = readdirSync(path.join(root, "tests", "fixtures", "features"))
  .filter((name) => name.endsWith(".docx")).map((name) => name.slice(0, -5)).sort();
const variants = ["page-light", "page-dark", "reading-light", "reading-dark"];
const RAMP = " .:-=+*#%@";

function stats(image) {
  const { width, height, pixels } = image;
  let sum = 0;
  let squares = 0;
  const count = width * height;
  for (let i = 0; i < count; i += 1) {
    const value = 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
    sum += value;
    squares += value * value;
  }
  const mean = sum / count;
  return { width, height, mean, deviation: Math.sqrt(Math.max(0, squares / count - mean * mean)) };
}

// A text thumbnail of a light capture: the denser the ink (pixels darker
// than mid grey) in a cell, the darker its character.
function thumbnail(image, columns = 72, rows = 26) {
  const { width, height, pixels } = image;
  const lines = [];
  for (let row = 0; row < rows; row += 1) {
    let text = "";
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor(column * width / columns);
      const x1 = Math.floor((column + 1) * width / columns);
      const y0 = Math.floor(row * height / rows);
      const y1 = Math.floor((row + 1) * height / rows);
      let ink = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          if (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2] < 170) {
            ink += 1;
          }
          n += 1;
        }
      }
      // Text is thin: a cell a quarter covered with ink prints the darkest.
      const darkness = Math.min(0.999, 4 * ink / Math.max(1, n));
      text += RAMP[Math.min(RAMP.length - 1, Math.floor(darkness * RAMP.length))];
    }
    lines.push(text.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

function notice(title, body) {
  const escaped = body.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::notice title=${title}::${escaped}`);
}

const problems = [];
const rows = [];
const thumbnails = [];
const files = new Set(readdirSync(directory));
for (const fixture of fixtures) {
  const measured = {};
  for (const variant of variants) {
    const name = `${fixture}--${variant}.png`;
    if (!files.has(name)) {
      problems.push(`${name} missing`);
      continue;
    }
    const image = decodePng(readFileSync(path.join(directory, name)));
    measured[variant] = stats(image);
    if (measured[variant].deviation < 4) {
      problems.push(`${name} is one flat colour`);
    }
    if (variant === "page-light") {
      thumbnails.push(`${fixture} (${image.width}x${image.height})\n${thumbnail(image)}`);
    }
  }
  for (const view of ["page", "reading"]) {
    const light = measured[`${view}-light`];
    const dark = measured[`${view}-dark`];
    if (light && dark && dark.mean >= light.mean) {
      problems.push(`${fixture} ${view}: the dark capture is not darker (${dark.mean.toFixed(0)} vs ${light.mean.toFixed(0)})`);
    }
  }
  rows.push(`${fixture.padEnd(24)} ` + variants.map((variant) => measured[variant]
    ? `${measured[variant].mean.toFixed(0).padStart(3)}/${measured[variant].deviation.toFixed(0).padStart(2)}`
    : "  missing").join("  "));
}

const header = `${platform}: ${files.size} files, ${fixtures.length} fixtures x 4. ` +
  `Mean luminance / deviation per capture (${variants.join(", ")}).`;
console.log(header);
console.log(rows.join("\n"));
notice(`UI-01 ${platform} captures`, `${header}\n${rows.join("\n")}\n` +
  (problems.length ? `Problems:\n${problems.join("\n")}` : "Every capture present, none flat, every dark capture darker."));
// Annotations hold up to 64 KB; a few thumbnails per notice keeps each small.
for (let start = 0; start < thumbnails.length; start += 4) {
  notice(`UI-01 ${platform} page view, light (${start + 1}-${Math.min(thumbnails.length, start + 4)})`,
    thumbnails.slice(start, start + 4).join("\n\n"));
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
