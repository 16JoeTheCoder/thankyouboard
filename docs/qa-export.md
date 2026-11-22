# Keepsake export QA

**Passed 27 checks across 27 PDFs and 46 pages** on the compiled local Wrangler demo with its synthetic D1 dataset. Browser automation used Puppeteer and Chromium 156.0.8078.79 at 1440 × 1000. Poppler 25.03.0 extracted text and font metadata. Poppler 26.05.0 reported page boxes and rasterized the PDFs.

## Reproduce

From the repository root, build and start an isolated demo in one terminal.

```sh
npm run build
npm run demo -- --port 8793 --state /tmp/wall-export-qa
```

In a second terminal, run the pass with Chromium and Poppler's `pdfinfo`, `pdftotext`, `pdffonts`, and `pdftoppm` installed.

```sh
npm run qa:export
```

The default artifact directory is `/tmp/thankyouboard-qa-export`. Set `EXPORT_QA_OUTPUT` to change it, `EXPORT_QA_URL` to point at another isolated loopback demo, or `CHROMIUM_PATH` to select another Chromium binary.

## Observed results

| Scenario | Result |
| --- | --- |
| Individual shortcut | The selected note opened on one Gallery A4 page. The preview enlarged the body and preserved the newline between Traditional Chinese and English. Both the download and Chromium print rendered the tulip in color and extracted the original Unicode. |
| Selection controls | The teacher workspace selected all 55 visible notes by default. Clear set the count to zero, explained what to select, and disabled both output actions. Select all restored 55. Individual checkboxes selected three nonadjacent notes by their stable slot order. |
| Layout and paper matrix | Each of the five layouts produced a one-page PDF at each of the four ISO sizes for the three-note selection. Headers, note separation, and the Student Council signature were visible in all 20 samples. |
| Long single note | Gallery A6 split the note over four pages and retained the 13 blank paragraph separators in the preview. Chromium print and the download matched the preview's page count and body text. The fourth page held the final two lines. |
| Full selection | Blue Ink A6 produced 14 pages for the 55-note group. The preview's next and previous controls reached the expected pages. The PDF preserved all 55 notes in stable board slot order. |
| Retry | A forced 503 from the pre-export board refresh showed retry guidance, preserved the selection, and allowed the next Download PDF attempt to succeed. |
| Hidden note | While a three-note selection was still open, the demo administrator hid its mixed-script note. The next Download PDF omitted it, and the workspace removed its checkbox and preview content. The test then restored the fixture note. |

The downloaded portrait dimensions were A3 841.890 × 1190.551 pt, A4 595.276 × 841.890 pt, A5 419.528 × 595.276 pt, and A6 297.638 × 419.528 pt. The program accepted up to 1 pt of Chromium print-media rounding. Every extracted word was at least 9 pt inside the horizontal page boundaries and 5 pt inside the vertical boundaries. The checks compared PDF punctuation, Unicode, and note order after removing whitespace introduced by PDF line extraction. They separately compared the preview to the exact source spaces and checked the explicit line break and long-note paragraph breaks.

## Evidence

Artifacts are stored outside the repository. Key files in `/tmp/thankyouboard-qa-export` include the following.

- `export-report.json` records per-file results, paper sizes, selected counts, page counts, and failure details.
- `layout-size-matrix.png` shows raster samples for Botanical, Rose Letter, Blue Ink, Gallery, and Letterpress at A3, A4, A5, and A6.
- `individual-workspace.png`, `individual-gallery-a4.pdf`, and `individual-gallery-a4-print.pdf` show the single-note preview, download, and Chromium print.
- `long-a6-continuations.png`, `long-gallery-a6.pdf`, and `long-gallery-a6-print.pdf` show A6 overflow.
- `all-55-blue-ink-a6.pdf`, `all-55-blue-ink-a6-last.png`, `hidden-excluded-gallery-a4.pdf`, and `export-retry.png` show the full selection, final page, moderation, and recovery.

Print used the application Print control, intercepted Chromium's interactive dialog, and generated a PDF through Chromium's print pipeline with CSS paper sizing. Physical printer output and browser engines other than Chromium remain unverified.

The PR includes two synthetic downloads for inspection. [Single mixed-script note on A4](qa/individual-gallery-a4.pdf) · [Long note spanning A6 pages](qa/long-gallery-a6.pdf)
