(function () {
  'use strict';

  const body = document.body;
  const frame = document.getElementById('presentationFrame');
  const main = document.querySelector('.presentation-main');
  const presentationToggle = document.getElementById('presentationModeToggle');
  const presentationLabel = presentationToggle?.querySelector('.presentation-mode-label');
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const mobileMenuButton = document.getElementById('mobileMenuBtn');
  const mobileOverlay = document.getElementById('mobileOverlay');
  const searchOverlay = document.getElementById('searchOverlay');
  const searchTrigger = document.getElementById('searchTrigger');
  const searchClose = document.getElementById('searchClose');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const statusline = document.getElementById('statusline');
  const themeToggle = document.getElementById('themeToggle');
  const statusBar = document.getElementById('statusBar');
  const statusPct = document.getElementById('statusPct');
  const statusSection = document.getElementById('statusSection');
  const statusSectionTop = document.getElementById('statusSectionTop');
  const tokenDisplay = document.getElementById('tokenDisplay');

  const localSections = window.MintSiteNavConfig?.local?.sections || [];
  const requestedInitialId = (location.hash || '#c-title-slide').replace(/^#/, '');
  let pendingInitialId = requestedInitialId;
  let currentSlideId = 'c-title-slide';
  let currentSlideIndex = 0;
  let totalSlides = 1;

  function measureChrome() {
    if (!statusline || body.classList.contains('presentation-mode')) return;
    const height = Math.ceil(statusline.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--presentation-status-h', `${height}px`);
  }

  function postToDeck(message) {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(message, window.location.origin);
  }

  function notifyFrameResize() {
    postToDeck({ type: 'mint-presentation-resize' });
  }

  function updateNav(slideId) {
    document.querySelectorAll('#siteNav a[data-page-anchor]').forEach((link) => {
      let matches = false;
      try {
        matches = new URL(link.href, location.href).hash === `#${slideId}`;
      } catch (error) {
        matches = false;
      }
      link.classList.toggle('active', matches);
      if (matches) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function updateStatus(message) {
    currentSlideId = message.id || currentSlideId;
    currentSlideIndex = Number.isFinite(message.index) ? message.index : currentSlideIndex;
    totalSlides = Number.isFinite(message.total) && message.total > 0 ? message.total : totalSlides;
    const label = message.label || currentSlideId.replace(/^c-/, '').replaceAll('-', ' ');
    const percentage = totalSlides > 1
      ? Math.round((currentSlideIndex / (totalSlides - 1)) * 100)
      : 100;

    if (statusBar) {
      const filled = Math.round((percentage / 100) * 16);
      statusBar.innerHTML = `${'▓'.repeat(filled)}<span class="bar-empty">${'░'.repeat(16 - filled)}</span>`;
    }
    if (statusPct) statusPct.textContent = `${percentage}%`;
    if (statusSection) statusSection.textContent = label;
    if (statusSectionTop) statusSectionTop.textContent = label;
    if (tokenDisplay) tokenDisplay.innerHTML = `<span class="arrow">down</span> ${currentSlideIndex + 1} / ${totalSlides} slides`;

    updateNav(currentSlideId);
    const nextHash = `#${currentSlideId}`;
    if (location.hash !== nextHash) history.replaceState(null, '', nextHash);
  }

  function goToHash(hash, focusDeck = true) {
    const id = String(hash || '').replace(/^#/, '') || 'c-title-slide';
    postToDeck({ type: 'mint-deck-go', id, focus: focusDeck });
  }

  function navigationCommandForKey(key) {
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ') return 'next';
    if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') return 'previous';
    if (key === 'Home') return 'first';
    if (key === 'End') return 'last';
    return null;
  }

  function setPresentationMode(enabled) {
    body.classList.toggle('presentation-mode', enabled);
    presentationToggle?.setAttribute('aria-pressed', String(enabled));
    const accessibleLabel = enabled
      ? 'Show site navigation and header'
      : 'Hide site navigation and header';
    if (presentationToggle) {
      presentationToggle.setAttribute('aria-label', accessibleLabel);
      presentationToggle.title = accessibleLabel;
    }
    if (presentationLabel) presentationLabel.textContent = enabled ? 'Exit' : 'Present';
    requestAnimationFrame(notifyFrameResize);
    window.setTimeout(notifyFrameResize, 350);
    if (enabled) frame?.focus();
  }

  function setSidebarCollapsed(collapsed) {
    body.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle?.setAttribute('aria-expanded', String(!collapsed));
    if (sidebarToggle) {
      sidebarToggle.textContent = collapsed ? '»' : '«';
      sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    }
    window.setTimeout(notifyFrameResize, 320);
  }

  function closeMobileMenu() {
    sidebar?.classList.remove('open');
    mobileOverlay?.classList.remove('open');
    mobileMenuButton?.setAttribute('aria-expanded', 'false');
    if (mobileOverlay) {
      mobileOverlay.hidden = true;
      mobileOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  function toggleMobileMenu() {
    const open = !sidebar?.classList.contains('open');
    sidebar?.classList.toggle('open', open);
    mobileOverlay?.classList.toggle('open', open);
    mobileMenuButton?.setAttribute('aria-expanded', String(open));
    if (mobileOverlay) {
      mobileOverlay.hidden = !open;
      mobileOverlay.setAttribute('aria-hidden', String(!open));
    }
  }

  function renderSearch(query = '') {
    if (!searchResults) return;
    const normalized = query.trim().toLocaleLowerCase();
    const matches = localSections.filter((section) => !normalized || section.label.toLocaleLowerCase().includes(normalized));
    searchResults.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'search-empty';
      empty.textContent = 'No matching slides';
      searchResults.append(empty);
      return;
    }
    matches.forEach((section) => {
      const link = document.createElement('a');
      link.className = 'sr-item';
      link.href = section.href;
      link.dataset.searchSlide = section.href;
      link.textContent = section.label;
      searchResults.append(link);
    });
  }

  function setSearchOpen(open) {
    if (!searchOverlay) return;
    searchOverlay.hidden = !open;
    searchOverlay.classList.toggle('open', open);
    searchOverlay.setAttribute('aria-hidden', String(!open));
    searchTrigger?.setAttribute('aria-expanded', String(open));
    if (open) {
      renderSearch(searchInput?.value || '');
      requestAnimationFrame(() => searchInput?.focus());
    } else {
      searchTrigger?.focus();
    }
  }

  function applyTheme(theme, persist = false) {
    const isLight = theme === 'light';
    if (isLight) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    if (themeToggle) {
      themeToggle.innerHTML = `<span class="theme-toggle-icon" aria-hidden="true">${isLight ? '☾' : '☀'}</span>${isLight ? 'dark' : 'light'}`;
      const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';
      themeToggle.setAttribute('aria-label', label);
      themeToggle.title = label;
    }
    postToDeck({ type: 'mint-theme', theme });
    if (persist) {
      try {
        localStorage.setItem('mint-theme', theme);
        localStorage.setItem('mint-theme-explicit', 'true');
      } catch (error) {
        // Storage may be disabled; the current page still updates.
      }
    }
  }

  presentationToggle?.addEventListener('click', () => {
    setPresentationMode(!body.classList.contains('presentation-mode'));
  });

  sidebarToggle?.addEventListener('click', () => {
    setSidebarCollapsed(!body.classList.contains('sidebar-collapsed'));
  });

  mobileMenuButton?.addEventListener('click', toggleMobileMenu);
  mobileOverlay?.addEventListener('click', closeMobileMenu);

  searchTrigger?.addEventListener('click', () => setSearchOpen(true));
  searchClose?.addEventListener('click', () => setSearchOpen(false));
  searchInput?.addEventListener('input', () => renderSearch(searchInput.value));
  searchOverlay?.addEventListener('click', (event) => {
    if (event.target === searchOverlay) setSearchOpen(false);
  });

  themeToggle?.addEventListener('click', () => {
    applyTheme(document.documentElement.hasAttribute('data-theme') ? 'dark' : 'light', true);
  });

  document.addEventListener('click', (event) => {
    const localLink = event.target.closest('#siteNav a[data-page-anchor], [data-search-slide]');
    if (!localLink) return;
    const hash = localLink.dataset.searchSlide || new URL(localLink.href, location.href).hash;
    if (!hash?.startsWith('#c-')) return;
    event.preventDefault();
    goToHash(hash);
    setSearchOpen(false);
    closeMobileMenu();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      setSearchOpen(true);
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const isEditing = target?.closest('input, textarea, select, [contenteditable="true"]');
    const isButtonActivation = event.key === ' ' && target?.closest('a, button');
    const navigationCommand = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditing || isButtonActivation
      ? null
      : navigationCommandForKey(event.key);
    if (navigationCommand) {
      event.preventDefault();
      postToDeck({ type: 'mint-deck-navigate', command: navigationCommand });
      return;
    }
    if (event.key === 'Escape') {
      if (body.classList.contains('presentation-mode')) setPresentationMode(false);
      else if (!searchOverlay?.hidden) setSearchOpen(false);
      else closeMobileMenu();
    }
  });

  frame?.addEventListener('load', () => {
    goToHash(`#${pendingInitialId || currentSlideId}`, false);
    applyTheme(document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark');
    notifyFrameResize();
  });

  window.addEventListener('hashchange', () => goToHash(location.hash, false));
  window.addEventListener('resize', () => {
    measureChrome();
    notifyFrameResize();
    if (window.innerWidth > 900) closeMobileMenu();
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'mint-deck-slide') {
      if (pendingInitialId && event.data.id !== pendingInitialId) {
        goToHash(`#${pendingInitialId}`, false);
        return;
      }
      pendingInitialId = null;
      updateStatus(event.data);
    } else if (event.data?.type === 'mint-presentation-exit') {
      setPresentationMode(false);
    }
  });

  main?.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'inset' || event.propertyName === 'padding') notifyFrameResize();
  });

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => {
      measureChrome();
      notifyFrameResize();
    });
    if (statusline) observer.observe(statusline);
    if (frame) observer.observe(frame);
  }

  measureChrome();
  renderSearch();
})();
