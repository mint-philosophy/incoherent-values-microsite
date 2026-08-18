const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PYTHON_COMMAND = process.platform === 'win32' ? 'python' : 'python3';
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
  const server = spawn(PYTHON_COMMAND, ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
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
    const rows = summary ? Array.from(summary.querySelectorAll(':scope > p[data-finding-label]')) : [];
    const control = summary?.querySelector('.results-grouping-control');
    const toggle = control?.querySelector('.results-grouping-toggle');
    if (!summary || rows.length !== 3 || !control || !toggle) {
      return ['model-results summary rows or grouping control are missing'];
    }

    const expectedLabels = ['Average', 'Reasoning', 'Details'];
    const issues = [];
    const summaryStyle = getComputedStyle(summary);
    const styles = rows.map((row) => getComputedStyle(row));
    const flow = [rows[0], rows[1], control, rows[2]];
    const rects = flow.map((element) => element.getBoundingClientRect());
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
        issues.push(`summary flow item ${index + 1} does not meet the preceding item`);
      }
    }
    if (toggle.getAttribute('role') !== 'switch') issues.push('grouping control is not exposed as a switch');
    if (toggle.getAttribute('aria-checked') !== 'false') issues.push('grouping control does not default to score ranking');
    return issues;
  });
}

async function resultsGroupingIssues(frame) {
  return frame.evaluate(async () => {
    const toggle = document.getElementById('resultsGroupingToggle');
    const chart = document.getElementById('strictMonoChart');
    if (!toggle || !chart) return ['grouping switch or chart is missing'];

    const issues = [];
    const originalRows = Array.from(chart.querySelectorAll('.strict-mono-row'));
    const originalOrder = originalRows.map((row) => row.getAttribute('aria-label'));
    const waitForLayout = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const motionRow = originalRows.find((row) => (
      row.classList.contains('model-glm-hybrid') && row.classList.contains('reasoning-on')
    ));
    const motionBefore = motionRow?.getBoundingClientRect();
    const nearlyEqual = (first, second, tolerance = 1.5) => Math.abs(first - second) <= tolerance;
    const motionSample = (row, animation, time) => {
      animation.pause();
      animation.currentTime = time;
      const rect = row.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    };
    const progressedBetween = (start, midpoint, end) => {
      const axis = Math.abs(end.top - start.top) >= Math.abs(end.left - start.left) ? 'top' : 'left';
      const minimum = Math.min(start[axis], end[axis]);
      const maximum = Math.max(start[axis], end[axis]);
      return midpoint[axis] > minimum + 0.5 && midpoint[axis] < maximum - 0.5;
    };
    const rowDetails = (row) => ({
      model: row.querySelector('.strict-mono-model strong')?.textContent.trim(),
      reasoning: row.classList.contains('reasoning-on') ? 'on' : 'off',
      score: Number.parseFloat(row.style.getPropertyValue('--value')) || 0,
      start: row.classList.contains('strict-mono-group-start')
    });

    toggle.click();
    await waitForLayout();

    const forwardAnimation = motionRow?.getAnimations().find((animation) => (
      animation.id === 'strict-mono-reorder'
      && Number(animation.effect?.getTiming().duration) === 500
    ));
    if (!motionRow || !motionBefore || !forwardAnimation) {
      issues.push('grouping did not start a 0.5-second row tween');
    } else {
      const start = motionSample(motionRow, forwardAnimation, 0);
      const midpoint = motionSample(motionRow, forwardAnimation, 250);
      const end = motionSample(motionRow, forwardAnimation, 500);
      if (!nearlyEqual(start.left, motionBefore.left) || !nearlyEqual(start.top, motionBefore.top)) {
        issues.push('forward tween does not begin at the score-ranked position');
      }
      if (!progressedBetween(start, midpoint, end)) issues.push('forward tween does not pass through an intermediate position');
    }
    Array.from(chart.querySelectorAll('.strict-mono-row')).forEach((row) => {
      row.getAnimations().forEach((animation) => animation.finish());
    });
    window.refitDeck();
    await waitForLayout();

    if (toggle.getAttribute('aria-checked') !== 'true') issues.push('grouping switch did not turn on');
    if (!chart.classList.contains('is-grouped')) issues.push('chart did not enter grouped mode');
    if (!chart.getAttribute('aria-label')?.includes('grouped by model')) issues.push('grouped chart label did not update');

    const groupedRows = Array.from(chart.querySelectorAll('.strict-mono-row'));
    const groups = [];
    groupedRows.forEach((row) => {
      const detail = rowDetails(row);
      if (detail.start || groups.length === 0) groups.push([]);
      groups.at(-1).push(detail);
    });

    const originalCounts = originalRows.reduce((counts, row) => {
      const model = rowDetails(row).model;
      counts.set(model, (counts.get(model) || 0) + 1);
      return counts;
    }, new Map());

    groups.forEach((group, index) => {
      if (new Set(group.map((row) => row.model)).size !== 1) {
        issues.push(`group ${index + 1} contains multiple models`);
      }
      const expectedCount = originalCounts.get(group[0]?.model);
      if (group.length !== expectedCount) issues.push(`${group[0]?.model} is split across groups`);
      if (group.length === 2 && group.map((row) => row.reasoning).join('/') !== 'on/off') {
        issues.push(`${group[0].model} is not ordered reasoning on/off`);
      }
    });

    const topScores = groups.map((group) => Math.max(...group.map((row) => row.score)));
    for (let index = 1; index < topScores.length; index += 1) {
      if (topScores[index] > topScores[index - 1] + 0.01) {
        issues.push('model groups are not ranked by their top score');
        break;
      }
    }

    const spacedStarts = groupedRows.filter((row, index) => index > 0 && row.classList.contains('strict-mono-group-start'));
    if (spacedStarts.some((row) => (Number.parseFloat(getComputedStyle(row).marginTop) || 0) <= 0)) {
      issues.push('model groups do not have added separation');
    }

    const diagnostic = window.__deckDiagnostics.slides.find((slide) => slide.id === 'c-results-models');
    if (!diagnostic?.fits) issues.push('grouped chart does not fit its slide');

    const groupedMotionPosition = motionRow?.getBoundingClientRect();
    toggle.click();
    await waitForLayout();
    const reverseAnimation = motionRow?.getAnimations().find((animation) => (
      animation.id === 'strict-mono-reorder'
      && Number(animation.effect?.getTiming().duration) === 500
    ));
    if (!motionRow || !groupedMotionPosition || !reverseAnimation) {
      issues.push('restoring score rank did not start a 0.5-second row tween');
    } else {
      const start = motionSample(motionRow, reverseAnimation, 0);
      const midpoint = motionSample(motionRow, reverseAnimation, 250);
      const end = motionSample(motionRow, reverseAnimation, 500);
      if (!nearlyEqual(start.left, groupedMotionPosition.left) || !nearlyEqual(start.top, groupedMotionPosition.top)) {
        issues.push('reverse tween does not begin at the grouped position');
      }
      if (!progressedBetween(start, midpoint, end)) issues.push('reverse tween does not pass through an intermediate position');
    }
    Array.from(chart.querySelectorAll('.strict-mono-row')).forEach((row) => {
      row.getAnimations().forEach((animation) => animation.finish());
    });
    window.refitDeck();
    await waitForLayout();
    const restoredOrder = Array.from(chart.querySelectorAll('.strict-mono-row'))
      .map((row) => row.getAttribute('aria-label'));
    if (toggle.getAttribute('aria-checked') !== 'false') issues.push('grouping switch did not turn off');
    if (chart.classList.contains('is-grouped')) issues.push('chart remained grouped after reset');
    if (restoredOrder.some((label, index) => label !== originalOrder[index])) {
      issues.push('score ranking was not restored');
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
      'c-upshot': ['result', 'confirm'],
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
        if (markerStyle.backgroundImage !== 'none') issues.push(`${slideId}: row ${index + 1} marker still uses an image`);
        if (!pixelValue(markerStyle.width) || pixelValue(markerStyle.width) >= pixelValue(style.fontSize)) {
          issues.push(`${slideId}: row ${index + 1} marker is missing or oversized`);
        }
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
    const diagramElement = slide?.querySelector('.coherence-cycle-diagram');
    const diagram = diagramElement?.getBoundingClientRect();
    const copy = slide?.querySelector('.coherence-forced-choice-copy');
    const copyRect = copy?.getBoundingClientRect();
    const rows = copy ? Array.from(copy.children) : [];
    if (!slide || !plane || !heading || !diagramElement || !diagram || !copy || !copyRect || rows.length !== 4) {
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
    if (getComputedStyle(diagramElement).alignSelf !== 'center') issues.push('coherence diagram is not vertically centered');
    if (getComputedStyle(copy).alignSelf !== 'center') issues.push('coherence copy is not vertically centered');
    const sideBySide = diagram.right <= copyRect.left + 0.5 || copyRect.right <= diagram.left + 0.5;
    const centerDifference = Math.abs(
      ((diagram.top + diagram.bottom) / 2) - ((copyRect.top + copyRect.bottom) / 2),
    );
    if (sideBySide && centerDifference > 1) {
      issues.push(`coherence visual and copy centers differ by ${centerDifference.toFixed(1)}px`);
    }
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
      const markerStyle = getComputedStyle(row, '::before');
      if (markerStyle.backgroundImage !== 'none') issues.push(`row ${index + 1} marker still uses an image`);
      if (!pixelValue(markerStyle.width) || pixelValue(markerStyle.width) >= fontSize) {
        issues.push(`row ${index + 1} marker is missing or oversized`);
      }
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
    const visualElement = document.querySelector('#c-comparison .comparison-visual-stack');
    const visual = visualElement?.getBoundingClientRect();
    const chart = document.querySelector('#c-comparison .monotonicity-example-card')?.getBoundingClientRect();
    const copyElement = document.querySelector('#c-comparison .editorial-copy');
    const copy = copyElement?.getBoundingClientRect();
    if (!visualElement || !visual || !chart || !copyElement || !copy) return ['comparison elements are missing'];

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
    if (getComputedStyle(visualElement).alignSelf !== 'center') issues.push('comparison visual is not vertically centered');
    if (getComputedStyle(copyElement).alignSelf !== 'center') issues.push('comparison copy is not vertically centered');
    const sideBySide = visual.right <= copy.left + 0.5 || copy.right <= visual.left + 0.5;
    const centerDifference = Math.abs(
      ((visual.top + visual.bottom) / 2) - ((copy.top + copy.bottom) / 2),
    );
    if (sideBySide && centerDifference > 1) {
      issues.push(`comparison visual and copy centers differ by ${centerDifference.toFixed(1)}px`);
    }
    return issues;
  });
}

async function ladderMergedLayoutIssues(frame) {
  return frame.evaluate(() => {
    const layout = document.querySelector('#c-ladder .ladder-merged-layout')?.getBoundingClientRect();
    const copy = document.querySelector('#c-ladder .ladder-method-copy')?.getBoundingClientRect();
    const panel = document.querySelector('#c-ladder .ladder-example-panel')?.getBoundingClientRect();
    const disclosureElement = document.querySelector('#c-ladder .ladder-example-disclosure');
    const titleElement = document.querySelector('#c-ladder .ladder-example-title');
    const title = document.querySelector('#c-ladder .ladder-example-panel > h3')?.getBoundingClientRect();
    const ladder = document.querySelector('#c-ladder .vertical-ladder')?.getBoundingClientRect();
    const rows = Array.from(document.querySelectorAll('#c-ladder .ladder-tier'));
    const emphasis = document.querySelector('#c-ladder .value-ladders-emphasis');
    const result = document.querySelector('#c-ladder .ladder-consistency-card > strong');
    const referenceDisclosure = document.querySelector('.monotonicity-example-disclosure');
    const referenceTitle = document.querySelector('.monotonicity-example-title');
    if (!layout || !copy || !panel || !disclosureElement || !titleElement || !title || !ladder
        || rows.length !== 7 || !emphasis || !result || !referenceDisclosure || !referenceTitle) {
      return ['merged ladder elements or seven example rows are missing'];
    }

    const within = (child, parent) => child.left >= parent.left - 0.5
      && child.right <= parent.right + 0.5
      && child.top >= parent.top - 0.5
      && child.bottom <= parent.bottom + 0.5;
    const overlaps = (first, second) => !(first.right <= second.left + 0.5
      || second.right <= first.left + 0.5
      || first.bottom <= second.top + 0.5
      || second.bottom <= first.top + 0.5);
    const issues = [];
    const disclosureStyle = getComputedStyle(disclosureElement);
    const titleStyle = getComputedStyle(titleElement);
    const referenceDisclosureStyle = getComputedStyle(referenceDisclosure);
    const referenceTitleStyle = getComputedStyle(referenceTitle);
    if (!within(copy, layout)) issues.push('method copy escapes merged layout');
    if (!within(panel, layout)) issues.push('example panel escapes merged layout');
    if (overlaps(copy, panel)) issues.push('method copy overlaps example ladder');
    if (overlaps(title, ladder)) issues.push('example label overlaps ladder');
    if (copy.right <= panel.left && panel.left - copy.right > parseFloat(titleStyle.fontSize) * 0.7) {
      issues.push('merged ladder column gap is too wide');
    }
    if (disclosureStyle.color !== referenceDisclosureStyle.color
        || disclosureStyle.fontFamily !== referenceDisclosureStyle.fontFamily) {
      issues.push('example disclosure does not match the later illustrative-example cards');
    }
    if (titleStyle.fontFamily !== referenceTitleStyle.fontFamily
        || titleStyle.fontWeight !== referenceTitleStyle.fontWeight
        || parseFloat(titleStyle.fontSize) <= parseFloat(disclosureStyle.fontSize) * 1.5) {
      issues.push('example title does not match the later illustrative-example hierarchy');
    }
    if (parseFloat(getComputedStyle(document.querySelector('#c-ladder .ladder-example-panel')).borderTopWidth) < 1) {
      issues.push('example ladder card frame is missing');
    }
    if (getComputedStyle(emphasis).color !== getComputedStyle(result).color) {
      issues.push('value-ladders emphasis does not match the 97.3% blue');
    }
    if (!rows.every((row) => row.tabIndex === 0 && row.getAttribute('aria-describedby'))) {
      issues.push('not every ladder row exposes keyboard-accessible detail');
    }
    if (!rows.every((row) => getComputedStyle(row.querySelector('.ladder-tier-summary')).whiteSpace === 'nowrap')) {
      issues.push('ladder summaries are not held to one line');
    }
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
      ['c-ladder', '.ladder-method-copy'],
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

    assert.equal(result.slideCount, 9, `${viewport.name}: unexpected slide count`);
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
    assert.deepEqual(
      await ladderMergedLayoutIssues(frame),
      [],
      `${viewport.name}: merged ladder layout drift`
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

    assert.equal(await frame.locator('#deckCounter').textContent(), '6 / 9');
    await page.locator('#presentationModeToggle').focus();
    await page.keyboard.press('ArrowRight');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '7 / 9');
    await page.keyboard.press('ArrowLeft');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '6 / 9');
    await frame.locator('#deck').focus();
    await page.keyboard.press('ArrowRight');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '7 / 9');
    await page.keyboard.press('ArrowLeft');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '6 / 9');
    await frame.locator('#deckNext').click();
    assert.equal(await frame.locator('#deckCounter').textContent(), '7 / 9');
    await page.keyboard.press('ArrowRight');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '8 / 9');
    await page.keyboard.press('ArrowLeft');
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '7 / 9');
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
    assert.deepEqual(
      await resultsGroupingIssues(frame),
      [],
      `${viewport.name}: reasoning-group toggle drift`
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
    assert.equal(await frame.locator('#deckCounter').textContent(), '6 / 9');
    await frame.locator('body').press('Home');
    assert.equal(await frame.locator('#deckCounter').textContent(), '1 / 9');
    const titleNextCue = frame.locator('.title-next-cue');
    assert.equal(await titleNextCue.getAttribute('href'), '#c-overview', `${viewport.name}: title next-slide cue target changed`);
    assert.match(
      (await titleNextCue.textContent()).replace(/\s+/g, ' ').trim(),
      /^Next slide → \(use arrow keys, or controls at bottom corners\)$/,
      `${viewport.name}: title next-slide cue copy changed`
    );
    await titleNextCue.press('Enter');
    assert.equal(await frame.locator('#deckCounter').textContent(), '2 / 9');
    await frame.locator('body').press('Home');
    assert.equal(await frame.locator('#deckCounter').textContent(), '1 / 9');
    await frame.locator('body').press('End');
    assert.equal(await frame.locator('#deckCounter').textContent(), '9 / 9');

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

    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-ladder' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '4 / 9');
    const originalLadderRow = frame.locator('#c-ladder .ladder-tier-original');
    const originalLadderTooltip = frame.locator('#ladder-t4-detail');
    await originalLadderRow.hover();
    await page.waitForTimeout(180);
    assert.deepEqual(
      await originalLadderTooltip.evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
        visibility: getComputedStyle(element).visibility
      })),
      { opacity: '1', visibility: 'visible' },
      `${viewport.name}: full T4 row does not expose detail on hover`
    );
    await originalLadderRow.focus();
    await page.waitForTimeout(180);
    assert.deepEqual(
      await originalLadderTooltip.evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
        visibility: getComputedStyle(element).visibility
      })),
      { opacity: '1', visibility: 'visible' },
      `${viewport.name}: full T4 row does not expose detail on keyboard focus`
    );

    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-coherence' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '3 / 9');
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
    const titleThemeToggle = frame.locator('#titleThemeToggle');
    assert.equal(await titleThemeToggle.getAttribute('aria-label'), 'Switch to dark mode');
    assert.equal(await titleThemeToggle.getAttribute('aria-pressed'), 'false');
    assert.equal((await titleThemeToggle.textContent()).replace(/\s+/g, ' ').trim(), '☾ Dark mode');
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme')), null);

    await frame.evaluate(() => document.getElementById('titleThemeToggle').click());
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
    await page.waitForTimeout(300);
    const darkResult = await diagnostics(frame);
    assert.deepEqual(darkResult.slides.filter((slide) => !slide.fits), [], `${viewport.name}: dark-theme slide overflow`);
    assert.equal(await frame.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme')), 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme-explicit')), 'true');
    assert.equal(await page.locator('#themeToggle').getAttribute('aria-label'), 'Switch to light mode');
    assert.equal(await titleThemeToggle.getAttribute('aria-label'), 'Switch to light mode');
    assert.equal(await titleThemeToggle.getAttribute('aria-pressed'), 'true');
    assert.equal((await titleThemeToggle.textContent()).replace(/\s+/g, ' ').trim(), '☀ Light mode');

    await page.evaluate(() => document.getElementById('themeToggle').click());
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    await page.waitForTimeout(300);
    const lightResult = await diagnostics(frame);
    assert.deepEqual(lightResult.slides.filter((slide) => !slide.fits), [], `${viewport.name}: light-theme slide overflow`);
    assert.equal(await frame.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('mint-theme')), 'light');
    assert.equal(await titleThemeToggle.getAttribute('aria-label'), 'Switch to dark mode');
    assert.equal(await titleThemeToggle.getAttribute('aria-pressed'), 'false');
    assert.equal((await titleThemeToggle.textContent()).replace(/\s+/g, ' ').trim(), '☾ Dark mode');

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
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '5 / 9');
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

    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-results-models' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '7 / 9');
    const reducedGroupingMotion = await frame.evaluate(async () => {
      const toggle = document.getElementById('resultsGroupingToggle');
      const chart = document.getElementById('strictMonoChart');
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      toggle.click();
      await settle();
      const animations = Array.from(chart.querySelectorAll('.strict-mono-row'))
        .flatMap((row) => row.getAnimations());
      const rowAnimations = animations.filter((animation) => (
        animation.id === 'strict-mono-reorder'
        && animation.playState !== 'finished'
        && animation.playState !== 'idle'
      )).length;
      const grouped = toggle.getAttribute('aria-checked') === 'true';
      toggle.click();
      await settle();
      window.refitDeck();
      return {
        grouped,
        rowAnimations,
        restored: toggle.getAttribute('aria-checked') === 'false'
      };
    });
    assert.deepEqual(
      reducedGroupingMotion,
      { grouped: true, rowAnimations: 0, restored: true },
      `${viewport.name}: reduced motion did not make chart regrouping instantaneous`
    );
    await frame.evaluate(() => window.postMessage({ type: 'mint-deck-go', id: 'c-comparison' }, location.origin));
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '5 / 9');

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
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '7 / 9');
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
    await frame.waitForFunction(() => document.getElementById('deckCounter').textContent === '3 / 9');
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
