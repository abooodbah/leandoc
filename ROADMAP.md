# LeanDoc roadmap

This is a direction, not a release promise. Correctness, safe handling of
untrusted documents, and the focused read-only experience come before new
features.

## 1. Content LeanDoc does not display yet

Text boxes, equations, charts, and SmartArt are named in the fidelity bar
today but not drawn. Each needs a renderer that stays inside the sanitized
package and the reader's Content Security Policy.

## 2. Word 97 to 2003 documents

`.doc` files get a fallback page in 0.1. A research spike will decide whether
a safe, bounded reader for the binary format is worth its size.

## 3. Pagination and printing

Pages break only at saved and explicit breaks today. Better pagination and a
print path that matches it are the next layout goals.

## 4. Published measurements

Start-up and memory figures from the owner's measurement script, with the
machine, method, and documents named, and a fidelity score over a fixed set
of documents.

## 5. Trusted publisher identities

Windows Authenticode signing and macOS Developer ID signing and notarization,
when credentials and protected release automation exist. Checksums and trust
metadata stay on every artifact.

## 6. Accessibility

A screen reader pass on each platform for every release, with automated
checks where they are reliable.

Proposals are welcome through the issue forms. Explain the problem and how
the change keeps LeanDoc small and read-only.
