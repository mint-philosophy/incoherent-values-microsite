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
      && result.config.status !== 'loading';
  });
  return frame.evaluate(() => window.__deckDiagnostics);
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
    const frame = page.frames().find((candidate) => candidate.url().includes('/deck.html'));
    assert(frame, `${viewport.name}: deck iframe was not loaded`);
    const result = await diagnostics(frame);

    assert.equal(result.slideCount, 10, `${viewport.name}: unexpected slide count`);
    assert.equal(result.pretext.status, 'ready', `${viewport.name}: Pretext did not load`);
    assert(result.pretext.managedBlocks >= 20, `${viewport.name}: too few Pretext-managed blocks`);
    assert.equal(result.config.status, 'ready', `${viewport.name}: paper config did not load`);
    assert.equal(result.config.approvedLinks, 5, `${viewport.name}: approved link count changed`);
    assert.deepEqual(result.slides.filter((slide) => !slide.fits), [], `${viewport.name}: framed slide overflow`);

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
    await frame.locator('#deckNext').click();
    assert.equal(await frame.locator('#deckCounter').textContent(), '8 / 10');
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

    await page.evaluate(() => document.getElementById('themeToggle').click());
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    await page.waitForTimeout(300);
    const lightResult = await diagnostics(frame);
    assert.deepEqual(lightResult.slides.filter((slide) => !slide.fits), [], `${viewport.name}: light-theme slide overflow`);
    assert.equal(await frame.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
    await page.evaluate(() => document.getElementById('themeToggle').click());
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));

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
