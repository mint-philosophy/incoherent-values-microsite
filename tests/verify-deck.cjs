const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const VIEWPORTS = [
  { name: 'ultrawide', width: 2560, height: 1080 },
  { name: 'full-hd', width: 1920, height: 1080 },
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'medium-portrait', width: 622, height: 800 },
  { name: 'medium-portrait-wide', width: 637, height: 800 },
  { name: 'compact-square', width: 628, height: 633 },
  { name: 'compact-short', width: 631, height: 543 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'small-phone', width: 360, height: 640 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'small-phone-landscape', width: 667, height: 375 }
];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview server did not start: ${lastError?.message || 'unknown error'}`);
}

async function launchPreview() {
  if (process.env.DECK_BASE_URL) {
    return { baseUrl: process.env.DECK_BASE_URL.replace(/\/$/, ''), server: null };
  }
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverError = '';
  server.stderr.on('data', (chunk) => { serverError += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(`${baseUrl}/`);
  } catch (error) {
    server.kill('SIGTERM');
    throw new Error(`${error.message}\n${serverError}`);
  }
  return { baseUrl, server };
}

async function diagnostics(frame) {
  await frame.waitForFunction(() => {
    const result = window.__deckDiagnostics;
    return result?.ready
      && result.pretext.status !== 'loading'
      && (result.pretext.status !== 'ready' || result.pretext.layoutRuns > 0)
      && result.config.status !== 'loading';
  });
  // Fonts, images, and shell sizing can land after the last scheduled fit;
  // measure a deliberate settled pass, not whichever pass ran last.
  await frame.evaluate(() => new Promise((resolve) => {
    window.refitDeck();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  return frame.evaluate(() => window.__deckDiagnostics);
}

async function resultsModelLayoutIssues(frame) {
  return frame.evaluate(() => {
    const heading = document.querySelector('#c-results-models .editorial-section-heading')?.getBoundingClientRect();
    const story = document.querySelector('#c-results-models .results-model-story')?.getBoundingClientRect();
    const copy = document.querySelector('#c-results-models .results-summary-copy')?.getBoundingClientRect();
    const chart = document.querySelector('#c-results-models .strict-mono-card')?.getBoundingClientRect();
    if (!heading || !story || !copy || !chart) return ['model-results elements are missing'];

    const within = (child, parent) => child.left >= parent.left - 0.5
      && child.right <= parent.right + 0.5
      && child.top >= parent.top - 0.5
      && child.bottom <= parent.bottom + 0.5;
    const overlaps = (first, second) => !(first.right <= second.left + 0.5
      || second.right <= first.left + 0.5
      || first.bottom <= second.top + 0.5
      || second.bottom <= first.top + 0.5);

    const issues = [];
    if (overlaps(heading, story)) issues.push('content overlaps slide heading');
    if (!within(copy, story)) issues.push('summary escapes content grid');
    if (!within(chart, story)) issues.push('chart escapes content grid');
    if (overlaps(copy, chart)) issues.push('summary overlaps chart');
    return issues;
  });
}

async function resultsSummaryTypographyIssues(frame) {
  return frame.evaluate(() => {
    const summary = document.querySelector('#c-results-models .results-summary-copy');
    const rows = summary ? Array.from(summary.children) : [];
    if (!summary || rows.length !== 3) return ['model-results summary rows are missing'];

    const expectedLabels = ['Average', 'Reasoning', 'Details'];
    const issues = [];
    const summaryStyle = getComputedStyle(summary);
    const styles = rows.map((row) => getComputedStyle(row));
    const rects = rows.map((row) => row.getBoundingClientRect());
    const pixelValue = (value) => Number.parseFloat(value) || 0;
    const nearlyEqual = (first, second, tolerance = 0.1) => Math.abs(first - second) <= tolerance;

    if (!nearlyEqual(pixelValue(summaryStyle.rowGap), 0)) issues.push('summary rows use an arbitrary grid gap');
    if (!rows.every((row, index) => row.dataset.findingLabel === expectedLabels[index])) {
      issues.push('summary row labels changed');
    }

    const fontSize = pixelValue(styles[0].fontSize);
    const lineHeight = pixelValue(styles[0].lineHeight);
    const paddingTop = pixelValue(styles[0].paddingTop);
    const paddingBottom = pixelValue(styles[0].paddingBottom);
    // Findings share the deck's unit-derived point size exactly.
    const referencePoint = document.querySelector('.slide-points > p[data-point-icon]');
    const referenceSize = referencePoint ? pixelValue(getComputedStyle(referencePoint).fontSize) : 0;
    if (!nearlyEqual(fontSize, referenceSize, 0.2)) {
      issues.push(`findings prose is ${fontSize}px but point rows are ${referenceSize}px`);
    }
    if (!nearlyEqual(lineHeight / fontSize, 1.35, 0.02)) {
      issues.push(`findings leading ratio is ${(lineHeight / fontSize).toFixed(3)} instead of 1.35`);
    }
    styles.forEach((style, index) => {
      if (!nearlyEqual(pixelValue(style.fontSize), fontSize)) issues.push(`row ${index + 1} font size differs`);
      if (!nearlyEqual(pixelValue(style.lineHeight), lineHeight)) issues.push(`row ${index + 1} line height differs`);
      if (!nearlyEqual(pixelValue(style.marginTop), 0) || !nearlyEqual(pixelValue(style.marginBottom), 0)) {
        issues.push(`row ${index + 1} has inherited margins`);
      }
      if (!nearlyEqual(pixelValue(style.paddingTop), paddingTop)
        || !nearlyEqual(pixelValue(style.paddingBottom), paddingBottom)) {
        issues.push(`row ${index + 1} vertical padding differs`);
      }
    });

    for (let index = 1; index < rects.length; index += 1) {
      if (!nearlyEqual(rects[index].top, rects[index - 1].bottom, 1)) {
        issues.push(`row ${index + 1} does not meet the preceding rule`);
      }
    }
    return issues;
  });
}

async function slidePointContractIssues(frame) {
  return frame.evaluate(() => {
    const expected = {
      'c-overview': ['trust', 'values', 'test'],
      'c-coherence': ['choice', 'measure', 'order', 'cycle'],
      'c-ladder': ['ladder', 'sequence', 'accurate', 'confirm'],
      'c-comparison': ['compare', 'trend', 'cycle'],
      'c-results': ['finding', 'example'],
      'c-upshot': ['result'],
      'c-links': ['paper']
    };
    const issues = [];
    const pixelValue = (value) => Number.parseFloat(value) || 0;
    const nearlyEqual = (first, second, tolerance = 0.1) => Math.abs(first - second) <= tolerance;
    const unsupportedCopies = Array.from(document.querySelectorAll('.editorial-copy')).filter((copy) => (
      !copy.classList.contains('slide-points') && !copy.classList.contains('slide-findings')
    ));
    if (unsupportedCopies.length) {
      issues.push(`unstyled editorial copy: ${unsupportedCopies.map((copy) => copy.closest('.editorial-slide')?.id).join(', ')}`);
    }

    Object.entries(expected).forEach(([slideId, expectedIcons]) => {
      const slide = document.getElementById(slideId);
      const group = slide?.querySelector('.slide-points');
      const rows = group
        ? Array.from(group.children).filter((element) => element.matches('p[data-point-icon]'))
        : [];
      if (!slide || !group || rows.length !== expectedIcons.length) {
        issues.push(`${slideId}: expected ${expectedIcons.length} explanatory rows, found ${rows.length}`);
        return;
      }

      const groupStyle = getComputedStyle(group);
      if (!nearlyEqual(pixelValue(groupStyle.rowGap), 0)) issues.push(`${slideId}: arbitrary row gap`);

      rows.forEach((row, index) => {
        const style = getComputedStyle(row);
        const markerStyle = getComputedStyle(row, '::before');
        const previousIsPoint = row.previousElementSibling?.matches('p[data-point-icon]') || false;
        if (row.dataset.pointIcon !== expectedIcons[index]) issues.push(`${slideId}: row ${index + 1} icon changed`);
        if (markerStyle.backgroundImage === 'none') issues.push(`${slideId}: row ${index + 1} marker is missing`);
        if (row.querySelector('br')) issues.push(`${slideId}: row ${index + 1} contains a manual line break`);
        if (!row.classList.contains('pretext-managed') && !row.hasAttribute('data-pretext-native')) {
          issues.push(`${slideId}: row ${index + 1} has no declared text-layout path`);
        }
        if (row.classList.contains('pretext-managed') && row.hasAttribute('data-pretext-native')) {
          issues.push(`${slideId}: row ${index + 1} has conflicting text-layout paths`);
        }
        const rowSize = pixelValue(style.fontSize);
        const rowLeading = pixelValue(style.lineHeight);
        // One unit-derived size across every point row in the deck.
        if (!window.__pointSizeReference) window.__pointSizeReference = rowSize;
        if (!nearlyEqual(rowSize, window.__pointSizeReference, 0.2)) {
          issues.push(`${slideId}: row ${index + 1} is ${rowSize}px, deck reference is ${window.__pointSizeReference}px`);
        }
        if (!nearlyEqual(rowLeading / rowSize, 1.35, 0.02)) {
          issues.push(`${slideId}: row ${index + 1} leading ratio changed`);
        }
        if (!nearlyEqual(pixelValue(style.marginTop), 0) || !nearlyEqual(pixelValue(style.marginBottom), 0)) {
          issues.push(`${slideId}: row ${index + 1} has inherited margins`);
        }
        if (!nearlyEqual(pixelValue(style.paddingTop), pixelValue(style.paddingBottom))) {
          issues.push(`${slideId}: row ${index + 1} has unequal vertical padding`);
        }
        if (!nearlyEqual(pixelValue(style.borderBottomWidth), 1)) {
          issues.push(`${slideId}: row ${index + 1} has no lower rule`);
        }
        const expectedTopBorder = previousIsPoint ? 0 : 1;
        if (!nearlyEqual(pixelValue(style.borderTopWidth), expectedTopBorder)) {
          issues.push(`${slideId}: row ${index + 1} has the wrong group-start rule`);
        }
        if (previousIsPoint) {
          const previousRect = row.previousElementSibling.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          if (!nearlyEqual(rowRect.top, previousRect.bottom, 1)) {
            issues.push(`${slideId}: row ${index + 1} does not meet the preceding rule`);
          }
        }
      });
    });
    return issues;
  });
}

async function coherenceCopyIssues(frame) {
  return frame.evaluate(() => {
    const slide = document.querySelector('#c-coherence');
    const plane = slide?.querySelector('.slide-plane');
    const heading = slide?.querySelector('.editorial-section-heading')?.getBoundingClientRect();
    const diagram = slide?.querySelector('.coherence-cycle-diagram')?.getBoundingClientRect();
    const copy = slide?.querySelector('.coherence-forced-choice-copy');
    const copyRect = copy?.getBoundingClientRect();
    const rows = copy ? Array.from(copy.children) : [];
    if (!slide || !plane || !heading || !diagram || !copy || !copyRect || rows.length !== 4) {
      return ['coherence slide elements or four copy rows are missing'];
    }

    const issues = [];
    const expectedIcons = ['choice', 'measure', 'order', 'cycle'];
    const styles = rows.map((row) => getComputedStyle(row));
    const rects = rows.map((row) => row.getBoundingClientRect());
    const pixelValue = (value) => Number.parseFloat(value) || 0;
    const nearlyEqual = (first, second, tolerance = 0.1) => Math.abs(first - second) <= tolerance;
    const overlaps = (first, second) => !(first.right <= second.left + 0.5
      || second.right <= first.left + 0.5
      || first.bottom <= second.top + 0.5
      || second.bottom <= first.top + 0.5);

    if (overlaps(heading, diagram) || overlaps(heading, copyRect)) issues.push('coherence content overlaps its heading');
    if (overlaps(diagram, copyRect)) issues.push('coherence copy overlaps the diagram');
    if (!nearlyEqual(pixelValue(getComputedStyle(copy).rowGap), 0)) issues.push('coherence rows use an arbitrary grid gap');

    const fontSize = pixelValue(styles[0].fontSize);
    const lineHeight = pixelValue(styles[0].lineHeight);
    const paddingTop = pixelValue(styles[0].paddingTop);
    const paddingBottom = pixelValue(styles[0].paddingBottom);
    if (!nearlyEqual(lineHeight / fontSize, 1.35, 0.02)) {
      issues.push(`coherence leading ratio is ${(lineHeight / fontSize).toFixed(3)} instead of 1.35`);
    }

    rows.forEach((row, index) => {
      const style = styles[index];
      if (row.dataset.pointIcon !== expectedIcons[index]) issues.push(`row ${index + 1} icon changed`);
      if (getComputedStyle(row, '::before').backgroundImage === 'none') issues.push(`row ${index + 1} icon is missing`);
      if (!row.classList.contains('pretext-managed')) issues.push(`row ${index + 1} is not managed by Pretext`);
      if (!nearlyEqual(pixelValue(style.fontSize), fontSize)) issues.push(`row ${index + 1} font size differs`);
      if (!nearlyEqual(pixelValue(style.lineHeight), lineHeight)) issues.push(`row ${index + 1} line height differs`);
      if (!nearlyEqual(pixelValue(style.marginTop), 0) || !nearlyEqual(pixelValue(style.marginBottom), 0)) {
        issues.push(`row ${index + 1} has inherited margins`);
      }
      if (!nearlyEqual(pixelValue(style.paddingTop), paddingTop)
        || !nearlyEqual(pixelValue(style.paddingBottom), paddingBottom)) {
        issues.push(`row ${index + 1} vertical padding differs`);
      }
    });

    for (let index = 1; index < rects.length; index += 1) {
      if (!nearlyEqual(rects[index].top, rects[index - 1].bottom, 1)) {
        issues.push(`row ${index + 1} does not meet the preceding rule`);
      }
    }
    return issues;
  });
}

async function comparisonLayoutIssues(frame) {
  return frame.evaluate(() => {
    const visual = document.querySelector('#c-comparison .comparison-visual-stack')?.getBoundingClientRect();
    const chart = document.querySelector('#c-comparison .monotonicity-example-card')?.getBoundingClientRect();
    const copy = document.querySelector('#c-comparison .editorial-copy')?.getBoundingClientRect();
    if (!visual || !chart || !copy) return ['comparison elements are missing'];

    const within = (child, parent) => child.left >= parent.left - 0.5
      && child.right <= parent.right + 0.5
      && child.top >= parent.top - 0.5
      && child.bottom <= parent.bottom + 0.5;
    const overlaps = (first, second) => !(first.right <= second.left + 0.5
      || second.right <= first.left + 0.5
      || first.bottom <= second.top + 0.5
      || second.bottom <= first.top + 0.5);

    const issues = [];
    if (!within(chart, visual)) issues.push('chart escapes visual stack');
    if (overlaps(chart, copy)) issues.push('chart overlaps explanatory copy');
    return issues;
  });
}

// Proportional contract: on two-column compositions the text band must hold a
// readable share of the frame width — neither a sliver nor a sprawl.
async function textProportionIssues(frame) {
  return frame.evaluate(() => {
    const checks = [
      ['c-overview', '.slide-points'],
      ['c-coherence', '.coherence-forced-choice-copy'],
      ['c-comparison', '#c-comparison .slide-points'],
      ['c-results', '.results-intro'],
      ['c-results-models', '.results-summary-copy']
    ];
    const deckWidth = document.getElementById('deck').getBoundingClientRect().width;
    const issues = [];
    checks.forEach(([slideId, selector]) => {
      const slide = document.getElementById(slideId);
      const block = slide?.querySelector(selector);
      if (!block) {
        issues.push(`${slideId}: text block missing`);
        return;
      }
      const share = block.getBoundingClientRect().width / deckWidth;
      if (share < 0.26 || share > 0.56) {
        issues.push(`${slideId}: text band is ${(share * 100).toFixed(1)}% of frame width`);
      }
    });
    return issues;
  });
}

async function verifyViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  const failedLocalResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      failedLocalResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(`${baseUrl}/#c-results`, { waitUntil: 'networkidle' });
    if (viewport.name === 'ultrawide') {
      await page.evaluate(() => {
        localStorage.setItem('mint-theme', 'dark');
        localStorage.removeItem('mint-theme-explicit');
      });
      await page.reload({ waitUntil: 'networkidle' });
    }
    const frame = page.frames().find((candidate) => candidate.url().includes('/deck.html'));
    assert(frame, `${viewport.name}: deck iframe was not loaded`);
    const result = await diagnostics(frame);

    assert.equal(result.slideCount, 10, `${viewport.name}: unexpected slide count`);
    assert.equal(result.pretext.status, 'ready', `${viewport.name}: Pretext did not load`);
    assert(result.pretext.managedBlocks >= 20, `${viewport.name}: too few Pretext-managed blocks`);
    assert(result.pretext.layoutRuns > 0, `${viewport.name}: Pretext did not perform layout`);
    assert.equal(result.config.status, 'ready', `${viewport.name}: paper config did not load`);
    assert.equal(result.config.approvedLinks, 5, `${viewport.name}: approved link count changed`);
    assert.deepEqual(result.slides.filter((slide) => !slide.fits), [], `${viewport.name}: framed slide overflow`);
    assert.deepEqual(
      await slidePointContractIssues(frame),
      [],
      `${viewport.name}: explanatory-row style contract drift`
    );

    // The deck must read at one apparent size: fitted scales stay near 1 and
    // near each other. Portrait stacks get more slack than composed aspects.
    const fittedScales = result.slides.map((slide) => slide.scale);
    const scaleSpread = Math.max(...fittedScales) / Math.min(...fittedScales);
    // Short or tiny windows are safety-net territory: the floor-clamped type
    // cannot hold intrinsic stacks uniformly, so the fitter legitimately works
    // harder there. Composed aspects stay tightly gated.
    const safetyNetWindow = viewport.height < 480 || viewport.width < 420;
    const spreadLimit = safetyNetWindow ? 1.6 : (viewport.width > viewport.height ? 1.22 : 1.45);
    assert(
      scaleSpread <= spreadLimit,
      `${viewport.name}: fitted-scale spread ${scaleSpread.toFixed(3)} exceeds ${spreadLimit} (${JSON.stringify(fittedScales)})`
    );
    if (viewport.width > 900 && viewport.width > viewport.height) {
      assert.deepEqual(
        await textProportionIssues(frame),
        [],
        `${viewport.name}: text-band proportion drift`
      );
    }

    const deckBounds = await frame.locator('#deck').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });
    assert.equal(deckBounds.left, 0, `${viewport.name}: deck inherited a horizontal offset`);
    assert.equal(deckBounds.top, 0, `${viewport.name}: deck inherited a vertical offset`);
    assert.equal(deckBounds.right, deckBounds.viewportWidth, `${viewport.name}: deck exceeds iframe width`);

    const outer = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      hash: location.hash
    }));
    assert(outer.scrollWidth <= outer.clientWidth, `${viewport.name}: outer horizontal overflow`);
    assert(outer.scrollHeight <= outer.clientHeight, `${viewport.name}: outer vertical overflow`);
    assert.equal(outer.hash, '#c-results', `${viewport.name}: direct hash did not persist`);

    assert.equal(await frame.locator('#deckCounter').textContent(), '7 / 10');
    await page.locator('#presentationModeToggle').focus();
    await page.keyboard.press('ArrowRight');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '8 / 10');
    await page.keyboard.press('ArrowLeft');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '7 / 10');
    await frame.locator('#deck').focus();
    await page.keyboard.press('ArrowRight');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '8 / 10');
    await page.keyboard.press('ArrowLeft');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '7 / 10');
    await frame.locator('#deckNext').click();
    assert.equal(await frame.locator('#deckCounter').textContent(), '8 / 10');
    await page.keyboard.press('ArrowRight');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '9 / 10');
    await page.keyboard.press('ArrowLeft');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '8 / 10');
    assert.deepEqual(
      await resultsModelLayoutIssues(frame),
      [],
      `${viewport.name}: framed model-results layout collision`
    );
    assert.deepEqual(
      await resultsSummaryTypographyIssues(frame),
      [],
      `${viewport.name}: framed model-results typography drift`
    );
    const rowOverlaps = await frame.locator('.active .strict-mono-row').evaluateAll((rows) => {
      const overlaps = (first, second) => !(
        first.right <= second.left + 0.5
        || second.right <= first.left + 0.5
        || first.bottom <= second.top + 0.5
        || second.bottom <= first.top + 0.5
      );
      return rows.flatMap((row) => {
        const model = row.querySelector('.strict-mono-model').getBoundingClientRect();
        const track = row.querySelector('.strict-mono-track').getBoundingClientRect();
        const value = row.querySelector(':scope > span').getBoundingClientRect();
        return [
          ['model-track', model, track],
          ['model-value', model, value],
          ['track-value', track, value]
        ].filter(([, first, second]) => overlaps(first, second))
          .map(([pair]) => `${row.textContent.trim()}: ${pair}`);
      });
    });
    assert.deepEqual(rowOverlaps, [], `${viewport.name}: model chart labels overlap`);
    await frame.locator('#deckPrev').click();
    assert.equal(await frame.locator('#deckCounter').textContent(), '7 / 10');
    await frame.locator('body').press('Home');
    assert.equal(await frame.locator('#deckCounter').textContent(), '1 / 10');
    await frame.locator('body').press('End');
    assert.equal(await frame.locator('#deckCounter').textContent(), '10 / 10');

    const approvedLinks = await frame.locator('[data-paper-link]:not([hidden])').evaluateAll((elements) => (
      elements.map((element) => ({ id: element.dataset.paperLink, href: element.href }))
    ));
    assert.equal(approvedLinks.length, 9, `${viewport.name}: visible paper-link instances changed`);
    assert(approvedLinks.every((link) => /^https:\/\//.test(link.href)), `${viewport.name}: invalid paper link`);

    const pretextOverflow = await frame.locator('.pretext-managed').evaluateAll((elements) => (
      elements.filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => `${element.closest('.editorial-slide')?.id}: ${element.textContent.trim()}`)
    ));
    assert.deepEqual(pretextOverflow, [], `${viewport.name}: Pretext-managed text overflow`);
    const pretextUsage = await frame.locator('.pretext-managed').evaluateAll((elements) => ({
      managedBlocks: elements.length,
      renderedLines: elements.reduce((total, element) => total + element.querySelectorAll(':scope > .pt-line').length, 0),
      incomplete: elements.filter((element) => (
        element.querySelectorAll(':scope > .pt-line').length === 0
        || element.textContent.trim() !== element.dataset.pretextText
      )).map((element) => element.dataset.pretextText),
      rewrappedLines: elements.flatMap((element) => (
        Array.from(element.querySelectorAll(':scope > .pt-line')).flatMap((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          return range.getClientRects().length > 1 ? [line.textContent] : [];
        })
      ))
    }));
    assert.equal(pretextUsage.managedBlocks, result.pretext.managedBlocks, `${viewport.name}: Pretext block count drifted`);
    assert(pretextUsage.renderedLines >= pretextUsage.managedBlocks, `${viewport.name}: Pretext did not emit line spans`);
    assert.deepEqual(pretextUsage.incomplete, [], `${viewport.name}: Pretext output is incomplete`);
    assert.deepEqual(pretextUsage.rewrappedLines, [], `${viewport.name}: Pretext lines wrapped again in the DOM`);
    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-coherence' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '3 / 10');
    assert.deepEqual(
      await coherenceCopyIssues(frame),
      [],
      `${viewport.name}: framed coherence-copy layout drift`
    );

    assert.equal(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
      'light',
      `${viewport.name}: site did not default to light theme`
    );
    assert.equal(
      await frame.evaluate(() => document.documentElement.getAttribute('data-theme')),
      'light',
      `${viewport.name}: deck did not inherit the light default`
    );
    assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Switch to dark mode');
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme')), null);

    await page.evaluate(() => document.getElementById('themeToggle').click());
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
    await page.waitForTimeout(300);
    const darkResult = await diagnostics(frame);
    assert.deepEqual(darkResult.slides.filter((slide) => !slide.fits), [], `${viewport.name}: dark-theme slide overflow`);
    assert.equal(await frame.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme')), 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme-explicit')), 'true');

    await page.evaluate(() => document.getElementById('themeToggle').click());
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    await page.waitForTimeout(300);
    const lightResult = await diagnostics(frame);
    assert.deepEqual(lightResult.slides.filter((slide) => !slide.fits), [], `${viewport.name}: light-theme slide overflow`);
    assert.equal(await frame.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme')), 'light');

    if (viewport.width > 900) {
      await page.locator('#sidebarToggle').click();
      await page.waitForFunction(() => document.body.classList.contains('sidebar-collapsed'));
      await page.waitForTimeout(350);
      const collapsedResult = await diagnostics(frame);
      assert.deepEqual(
        collapsedResult.slides.filter((slide) => !slide.fits),
        [],
        `${viewport.name}: collapsed-sidebar slide overflow`
      );
      await page.locator('#sidebarToggle').click();
      await page.waitForFunction(() => !document.body.classList.contains('sidebar-collapsed'));
    } else {
      await page.locator('#mobileMenuBtn').click();
      await page.waitForTimeout(350);
      assert(await page.locator('#sidebar').evaluate((element) => element.classList.contains('open')));
      assert.equal(await page.locator('#mobileMenuBtn').getAttribute('aria-expanded'), 'true');
      const sidebarEndVisible = await page.locator('#sidebar').evaluate((element) => {
        const scroller = element.querySelector('.nav-pages');
        scroller.scrollTop = scroller.scrollHeight;
        const links = element.querySelectorAll('a');
        const last = links[links.length - 1];
        return last.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 1;
      });
      assert(sidebarEndVisible, `${viewport.name}: mobile drawer cannot reach its final link`);
      await page.evaluate(() => document.getElementById('mobileMenuBtn').click());
      await page.waitForFunction(() => !document.getElementById('sidebar').classList.contains('open'));
    }

    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-comparison' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '6 / 10');
    assert.deepEqual(
      await comparisonLayoutIssues(frame),
      [],
      `${viewport.name}: framed comparison layout collision`
    );
    const motionStates = await frame.evaluate(() => {
      const animated = document.querySelectorAll('.active .animated-tier-face, .active .animated-comparison-mark span');
      const snapshot = (time) => {
        animated.forEach((element) => element.getAnimations().forEach((animation) => {
          animation.pause();
          animation.currentTime = time;
        }));
        const faces = Array.from(document.querySelectorAll('.active .animated-tier-face'));
        const visible = faces.map((element) => ({
          label: element.querySelector('strong').textContent,
          opacity: Number(getComputedStyle(element).opacity),
          rect: element.getBoundingClientRect().toJSON()
        })).sort((first, second) => second.opacity - first.opacity)[0];
        const viewport = document.querySelector('.active .animated-tier-viewport').getBoundingClientRect();
        return {
          label: visible.label,
          contained: visible.rect.left >= viewport.left - 1
            && visible.rect.right <= viewport.right + 1
            && visible.rect.top >= viewport.top - 1
            && visible.rect.bottom <= viewport.bottom + 1
        };
      };
      const forward = [0, 3000, 10000].map(snapshot);
      const reverse = [10000, 3000, 0].map(snapshot);
      return { forward, reverse };
    });
    assert.equal(new Set(motionStates.forward.map((state) => state.label)).size, 3, `${viewport.name}: animation states did not advance`);
    assert(motionStates.forward.every((state) => state.contained), `${viewport.name}: animated tier escaped its viewport`);
    assert.deepEqual(
      motionStates.reverse.map((state) => state.label),
      motionStates.forward.map((state) => state.label).reverse(),
      `${viewport.name}: reverse animation states did not restore`
    );

    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert(await frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    const reducedMotionLabel = await frame.evaluate(() => {
      const faces = Array.from(document.querySelectorAll('.active .animated-tier-face'));
      return faces.map((element) => ({
        label: element.querySelector('strong').textContent,
        opacity: Number(getComputedStyle(element).opacity)
      })).sort((first, second) => second.opacity - first.opacity)[0].label;
    });
    assert.equal(reducedMotionLabel, 'T4', `${viewport.name}: reduced motion did not preserve the static comparison`);

    await page.locator('#presentationModeToggle').click();
    await page.waitForFunction(() => document.body.classList.contains('presentation-mode'));
    await page.waitForTimeout(400);
    const presentationResult = await diagnostics(frame);
    assert.deepEqual(
      presentationResult.slides.filter((slide) => !slide.fits),
      [],
      `${viewport.name}: presentation-mode slide overflow`
    );
    assert.deepEqual(
      await comparisonLayoutIssues(frame),
      [],
      `${viewport.name}: presentation comparison layout collision`
    );
    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-results-models' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '8 / 10');
    assert.deepEqual(
      await resultsModelLayoutIssues(frame),
      [],
      `${viewport.name}: presentation model-results layout collision`
    );
    assert.deepEqual(
      await resultsSummaryTypographyIssues(frame),
      [],
      `${viewport.name}: presentation model-results typography drift`
    );
    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-coherence' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '3 / 10');
    assert.deepEqual(
      await coherenceCopyIssues(frame),
      [],
      `${viewport.name}: presentation coherence-copy layout drift`
    );

    await frame.locator('body').press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('presentation-mode'));

    if (process.env.CAPTURE_SCREENSHOTS === '1') {
      const outputDir = path.join(ROOT, 'qa-artifacts');
      await fs.mkdir(outputDir, { recursive: true });
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
    }

    assert.deepEqual(pageErrors, [], `${viewport.name}: page errors`);
    assert.deepEqual(failedLocalResponses, [], `${viewport.name}: failed local responses`);
    return {
      viewport: viewport.name,
      frame: `${result.slides[0].viewportWidth}x${result.slides[0].viewportHeight}`,
      minimumScale: Math.min(...result.slides.map((slide) => slide.scale)),
      presentationMinimumScale: Math.min(...presentationResult.slides.map((slide) => slide.scale))
    };
  } finally {
    await page.close();
  }
}

(async () => {
  const { baseUrl, server } = await launchPreview();
  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
      headless: true
    });
    for (const viewport of VIEWPORTS) {
      const result = await verifyViewport(browser, baseUrl, viewport);
      console.log(JSON.stringify(result));
    }
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
