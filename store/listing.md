# LeanDoc Microsoft Store listing

Paste each field into Partner Center > your app > Submission > Store listings > English (United States). Every value below was checked against the README and the app on 2026-11-15.

## Product

- Product name (reserve this exact name): LeanDoc Word Viewer (reserved in Partner Center; the MSIX manifest DisplayName is set to it, and the package identity, executable and window title stay LeanDoc)
- Publisher display name: Lean Apps Studio
- Short title (50 characters or fewer): LeanDoc Word Viewer
- Version in this pack: 0.4.1 (package version 0.4.1.0)
- File types it shows as pages: Word documents (.docx, .docm, .dotx, .dotm). Older .doc files, .rtf, and .odt are not shown: they open to a page that offers your editor

## Short description

Read Word documents as pages, without an office suite. Nothing in the file runs.

(80 characters.)

## Description

LeanDoc Word Viewer reads Word documents without Word. Open a .docx and LeanDoc shows it as pages, with headers, footers, tables, footnotes, pictures, numbered lists, and right-to-left text such as Arabic. Reading view reflows the text to the window.

Version 0.3 lays pages out closer to Word. Two-column papers keep their columns. Tables and figures that Word floats at the top or foot of a page sit there, and the text no longer runs over them. Contents pages keep their dot leaders and page numbers, and files saved in Word's Strict format keep their styles and lists.

Safe for attachments: macros never run, and nothing a document points to is fetched from the internet. A small bar names anything LeanDoc does not display yet, such as charts or SmartArt, and one button opens the file in Word, LibreOffice, or your default editor.

Find, zoom, a heading outline, tabs for several documents, five themes, and a page colour setting. No telemetry, no update check, and no account.

LeanDoc draws pages with the Microsoft Edge WebView2 runtime that Windows already provides. It is free and open source under the MIT License.

## Product features

- Opens .docx, .docm, .dotx, and .dotm documents as pages
- Two-column layouts, such as IEEE papers, with references in two columns
- Floating tables and figures placed at the top or foot of the page, as in Word
- Tab stops with dot leaders, so contents pages line up
- Page numbers, footnotes, endnotes, headers, and footers
- Styles, multi-level numbering, tables with merged cells, and pictures
- Files saved in Word's Strict format keep their styles and lists
- Right-to-left text, including Arabic
- Page view and reading view
- Heading outline and find
- Zoom from 50 to 300 percent, with fit width
- Each document opens as a tab in one window
- Macros never run; remote templates, images, and fields are never fetched
- A bar names any content that is not displayed
- One button opens the file in your installed editor
- Five themes and a page colour setting
- No telemetry, no account, no update check
- Free and open source (MIT License)

## Search terms (7)

- word viewer
- docx viewer
- docx reader
- document viewer
- read docx
- word document
- office

## Category

- Category: Productivity
- Subcategory or secondary category: Utilities & tools

## What's new in this version

Pages now break much closer to the original layout in long, complex documents: tables that run across pages, documents with many styles, sections or columns, contents pages, code, charts and right-to-left text. In documents over 60 pages, overlong pages are split after the first screen appears, so documents open as quickly as before. A document with a damaged drawing now opens without that drawing.

From 0.4.0: the interface is now available in Simplified Chinese and Japanese. LeanDoc follows your system language, and Settings has a Language choice: System, English, 简体中文 or 日本語. The toolbar, settings, keyboard shortcut list, menus, dialogs, messages and the notes about how a document is shown are translated. Documents themselves are shown as before.

Also fixed: documents that failed to open when a picture's image was stored inside a compatibility block now open with their pictures. A paragraph set to keep its lines together that is taller than a page is now split across pages instead of staying on one oversized page, and nonbreaking hyphens now show and keep the word together.

From 0.3.3: nothing is cut off the bottom of a page when you zoom. At zooms other than 100%, the last lines of a column or the last rows of a table could be hidden past the page's edge; such a page now grows a little taller so that all of its text shows.

From 0.3.2: the Microsoft Store lists the app as LeanDoc Word Viewer.

From 0.3.1: fewer near-empty extra pages: when a line or two runs past where Word started the next page, it now continues on that page, also across a section boundary.

## Copyright and trademark info

Copyright (c) 2026 Abdulfatah Bahbouh. Released under the MIT License.

## Links

- Website: https://abooodbah.github.io/leandoc/
- Support contact: https://github.com/abooodbah/leandoc/issues
- Privacy policy: https://github.com/abooodbah/leandoc#privacy

## Additional information

- Pricing: Free. No in-app purchases, no ads, no subscriptions.
- Personal information: the app does not access, collect, or transmit personal information.
- System requirements: Windows 10 version 1809 or later, or Windows 11, x64. Needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11 and is installed on supported Windows 10 PCs by Windows Update.

## Screenshots

Upload the files in `store/screenshots/` in this order (Desktop, 1920x1080). Each one is the packaged app running on Windows 11 with public sample files from this repository or generated sample data. 01 to 04 are LeanDoc 0.3.0 with the two sample documents that `docs/images/screenshot-source/make-store-paper-docs.py` writes; 05 to 08 are from 0.2.0.

| File | Caption |
| --- | --- |
| 01-two-column-paper.png | A two-column sample paper in page view, with its footnotes at the foot of the page. |
| 02-floating-table-figure.png | A table floated to the top of the page and a figure to the foot, with the references in two columns. |
| 03-contents-leaders.png | A contents page with dot leaders and right-aligned page numbers. |
| 04-paper-dark.png | The sample paper with the dark theme; the page stays white like paper. |
| 05-report-page.png | A report with a heading outline, a cost table, and an Arabic summary, in page view. |
| 06-fidelity-bar-dark.png | A draft with a text box and tracked changes; the bar above the page says what is not displayed. |
| 07-reading-view-dark.png | The report in reading view with the dark theme. |
| 08-tabs.png | Two documents open as tabs. |
