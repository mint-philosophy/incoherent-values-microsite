const PRETEXT_URLS = [
  'https://esm.sh/@chenglou/pretext@0.0.8',
  'https://cdn.jsdelivr.net/npm/@chenglou/pretext@0.0.8/+esm'
];

const MIN_FIT_SCALE = 0.55;
const FIT_ITERATIONS = 9;
const FRAME_INSET = 2;

const deck = document.getElementById('deck');
const slides = Array.from(document.querySelectorAll('.editorial-slide'));
const previousButton = document.getElementById('deckPrev');
const nextButton = document.getElementById('deckNext');
const counter = document.getElementById('deckCounter');
const slideName = document.getElementById('deckSlideName');

const state = {
  index: 0,
  fitFrame: 0,
  pretext: null,
  pretextSource: null,
  preparedCache: new Map(),
  pretextTargets: [],
  touchStartX: null,
  touchStartY: null,
  emptyRetries: 0
};

window.__deckDiagnostics = {
  ready: false,
  current: 0,
  slideCount: slides.length,
  pretext: {
    status: 'loading',
    source: null,
    engine: 'prepareWithSegments + layoutNextLine',
    fontsReady: false,
    managedBlocks: 0,
    layoutRuns: 0,
    cacheSize: 0,
    lastLayoutMs: 0
  },
  config: { status: 'loading', approvedLinks: 0 },
  slides: []
};

async function loadPaperConfig() {
  try {
    const response = await fetch('paper.config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    const shortTitle = document.querySelector('[data-paper-short-title]');
    const subtitle = document.querySelector('[data-paper-subtitle]');
    const authors = document.querySelector('[data-paper-authors]');
    if (shortTitle && config.shortTitle) {
      shortTitle.textContent = config.shortTitle;
      shortTitle.dataset.pretextText = config.shortTitle;
    }
    if (subtitle) {
      subtitle.textContent = config.subtitle || '';
      subtitle.dataset.pretextText = config.subtitle || '';
      subtitle.hidden = !config.subtitle;
    }
    if (authors && Array.isArray(config.authors)) {
      authors.replaceChildren(...config.authors.map((author) => {
        const element = document.createElement('span');
        element.textContent = author;
        return element;
      }));
    }
    const approvedLinks = new Map((config.links || [])
      .filter((link) => link.approvedForPublication === true && link.id && link.url)
      .map((link) => [link.id, link]));

    document.querySelectorAll('[data-paper-link]').forEach((element) => {
      const link = approvedLinks.get(element.dataset.paperLink);
      if (!link) {
        element.hidden = true;
        element.removeAttribute('href');
        element.removeAttribute('target');
        element.removeAttribute('rel');
        return;
      }
      element.href = link.url;
      element.target = '_blank';
      element.rel = 'noreferrer';
      element.hidden = false;
    });
    window.__deckDiagnostics.config = {
      status: 'ready',
      approvedLinks: approvedLinks.size
    };
    scheduleFit();
  } catch (error) {
    window.__deckDiagnostics.config = {
      status: 'unavailable-links-hidden',
      approvedLinks: 0,
      error: error.message
    };
    console.error('Could not load paper.config.json', error);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function wrapSlideContents() {
  slides.forEach((slide) => {
    if (slide.firstElementChild?.classList.contains('slide-plane')) return;
    const plane = document.createElement('div');
    plane.className = 'slide-plane';
    plane.style.setProperty('--fit-scale', '1');
    while (slide.firstChild) plane.append(slide.firstChild);
    slide.append(plane);
  });
}

function preparePretextTargets() {
  const candidates = document.querySelectorAll([
    '.slide-plane h1',
    '.slide-plane h2',
    '.slide-plane h3',
    '.slide-plane .editorial-copy p',
    '.slide-plane .prototype-c-subtitle',
    '.slide-plane .upshot-statement strong'
  ].join(','));

  state.pretextTargets = Array.from(candidates).filter((element) => {
    if (element.hasAttribute('data-pretext-native')) return false;
    if (element.children.length > 0) return false;
    const text = element.textContent.trim();
    const isSlidePoint = element.matches('.slide-points > p');
    if (!text || (text.length < 28 && !element.matches('h1, h2, h3') && !isSlidePoint)) return false;
    element.dataset.pretextText = text;
    element.classList.add('pretext-managed');
    return true;
  });
  window.__deckDiagnostics.pretext.managedBlocks = state.pretextTargets.length;
}

function fontSpec(element) {
  const style = getComputedStyle(element);
  const fontStyle = style.fontStyle === 'normal' ? '' : `${style.fontStyle} `;
  const fontWeight = style.fontWeight ? `${style.fontWeight} ` : '';
  return `${fontStyle}${fontWeight}${style.fontSize} ${style.fontFamily}`;
}

function preparedText(text, font) {
  const key = `${font}\n${text}`;
  if (state.preparedCache.has(key)) return state.preparedCache.get(key);
  if (state.preparedCache.size > 3000) state.preparedCache.clear();
  const prepared = state.pretext.prepareWithSegments(text, font);
  state.preparedCache.set(key, prepared);
  window.__deckDiagnostics.pretext.cacheSize = state.preparedCache.size;
  return prepared;
}

function computePretextLines(text, font, width) {
  const prepared = preparedText(text, font);
  const lines = [];
  let cursor = { segmentIndex: 0, graphemeIndex: 0 };
  for (let guard = 0; guard < 120; guard += 1) {
    const line = state.pretext.layoutNextLine(prepared, cursor, Math.max(72, Math.floor(width)));
    if (!line) break;
    lines.push(line.text || '');
    cursor = line.end;
    if (!cursor) break;
  }
  return lines.length ? lines : [text];
}

function layoutPretext(slide, scale = 1) {
  if (!state.pretext) return;
  const started = performance.now();
  const targets = state.pretextTargets.filter((element) => slide.contains(element));
  const reads = targets.map((element) => {
    const style = getComputedStyle(element);
    const horizontalInsets = [
      style.paddingLeft,
      style.paddingRight,
      style.borderLeftWidth,
      style.borderRightWidth
    ].reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
    return {
      element,
      text: element.dataset.pretextText,
      font: fontSpec(element),
      width: element.getBoundingClientRect().width / Math.max(scale, 0.01) - horizontalInsets
    };
  }).filter((item) => item.width > 1);
  const layouts = reads.map((item) => computePretextLines(item.text, item.font, item.width));
  reads.forEach((item, index) => {
    item.element.innerHTML = layouts[index]
      .map((line) => `<span class="pt-line">${escapeHtml(line)}</span>`)
      .join('');
  });
  window.__deckDiagnostics.pretext.layoutRuns += 1;
  window.__deckDiagnostics.pretext.lastLayoutMs = Math.round((performance.now() - started) * 100) / 100;
}

function setSlideScale(slide, scale) {
  slide.querySelector('.slide-plane')?.style.setProperty('--fit-scale', String(scale));
  layoutPretext(slide, scale);
}

function visibleContentBounds(slide) {
  const slideRect = slide.getBoundingClientRect();
  const plane = slide.querySelector('.slide-plane');
  const selectors = [
    ':scope > *',
    'p',
    'h1',
    'h2',
    'h3',
    'nav',
    '.cycle-node',
    '.cycle-key',
    '.cycle-warning',
    '.ladder-tier',
    '.tier-order-strip',
    '.ladder-consistency-card',
    '.strict-mono-row',
    '.strict-mono-footer',
    '.result-example-context',
    '.curve-bars-large',
    '.research-links-secondary > a',
    '.paper-link-primary'
  ].join(',');
  const elements = plane ? Array.from(plane.querySelectorAll(selectors)) : [];
  const bounds = {
    top: slideRect.bottom,
    right: slideRect.left,
    bottom: slideRect.top,
    left: slideRect.right
  };
  let found = false;

  const edgeSetters = { top: null, right: null, bottom: null, left: null };
  const describe = (element) => `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0] || ''}`;
  elements.forEach((element) => {
    if (element.closest('.ladder-tier-tooltip, .curve-guide-overlay, .animated-tier-face')) return;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    found = true;
    if (rect.top < bounds.top) { bounds.top = rect.top; edgeSetters.top = describe(element); }
    if (rect.right > bounds.right) { bounds.right = rect.right; edgeSetters.right = describe(element); }
    if (rect.bottom > bounds.bottom) { bounds.bottom = rect.bottom; edgeSetters.bottom = describe(element); }
    if (rect.left < bounds.left) { bounds.left = rect.left; edgeSetters.left = describe(element); }
  });
  bounds.edgeSetters = edgeSetters;

  if (!found) {
    // An empty measurement (mid-load, hidden subtree) cannot overflow; report
    // zero-size bounds so a transient never locks the slide at minimum scale.
    // The caller retries shortly, because this result is not trustworthy.
    return {
      top: slideRect.top,
      right: slideRect.left,
      bottom: slideRect.top,
      left: slideRect.left,
      empty: true
    };
  }
  return bounds;
}

function measureSlide(slide, scale) {
  setSlideScale(slide, scale);
  // The first Pretext pass can change an intrinsic grid track; the second pass
  // measures line widths against that settled track at the same candidate scale.
  setSlideScale(slide, scale);
  const frame = slide.getBoundingClientRect();
  const content = visibleContentBounds(slide);
  const fits = content.top >= frame.top - 0.5
    && content.left >= frame.left - 0.5
    && content.right <= frame.right - FRAME_INSET + 0.5
    && content.bottom <= frame.bottom - FRAME_INSET + 0.5;
  return { fits, frame, content };
}

function fitSlide(slide) {
  const wasActive = slide.classList.contains('active');
  if (!wasActive) slide.classList.add('fit-measuring');

  let result = measureSlide(slide, 1);
  let scale = 1;

  if (!result.fits) {
    const minimumResult = measureSlide(slide, MIN_FIT_SCALE);
    if (!minimumResult.fits) {
      scale = MIN_FIT_SCALE;
      result = minimumResult;
    } else {
      let lower = MIN_FIT_SCALE;
      let upper = 1;
      let best = MIN_FIT_SCALE;
      result = minimumResult;
      for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
        const candidate = Math.round(((lower + upper) / 2) * 1000) / 1000;
        const candidateResult = measureSlide(slide, candidate);
        if (candidateResult.fits) {
          best = candidate;
          result = candidateResult;
          lower = candidate;
        } else {
          upper = candidate;
        }
      }
      scale = best;
      result = measureSlide(slide, scale);
    }
  }

  // Replacing Pretext line spans can change an intrinsic grid track after the
  // binary search. Apply a bounded correction from the measured overflow, then
  // confirm the candidate against the resulting line layout.
  if (!result.fits && scale > MIN_FIT_SCALE) {
    for (let attempt = 0; attempt < 4 && !result.fits; attempt += 1) {
      const availableWidth = result.frame.width - FRAME_INSET;
      const availableHeight = result.frame.height - FRAME_INSET;
      const contentWidth = result.content.right - result.frame.left;
      const contentHeight = result.content.bottom - result.frame.top;
      const measuredRatio = Math.min(
        availableWidth / Math.max(contentWidth, 1),
        availableHeight / Math.max(contentHeight, 1),
        0.98
      );
      const corrected = Math.floor(scale * measuredRatio * 0.995 * 1000) / 1000;
      const nextScale = Math.min(scale - 0.01, corrected);
      scale = Math.max(MIN_FIT_SCALE, Number(nextScale.toFixed(3)));
      result = measureSlide(slide, scale);
      if (result.fits) {
        result = measureSlide(slide, scale);
      }
    }
  }

  slide.classList.remove('fit-contained', 'fit-overflow');
  slide.classList.add(result.fits ? 'fit-contained' : 'fit-overflow');
  slide.dataset.fitScale = scale.toFixed(3);
  slide.dataset.fitStatus = result.fits ? 'contained' : 'overflow';
  if (!wasActive) slide.classList.remove('fit-measuring');

  const frame = result.frame;
  return {
    id: slide.id,
    label: slide.dataset.navLabel || slide.id,
    scale: Number(scale.toFixed(3)),
    fits: result.fits,
    viewportWidth: Math.round(frame.width),
    viewportHeight: Math.round(frame.height),
    contentTop: Math.round(result.content.top - frame.top),
    contentRight: Math.round(result.content.right - frame.left),
    contentBottom: Math.round(result.content.bottom - frame.top),
    contentLeft: Math.round(result.content.left - frame.left),
    edgeSetters: result.content.edgeSetters || null,
    measuredEmpty: Boolean(result.content.empty)
  };
}

function drawCurveGuides() {
  document.querySelectorAll('.active .monotonic-result-curve, .active .incoherence-result-curve').forEach((chart) => {
    let overlay = chart.querySelector('.curve-guide-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'curve-guide-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      chart.append(overlay);
    }
    overlay.replaceChildren();
    const overlayRect = overlay.getBoundingClientRect();
    const bars = Array.from(chart.querySelectorAll('.curve-column')).map((column) => ({
      color: getComputedStyle(column).getPropertyValue('--bar-color').trim() || 'var(--blue)',
      rect: column.querySelector('i').getBoundingClientRect()
    }));

    const addSegment = (x, y, width, angle = 0, color = 'var(--blue)') => {
      const segment = document.createElement('i');
      segment.className = 'curve-guide-segment';
      segment.style.left = `${x}px`;
      segment.style.top = `${y}px`;
      segment.style.width = `${width}px`;
      segment.style.transform = `rotate(${angle}deg)`;
      segment.style.setProperty('--guide-color', color);
      overlay.append(segment);
    };

    bars.forEach(({ color, rect: bar }, index) => {
      const left = bar.left - overlayRect.left;
      const top = bar.top - overlayRect.top;
      addSegment(left, top, bar.width, 0, color);
      const next = bars[index + 1];
      if (!next) return;
      const startX = bar.right - overlayRect.left;
      const startY = top;
      const endX = next.rect.left - overlayRect.left;
      const endY = next.rect.top - overlayRect.top;
      const deltaX = endX - startX;
      const deltaY = endY - startY;
      const connectorColor = chart.classList.contains('incoherence-result-curve') && endY > startY + 0.5
        ? 'var(--red)'
        : 'var(--blue)';
      addSegment(startX, startY, Math.hypot(deltaX, deltaY), Math.atan2(deltaY, deltaX) * 180 / Math.PI, connectorColor);
    });
  });
}

function fitAllSlides() {
  const results = slides.map(fitSlide);
  window.__deckDiagnostics.slides = results;
  window.__deckDiagnostics.ready = true;
  window.__deckDiagnostics.current = state.index;
  // Empty measurements come from resources landing mid-pass (fonts, images,
  // shell sizing); their fits are provisional, so measure again shortly.
  if (results.some((result) => result.measuredEmpty) && state.emptyRetries < 8) {
    state.emptyRetries += 1;
    setTimeout(scheduleFit, 180);
  }
  requestAnimationFrame(drawCurveGuides);
}

function scheduleFit() {
  if (state.fitFrame) cancelAnimationFrame(state.fitFrame);
  state.fitFrame = requestAnimationFrame(() => {
    state.fitFrame = 0;
    fitAllSlides();
  });
}

function postSlideState() {
  const slide = slides[state.index];
  if (window.parent === window) return;
  window.parent.postMessage({
    type: 'mint-deck-slide',
    id: slide.id,
    label: slide.dataset.navLabel || slide.id,
    index: state.index,
    total: slides.length
  }, window.location.origin);
}

function showSlide(index, options = {}) {
  const boundedIndex = Math.max(0, Math.min(slides.length - 1, index));
  state.index = boundedIndex;
  slides.forEach((slide, slideIndex) => {
    const current = slideIndex === boundedIndex;
    slide.classList.toggle('active', current);
    slide.setAttribute('aria-hidden', String(!current));
    slide.inert = !current;
  });

  const slide = slides[boundedIndex];
  previousButton.disabled = boundedIndex === 0;
  nextButton.disabled = boundedIndex === slides.length - 1;
  counter.textContent = `${boundedIndex + 1} / ${slides.length}`;
  slideName.textContent = slide.dataset.navLabel || slide.id;
  window.__deckDiagnostics.current = boundedIndex;

  if (options.updateHash !== false && location.hash !== `#${slide.id}`) {
    history.replaceState(null, '', `#${slide.id}`);
  }
  if (options.focus) deck.focus({ preventScroll: true });
  postSlideState();
  requestAnimationFrame(() => {
    const diagnostic = fitSlide(slide);
    window.__deckDiagnostics.slides[boundedIndex] = diagnostic;
    drawCurveGuides();
  });
}

function goToId(id, options = {}) {
  const normalized = String(id || '').replace(/^#/, '');
  const index = slides.findIndex((slide) => slide.id === normalized);
  if (index >= 0) showSlide(index, options);
}

function nextSlide() {
  showSlide(state.index + 1, { focus: true });
}

function previousSlide() {
  showSlide(state.index - 1, { focus: true });
}

function runNavigationCommand(command) {
  if (command === 'next') nextSlide();
  else if (command === 'previous') previousSlide();
  else if (command === 'first') showSlide(0, { focus: true });
  else if (command === 'last') showSlide(slides.length - 1, { focus: true });
  else return false;
  return true;
}

function navigationCommandForKey(key) {
  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ') return 'next';
  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') return 'previous';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return null;
}

function isEditingTarget(target) {
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

previousButton.addEventListener('click', previousSlide);
nextButton.addEventListener('click', nextSlide);

document.addEventListener('click', (event) => {
  const anchor = event.target.closest('a[href^="#c-"]');
  if (!anchor) return;
  event.preventDefault();
  goToId(anchor.hash, { focus: true });
});

document.addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : document.body;
  const activatesControl = (event.key === ' ' || event.key === 'Enter') && target.closest('a, button');
  if (isEditingTarget(target) || activatesControl) return;
  if (event.key === 'Escape' && window.parent !== window) {
    window.parent.postMessage({ type: 'mint-presentation-exit' }, window.location.origin);
    return;
  }
  const command = navigationCommandForKey(event.key);
  if (command) {
    event.preventDefault();
    runNavigationCommand(command);
  }
});

deck.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) return;
  state.touchStartX = event.touches[0].clientX;
  state.touchStartY = event.touches[0].clientY;
}, { passive: true });

deck.addEventListener('touchend', (event) => {
  if (state.touchStartX === null || event.changedTouches.length !== 1) return;
  const deltaX = event.changedTouches[0].clientX - state.touchStartX;
  const deltaY = event.changedTouches[0].clientY - state.touchStartY;
  state.touchStartX = null;
  state.touchStartY = null;
  if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
  if (deltaX < 0) nextSlide();
  else previousSlide();
}, { passive: true });

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === 'mint-deck-go') {
    goToId(event.data.id, { focus: Boolean(event.data.focus) });
  } else if (event.data?.type === 'mint-deck-navigate') {
    runNavigationCommand(event.data.command);
  } else if (event.data?.type === 'mint-presentation-resize') {
    scheduleFit();
  } else if (event.data?.type === 'mint-theme') {
    if (event.data.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    scheduleFit();
  }
});

window.addEventListener('hashchange', () => goToId(location.hash, { updateHash: false }));
window.addEventListener('resize', scheduleFit);
// Settle passes: re-fit once everything (fonts, images, shell sizing) has
// landed, so a mid-load measurement never remains the final layout.
window.addEventListener('load', () => {
  scheduleFit();
  setTimeout(scheduleFit, 600);
});
window.refitDeck = fitAllSlides;

if ('ResizeObserver' in window) {
  new ResizeObserver(scheduleFit).observe(deck);
}

async function initialisePretext() {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
      window.__deckDiagnostics.pretext.fontsReady = true;
    } catch (error) {
      window.__deckDiagnostics.pretext.status = 'font-wait-failed';
    }
  }

  for (const url of PRETEXT_URLS) {
    try {
      const module = await import(url);
      if (typeof module.prepareWithSegments === 'function' && typeof module.layoutNextLine === 'function') {
        state.pretext = module;
        state.pretextSource = url;
        window.__deckDiagnostics.pretext.status = 'ready';
        window.__deckDiagnostics.pretext.source = url;
        scheduleFit();
        return;
      }
    } catch (error) {
      console.warn('Pretext load failed', url, error);
    }
  }
  window.__deckDiagnostics.pretext.status = 'unavailable-native-fallback';
  scheduleFit();
}

wrapSlideContents();
preparePretextTargets();
let initialId = location.hash.replace(/^#/, '');
try {
  if (window.parent !== window && window.parent.location.hash) {
    initialId = window.parent.location.hash.replace(/^#/, '');
  }
} catch (error) {
  // A cross-origin embedding uses the shell's postMessage path instead.
}
const initialIndex = Math.max(0, slides.findIndex((slide) => slide.id === initialId));
showSlide(initialIndex, { updateHash: false });
fitAllSlides();
initialisePretext();
loadPaperConfig();
