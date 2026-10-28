# LeanDoc Microsoft Store listing

Paste each field into Partner Center > your app > Submission > Store listings > English (United States). Every value below was checked against the README and the app on 2026-10-24.

## Product

- Product name (reserve this exact name): LeanDoc
- Publisher display name: Lean Apps Studio
- Short title (50 characters or fewer): LeanDoc: Word document viewer
- Version in this pack: 0.1.4 (package version 0.1.4.0)
- File types it opens: Word documents (.docx, .docm, .dotx, .dotm, plus .doc, .rtf, and .odt, which get a page that offers your editor)

## Short description

Read Word documents as pages, without an office suite. Nothing in the file runs.

(80 characters.)

## Description

LeanDoc is a read-only viewer for Word documents (.docx, .docm, .dotx, .dotm). It opens a document as pages so you can read it, and has one button that hands the file to a full editor when you need to change it.

LeanDoc never runs macros and never fetches anything a document points to, such as remote templates, linked images, or linked fields. Before the page is drawn, the document is copied into a cleaned version that keeps only the text, styles, numbering, tables, pictures, headers, footers, and notes.

It shows paragraph and character styles, multi-level numbering, tables with merged cells, pictures, headers and footers, footnotes and endnotes, and right-to-left text such as Arabic. Page view is the default; reading view reflows the text to the window. A heading outline, find, zoom from 50 to 300 percent, and light and dark themes are built in. Each document opens as a tab in one window.

When a document holds something LeanDoc does not display, such as a chart or a text box, a bar above the page says so and offers the editor. Older .doc files, .rtf, and .odt files get a page that says what the file is, with the same button.

LeanDoc draws pages with the Microsoft Edge WebView2 runtime that Windows already provides. Its own code makes no network requests.

LeanDoc is free and open source under the MIT License.

## Product features

- Opens .docx, .docm, .dotx, and .dotm documents as pages
- Macros never run; remote templates, images, and fields are never fetched
- Styles, multi-level numbering, tables with merged cells, and pictures
- Headers, footers, footnotes, and endnotes
- Right-to-left text, including Arabic
- Page view and reading view
- Heading outline and find
- Zoom from 50 to 300 percent, with fit width
- A bar names any content that is not displayed
- One button opens the file in your installed editor
- Each document opens as a tab in one window
- Light, dark, and system themes
- No telemetry, no account, no update check
- Free and open source (MIT License)

## Search terms (7)

- word viewer
- docx viewer
- docx
- document viewer
- read docx
- wordpad
- office

## Category

- Category: Productivity
- Subcategory or secondary category: Utilities & tools

## What's new in this version

Long documents open much faster in page view, two-column pages fill like Word, and headings and spacing follow Word's styles more closely.

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

Upload the files in `store/screenshots/` in this order (Desktop, 1920x1080). Each one is the packaged app running on Windows 11 with public sample files from this repository or generated sample data.

| File | Caption |
| --- | --- |
| 01-report-page.png | A report with a heading outline, a cost table, and an Arabic summary, in page view. |
| 02-fidelity-bar-dark.png | A draft with a text box and tracked changes; the bar above the page says what is not displayed. |
| 03-reading-view-dark.png | The report in reading view with the dark theme. |
| 04-tabs.png | Two documents open as tabs. |
