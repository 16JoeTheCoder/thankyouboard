# Board QA

Run these commands from the repository root with Node.js, Chromium and a fresh synthetic demo. Run the browser test in a second terminal while Wrangler serves the compiled build.

```sh
npm ci
npm run build
npm run demo -- --state /tmp/stjbs-board-demo
npm run qa:board
```

`CHROMIUM_PATH` overrides `/usr/bin/chromium`. `BOARD_QA_URL` defaults to `http://127.0.0.1:8788` and `BOARD_QA_OUTPUT` defaults to `/tmp/thankyouboard-qa-board`.

## Interactions

Chromium 156.0.8078.79 on Debian 13 ran the compiled demo at 1440 × 1000 and at 390 × 844 with mobile and touch emulation. The test rejected an incorrect passphrase, unlocked the wall, verified that the dedication stayed dismissed after reload, and replayed it. Original, After Hours, Blue Hour and Garden produced distinct visual styles. The selected theme survived a reload.

The 55-note spotlight highlighted the matching cards and limited moving cards to four. Keyboard navigation previewed and opened a board note, entered the All notes browser, and restored focus after closing readers. Surprise me opened an individual note. A mouse hover showed an excerpt without shifting keyboard focus or blocking adjacent notes. An actual click on each of the eight letters opened the expected synthetic note with exact body text.

The phone layout fit without horizontal scrolling and showed search without scrolling. A single emulated touch tap opened the note, and reduced motion opened the teacher reader without animated spotlight travel. Desktop and phone screenshots showed all eight letter silhouettes. The desktop snapshot showed printed excerpts on the larger note faces.

## Trace method

The test uses CDP CPU throttling at 4× on an AMD EPYC x86-64 cloud VM with a two-vCPU CPU quota. Real Chromium mouse moves target all 500 note slots in a serpentine sweep with a 15 ms pause per destination. A passive listener checks the slot reported by the hit plane at each target. The same trace includes six evenly spaced tile visits with 300 ms holds to exercise the lift and verify each expected preview. Two rapid three-teacher sequences check that each selection reaches the spotlight and only the final reader opens.

Performance marks delimit idle, rapid hover, held hover and teacher switching. Frame counts are compositor `DrawFrame` events in the marked renderer. The reported frame rate divides that count by the full segment duration, including time between input events and the deliberate preview delay. Long tasks are renderer main-thread tasks longer than 50 ms of elapsed time. The JSON report retains elapsed and thread duration and the longest nested work for each long task. Headless Chromium measures compositor draws without a physical display.

## Trace results

| Segment | Duration | Compositor draws | Draws per second | Tasks over 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Idle | 1.11 s | 0 | 0 | 0 |
| 500-slot sweep | 9.15 s | 0 | 0 | 0 |
| Six held previews | 1.91 s | 77 | 40.4 | 0 |
| Six teacher selections | 1.38 s | 14 | 10.1 | 7 |

The sweep reached all 500 slots. Fast crossings ended before the preview delay, so the static wall needed no redraws during that segment. All six holds showed the expected previews. The idle trace contained no animation callbacks or running animations. Two three-teacher sequences had 45–70 ms between selections and each opened only the final teacher's reader. The seven teacher-switch tasks took 50–132 ms and were primarily style, layout and rendering work. Frame gaps in that segment include the intentional spotlight-to-reader delay.

The first implementation showed repeated hover jank from per-card layer and layout work. The final board rasterizes the static paper faces once per theme, board size or data refresh. A single desktop hit plane resolves note coordinates while the underlying buttons remain keyboard-addressable and serve coarse-pointer devices. The lift and excerpt update after the pointer settles on a card.

The output directory contains `board-4x.trace.json`, `board-report.json`, four themed desktop screenshots, a desktop hover screenshot, the dedication and teacher reader, and the phone wall and readers. The trace can be opened in Chromium DevTools Performance or Perfetto. The measured run used `/tmp/thankyouboard-qa-board-final`.

A separate run overlapping other browser QA recorded five hover tasks above 50 ms. The final isolated rerun verified the coordinate-to-slot mapping for all 500 targets and reproduced the passing hover result. Its 9.15-second sweep and six held previews had zero tasks above 50 ms. The holds delivered 77 compositor draws over 1.90 seconds. Rapid teacher switching recorded four long tasks, peaking at 109 ms. [Final JSON report](qa/board-report.json) · [Compressed Chromium trace](qa/board-4x.trace.json.gz)
