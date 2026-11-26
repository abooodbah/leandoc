# Page parity contest, November 2026

LeanDoc's page view splits a document into pages in the browser, on top of
docx-preview. This contest set out to make those pages break where Word's
do on long, complex documents, without costing start-up time or memory.
It ran four rounds and stopped there at the owner's request; the held-out
score had also not moved for two rounds, which is the contest's own
stopping rule.

The kept changes are in the `parity-contest` pull request, one test commit
and one fix commit per change.

## How it was run

- **Documents.** The public parity corpus (`tests/parity-corpus/manifest.json`)
  with Word's page count and first text of each page
  (`tests/reader/parity/word-public.json`): 38 documents. Both files were
  removed from main after the contest; they remain on the `parity-contest`
  branch. A seeded draw split
  them 70/30: 27 scored, whose results the helpers saw, and 11 held out,
  scored only by the lead. This report gives scores only as totals per set.
- **Score.** A Word page start counts as matched when a reader page begins
  with the same first 30 letters and digits (after NFKC). The main number is
  matched starts; the number of documents with Word's exact page count and
  the sum of page count differences come second. Equal starts with a smaller
  page count difference count as better.
- **Gate.** `npm run test:reader` passes, and on `report-1000.docx` (the
  generated perf document from `tests/perf`) the candidate's
  median render time and memory are not above the highest run of the build
  before it, measured alternately.
- **Helpers.** Ten: five on the Opus model and five on the Sonnet model, one of
  each per cause group, each in its own worktree. Each round a helper could
  try up to three variations and submit its best, a failing test first.
- **Integration.** The lead scored every submission on both sets, then
  added the winners one at a time, re-scoring after each. A change was kept
  only if the scored set improved and the held-out set did not get worse.
  Every kept test was checked to fail before its fix.

The five cause groups:

| Group | Area |
|---|---|
| G1 | Space at the top of a page; lines of contents and tabs |
| G2 | Keep rules and page structure (styles, sections, long documents) |
| G3 | Long tables: saved page starts and row drift |
| G4 | Table geometry |
| G5 | Floats, drawings, fonts and spacing styles |

## Scores

| | Scored: starts (of 977) | Scored: exact page count (of 27) | Scored: page count difference | Held-out: starts (of 319) | Held-out: exact (of 11) | Held-out: page count difference |
|---|---|---|---|---|---|---|
| Main | 440 (45.0%) | 7 | 150 | 140 (43.9%) | 4 | 56 |
| After round 1 | 607 (62.1%) | 12 | 70 | 154 (48.3%) | 5 | 55 |
| After round 2 | 634 (64.9%) | 13 | 59 | 156 (48.9%) | 5 | 56 |
| After round 3 | 655 (67.0%) | 13 | 58 | 156 (48.9%) | 5 | 56 |
| After round 4 | 675 (69.1%) | 15 | 25 | 156 (48.9%) | 5 | 56 |

Over the contest the scored set gained 235 starts and the held-out set 16.
All of the held-out gain came in rounds 1 and 2.

## Round by round

Each helper's own result is its submission scored alone on the round's
base, as scored set / held-out set starts.

### Round 1 (base: main, 440 / 140)

| Helper | Tried | Alone | Outcome |
|---|---|---|---|
| G1 Opus | No space before the first block of a page that starts at a soft break; dot leaders set at the top of their line | 463 / 140 | Not kept: it lost held-out starts once the other changes were in, and made one scored document render 3.6 times slower |
| G1 Sonnet | The same page-top rule, a paragraph mark size rule | 467 / 137 | Not kept: held-out −3 |
| G2 Opus | A style takes only the styles it is based on; keep with next only for w:keepNext; chains of kept paragraphs break at the page; non-continuous section breaks start a page; no blank page before a page-break-before paragraph; saved starts at column tops do not start pages | 512 / 142 | **Kept** |
| G2 Sonnet | Keep with next only for w:keepNext; section breaks start a page; chain cap | 469 / 142 | Covered by G2 Opus |
| G3 Opus | Table rows with a saved page start end the page, with a rule for rows near the top of an overflow page | 522 / 147 | Not kept: G3 Sonnet matched more starts |
| G3 Sonnet | A table row whose first cell holds a saved page start ends the page before it | 531 / 147 | **Kept** |
| G4 Opus | Row split rules; rows of exact height never split | 444 / 142 | Not kept: G4 Sonnet scored higher in combination |
| G4 Sonnet | A row whose text fits but whose space after passes the foot stays visible; wide tables are not overflow | 446 / 142 | **Kept** |
| G5 Opus | Consolas spacing; picture-only lines; empty paragraphs in their mark's font; square-wrapped boxes that fill the column; complex-script font and size | 456 / 146 | **Kept** |
| G5 Sonnet | Similar font and box rules, plus HTML auto spacing | 446 / 141 | Covered by G5 Opus |

### Round 2 (base 607 / 154)

| Helper | Tried | Alone | Outcome |
|---|---|---|---|
| G1 Opus | Dot leaders at the top of their line; a paragraph whose text is all one larger size takes that size | 618 / 154 | **Kept** |
| G1 Sonnet | Dot leaders alone | 608 / 154 | Covered by G1 Opus |
| G2 Opus | Split the tall pages of documents over 60 pages | 622 / 154 | Not kept: it laid out the whole document before showing it, so long documents opened 0.4 to 0.5 s later |
| G2 Sonnet | A line or two past the foot before a saved start stays on the page | 621 / not scored | Not kept: it failed 22 reader tests, some with values measured in Word |
| G3 Opus | Rows Word split across pages: a row is a page start only when its first cell holds the saved start; a row split at Word's line splits there | 609 / not recorded | **Kept**, merged by hand with G4 Opus's row rules |
| G3 Sonnet | No submission | | |
| G4 Opus | Empty tables, tall and exact-height rows that move whole, room for a split row's bottom margin, a column break in a one-column section | 613 / 156 | **Kept** |
| G4 Sonnet | No submission (a list label width rule lost starts) | | |
| G5 Opus | HTML auto spacing of 14 pt; chart and SmartArt drawings kept as empty frames (core change) | 614 / 154 | **Kept** |
| G5 Sonnet | HTML auto spacing of 14 pt | 613 / 155 | Covered by G5 Opus |

### Round 3 (base 634 / 156)

| Helper | Tried | Alone | Outcome |
|---|---|---|---|
| G1 Opus | A tab in its run's font; empty bookmarks take no height | 655 / 149 | Not kept: the bookmark rule lost held-out starts; the tab rule was the same as G5 Sonnet's |
| G1 Sonnet | The page-top rule only on pages that start at a saved start | 636 / 157 | Not kept: −9 scored once the other changes were in |
| G2 Opus | Split tall pages of long documents a batch at a time after the first screen | 649 / 156 | Not kept: on `report-1000.docx` it added about 11 MiB and 70 ms though no page was split |
| G2 Sonnet | No submission | | |
| G3 Opus | Merged-row split | 634 / 155 | Not kept: held-out −1 |
| G3 Sonnet | No submission | | |
| G4 Opus | No line break after a list label; rows of exact height cut off at their height | 635 / 156 | **Kept** |
| G4 Sonnet | No submission | | |
| G5 Opus | Hardening of the chart frame change; empty bookmarks take no height | 636 / 149 | Hardening **kept**; the bookmark rule not kept (held-out) |
| G5 Sonnet | A tab takes its run's font, not the document's default span size | 654 / 156 | **Kept** |

The G3 pair found their group out of reach without row measurements from
Word and moved to the long-document split for round 4.

### Round 4 (base 655 / 156)

| Helper | Tried | Alone | Outcome |
|---|---|---|---|
| G1 Opus | No submission: the remaining contents-line differences need Word's line measurements | | |
| G1 Sonnet | No submission (kerning off: −1) | | |
| G2 Opus | The round 3 split without its fixed cost: only pages with at least twice the text, or more than 1.75 times the paragraphs, of a page Word filled are laid out | 671 / 156 | **Kept** |
| G2 Sonnet | No submission: hidden text was a scoring effect | | |
| G3 Opus | The same split with a paragraph floor of 10 | 671 / 156 | Not kept: same result as G2 Opus's, with a tuned floor |
| G3 Sonnet | The same split with a paragraph floor of 20 | 671 / 156 | Not kept: same reason |
| G4 Opus | A table of percentage width is wider by its cell margins in Word 2010's layout mode | 655 / 156 (one more exact page count) | Not kept: on top of the split it lost one start |
| G4 Sonnet | No submission: needs Word's row measurements | | |
| G5 Opus | No HTML auto spacing above the first paragraph of a later page, in documents with no compatibility mode | 659 / 156 | Not kept: tied with G5 Sonnet's |
| G5 Sonnet | The same, everywhere, except paragraphs with an outline level | 659 / 156 | **Kept** |

## Which model won

| Round | G1 | G2 | G3 | G4 | G5 |
|---|---|---|---|---|---|
| 1 | none kept | Opus | Sonnet | Sonnet | Opus |
| 2 | Opus | none kept | Opus | Opus | Opus |
| 3 | none kept | none kept | none kept | Opus | Sonnet (Opus: hardening) |
| 4 | none kept | Opus | none kept | none kept | Sonnet |

Opus versions were kept 8 times plus the hardening, Sonnet versions 4
times. By starts on the scored set, the Sonnet changes gained 125
and the Opus changes 110 (the order of integration affects these
shares).

## Kept changes

In the order integrated. Starts are scored set / held-out set after the
change.

| # | Round, helper | Change | Commits on `parity-contest` | Documents moved (scored / held-out) | Scored starts | Held-out starts |
|---|---|---|---|---|---|---|
| 1 | 1, G3 Sonnet | A table row whose first cell holds a saved page start ends the page before it | 5fd7897, 3acab11 | 12 / 2 | 440 to 531 | 140 to 147 |
| 2 | 1, G2 Opus | A style takes only the styles it is based on; keep with next only for w:keepNext; a kept chain longer than a page breaks; non-continuous section breaks start a page; no blank page before a page-top paragraph that breaks the page; saved starts at column tops do not start pages | 54957a3 to 11aa997 (12) | 13 / 2 | 531 to 593 | 147 to 149 |
| 3 | 1, G5 Opus | Consolas spacing; picture-only lines; empty paragraphs in their mark's font; square-wrapped boxes that fill the column; complex-script font and size | 92d7e81 to 8d38141 (10) | 6 / 2 | 593 to 597 | 149 to 150 |
| 4 | 1, G4 Sonnet | A row at the page foot stays visible; wide tables are not overflow | 39042fd, df84315 | 7 / 5 | 597 to 607 | 150 to 154 |
| 5 | 2, G1 Opus | Dot leaders at the top of their line; a paragraph whose text is all one larger size takes that size | aca645d to 1a1e3a4 (4) | 3 / 0 | 607 to 618 | 154 |
| 6 | 2, G5 Opus | HTML auto spacing of 14 pt; chart and SmartArt drawings kept as empty frames (core) | e88bfdc to 620f6bc (4) | 3 / 1 | 618 to 624 | 154 |
| 7 | 2, G4 Opus | Empty tables, rows that move whole, room for a split row's bottom margin; a column break in a one-column section | 34c44d7 to af014e3 (4) | 3 / 1 | 624 to 630 | 154 to 156 |
| 8 | 2, G3 Opus | Rows Word split across pages, merged by hand with change 7 | b60f759, 66ede24 | 4 / 0 | 630 to 634 | 156 |
| 9 | 3, G5 Sonnet | A tab takes its run's font | dce8485, ed5c00d | 2 / 0 | 634 to 654 | 156 |
| 10 | 3, G4 Opus | No line break after a list label; rows of exact height cut off at their height | c547a9f to 4dbcabf (4) | 2 / 0 | 654 to 655 | 156 |
| 11 | 3, G5 Opus | A drawing docx-preview cannot read is dropped (core; hardening of change 6) | df8dbcc, 93ae516, 4d09040 | 0 / 0 | 655 | 156 |
| 12 | 4, G2 Opus | The tall pages of a document over 60 pages are split after the first screen | f92858f, c9dbcfa | 2 / 0 | 655 to 671 | 156 |
| 13 | 4, G5 Sonnet | No HTML auto spacing above the first paragraph of a later page, except a paragraph with an outline level | 4496fa7, 95417f4 | 1 / 0 | 671 to 675 | 156 |

A document counts as moved when its matched starts or its page count
changed. No kept change lowered the held-out total; changes 3 and 4 each
lowered one held-out document while raising others.

## Changes rejected, and why

- **No space before the first block of a page that starts at a soft
  break** (G1, rounds 1 and 3, both models): it gained on the scored set
  alone but lost held-out starts, or lost scored starts once other changes
  were in. In one version it also made a document render 3.6 times slower.
- **Laying out a whole long document before showing it** (G2, round 2): long
  documents opened 0.4 to 0.5 s later.
- **The long-document split with a fixed cost** (G2, round 3): +11 MiB and
  +70 ms on `report-1000.docx`, where no page was split.
- **A line or two past the foot before a saved start stays** (G2, round 2):
  failed 22 reader tests.
- **Empty bookmarks take no height** (G1 and G5, round 3): held-out −7.
- **A merged-row split** (G3, round 3): held-out −1.
- **Percentage-width tables widened by their cell margins in Word 2010's
  mode** (G4, round 4): real on its own (one more exact page count), but −1
  start with the long-document split. It is a candidate for later, with a
  measurement in Word.
- **Versions tied with a kept one** (G3 pair's splits, G5 Opus's auto
  spacing rule): the kept version was preferred for resting on a property
  of the document rather than a tuned number or a document-wide setting.

## Two rules that rest on no measurement in Word

- **The outline-level exception for HTML auto spacing.** A paragraph with an
  outline level keeps its 14 pt of auto spacing at the top of a later page.
  It comes from comparing the reader's pages with Word's, not from a
  measurement in Word. A version keyed to the compatibility mode fitted the
  same evidence.
- **The long-document split's thresholds.** A page is split when its text
  runs past its foot by more than a quarter of its text area, and only pages
  with at least twice the text, or more than 1.75 times the paragraphs, of a
  page Word filled are laid out to find out. These numbers also come from
  comparing pages, not from Word.

## Misses still open, and their cause

- **Contents lines taller in Word than in the reader.** In some documents
  Word gives each contents entry several pixels more than its line height
  and spacing explain; another document with the same XML does not. The
  reader cannot tell them apart without per-line measurements from Word.
- **Rows that drift in long tables.** The reader's rows and cell lines run a
  little taller or shorter than Word's, a line or two per page. Fixing it
  needs Word's row heights.
- **Headings at a page top.** Word keeps the space before a heading at the
  top of a page in some documents and drops it in others; the general rule
  was rejected three times.
- **Saved page starts from an older layout.** Some files carry page starts
  saved by an earlier version of Word that no longer match its pages. The
  reader cannot tell a stale saved start from a current one.
- **Stand-in fonts.** Where a font is drawn by a metric-compatible stand-in,
  a line can wrap one word differently.
- **Tall pages the split does not pick.** A page that is tall because of
  pictures or a large table, with ordinary text and paragraph counts, and
  long documents with no saved page start, are not split.
- **A scoring effect.** On some contents pages the first text of the page
  is leader dots, so a page that breaks where Word's does can still count
  as a miss.

## Speed

Measured at the end against main, alternating, on `report-1000.docx` (the
generated perf document from `tests/perf`), 11 runs each:

| | main | parity-contest |
|---|---|---|
| Render time, median (range) | 1693 ms (1625 to 1858) | 1697 ms (1651 to 1812) |
| Memory, PSS of the probe's browser, median (range) | 391 MiB (389 to 396) | 392 MiB (388 to 435) |
| JS heap, median (range) | 20.7 MiB (20.7 to 22) | 22 MiB (22 to 22) |

The first screen of `report-1000.docx` appeared after 799 to 906 ms on
main and 830 to 883 ms on the branch. On the scored documents that the
long-document split applies to, the first screen is unchanged, and every
page is in place 0.15 to 0.45 s later, because those pages are now split.

During the contest the probe's memory measure on Linux counted every
headless browser on the machine, so readings swung by hundreds of MiB while
helpers worked. It now counts only the probe's own browser.

**The slowest document in the scored set** rendered in about 33.5 s on main
and 16.9 s on the branch. Its first screen came after about 5.5 s on both.
The app sets no render time limit, so a reader waits but is not cut off.
In a profile on main, about 20 s was the browser's own layout and style
work. In the reader's code:
- splitting pages took about 12 s, about 8 s of it forced layout while
  settling splits (`settleSplit`, `endsPast`) in one long table with
  vertically merged cells;
- matching Word's lines took about 7 s;
- parsing took about 3 s.

Generated tables of the same width and length scale linearly, so the cost
comes from something in that table's cells that is still to be found. The
contest made no change for it.

## Adjacent problems found, not fixed

- `w:vanish w:val="0"` on a run inside a style that hides text leaves the
  run hidden.
- A field whose result runs are all hidden still prints its result.
- A long table with vertically merged cells is slow to split (see Speed).
