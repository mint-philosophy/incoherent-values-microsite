(() => {
  const activePrototype = document.querySelector(".prototype-c");
  const localNav = document.querySelector(".nav-local-sections") || document.querySelector("#localNav");
  const sidebar = document.querySelector("#sidebar");
  const sidebarToggle = document.querySelector("#sidebarToggle");
  const mobileMenuButton = document.querySelector("#mobileMenuBtn");
  const mobileOverlay = document.querySelector("#mobileOverlay");
  const searchTrigger = document.querySelector("#searchTrigger");
  const searchOverlay = document.querySelector("#searchOverlay");
  const searchInput = document.querySelector("#searchInput");
  const searchResults = document.querySelector("#searchResults");
  const statusBar = document.querySelector("#statusBar");
  const statusPct = document.querySelector("#statusPct");
  const statusSection = document.querySelector("#statusSection");
  const statusSectionTop = document.querySelector("#statusSectionTop");
  const tokenDisplay = document.querySelector("#tokenDisplay");
  const themeToggle = document.querySelector("#themeToggle");
  const mobileNavigation = window.matchMedia("(max-width: 900px)");
  const barLength = 16;
  let searchReturnTarget = null;
  let trackedSections = [];
  let sectionObserver = null;

  function setDrawer(open) {
    const expanded = Boolean(open && mobileNavigation.matches);
    sidebar.classList.toggle("open", expanded);
    mobileOverlay.classList.toggle("open", expanded);
    mobileOverlay.hidden = !expanded;
    mobileOverlay.setAttribute("aria-hidden", String(!expanded));
    mobileMenuButton.setAttribute("aria-expanded", String(expanded));
    mobileMenuButton.setAttribute("aria-label", expanded ? "Close navigation" : "Open navigation");
    syncSidebarInert();
  }

  function rebuildNav() {
    if (!localNav) return;
    localNav.replaceChildren();
    localNav.classList.add("expanded");
    localNav.hidden = false;
    trackedSections = [...activePrototype.querySelectorAll("[data-nav-label]")];

    trackedSections.forEach((section, index) => {
      const link = document.createElement("a");
      link.className = "nav-link nav-section sub-link";
      link.href = `#${section.id}`;
      link.setAttribute("data-page-anchor", "");
      link.setAttribute("data-nav-depth", "2");

      const mark = document.createElement("span");
      mark.className = "nav-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = index === trackedSections.length - 1 ? "└──" : "├──";

      link.append(mark, document.createTextNode(section.dataset.navLabel));
      link.addEventListener("click", () => setDrawer(false));
      localNav.append(link);
    });

    const currentLeaf = document.querySelector("[data-microsite-current]");
    currentLeaf?.classList.add("active-parent");
    currentLeaf?.setAttribute("aria-expanded", "true");
  }

  function setupSectionObserver() {
    if (sectionObserver) sectionObserver.disconnect();
    if (!trackedSections.length) return;

    sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible.length) return;

        const section = visible[0].target;
        const label = section.dataset.navLabel || "top";
        statusSection.textContent = label;
        statusSectionTop.textContent = label;

        localNav?.querySelectorAll("a").forEach((link) => {
          link.classList.toggle("active", link.getAttribute("href") === `#${section.id}`);
        });
      },
      {
        rootMargin: "-20% 0px -58% 0px",
        threshold: [0.05, 0.18, 0.4]
      }
    );

    trackedSections.forEach((section) => sectionObserver.observe(section));
  }

  function updateProgress() {
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.min(1, Math.max(0, window.scrollY / scrollable));
    const pct = Math.round(ratio * 100);
    const filled = Math.round(ratio * barLength);
    const empty = barLength - filled;
    const totalChars = activePrototype ? activePrototype.textContent.length : 0;
    const tokens = Math.round((totalChars * ratio) / 4);
    const tokenText = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

    statusBar.innerHTML = "▓".repeat(filled) + `<span class="bar-empty">${"░".repeat(empty)}</span>`;
    statusPct.textContent = `${pct}%`;
    tokenDisplay.innerHTML = `<span class="arrow">down</span> ${tokenText} tokens`;
  }

  function updateThemeButton() {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    themeToggle.innerHTML = light
      ? '<span class="theme-toggle-icon">☾</span>dark'
      : '<span class="theme-toggle-icon">☀</span>light';
    themeToggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
    themeToggle.title = light ? "Switch to dark mode" : "Switch to light mode";
  }

  function toggleTheme() {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    if (light) {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }

    try {
      localStorage.setItem("mint-theme", light ? "dark" : "light");
    } catch (error) {}
    updateThemeButton();
  }

  function syncSidebarInert() {
    const mobileClosed = mobileNavigation.matches && !sidebar.classList.contains("open");
    const desktopCollapsed = !mobileNavigation.matches
      && document.body.classList.contains("sidebar-collapsed");
    sidebar.inert = mobileClosed || desktopCollapsed;
  }

  function updateSidebarToggleState() {
    const collapsed = document.body.classList.contains("sidebar-collapsed");
    syncSidebarInert();
    sidebarToggle.textContent = collapsed ? "»" : "«";
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  }

  function syncMobileNavigation() {
    if (mobileNavigation.matches) {
      setDrawer(sidebar.classList.contains("open"));
    } else {
      setDrawer(false);
    }
  }

  function openSearch() {
    searchReturnTarget = document.activeElement;
    searchOverlay.hidden = false;
    searchOverlay.setAttribute("aria-hidden", "false");
    searchOverlay.classList.add("open");
    searchTrigger.setAttribute("aria-expanded", "true");
    renderSearchResults("");
    window.requestAnimationFrame(() => {
      searchInput.focus();
      searchInput.select();
    });
  }

  function closeSearch(restoreFocus = true) {
    const wasOpen = searchOverlay.classList.contains("open");
    searchOverlay.classList.remove("open");
    searchOverlay.hidden = true;
    searchOverlay.setAttribute("aria-hidden", "true");
    searchTrigger.setAttribute("aria-expanded", "false");
    if (wasOpen && restoreFocus && searchReturnTarget instanceof HTMLElement) {
      searchReturnTarget.focus();
    }
    searchReturnTarget = null;
  }

  function renderSearchResults(query) {
    const normalized = query.trim().toLowerCase();
    const hits = trackedSections.filter((section) => {
      const haystack = `${section.dataset.navLabel} ${section.textContent}`.toLowerCase();
      return !normalized || haystack.includes(normalized);
    });

    searchResults.replaceChildren();
    hits.forEach((section) => {
      const link = document.createElement("a");
      const title = document.createElement("div");
      const description = document.createElement("div");
      link.className = "sr-item";
      link.href = `#${section.id}`;
      title.className = "sr-title";
      title.textContent = section.dataset.navLabel;
      description.className = "sr-desc";
      description.textContent = section.querySelector("h1, h2")?.textContent || "Section";
      link.append(title, description);
      link.addEventListener("click", () => closeSearch());
      searchResults.append(link);
    });
  }

  mobileMenuButton.addEventListener("click", () => {
    setDrawer(!sidebar.classList.contains("open"));
  });
  mobileOverlay.addEventListener("click", () => setDrawer(false));
  sidebar.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) setDrawer(false);
  });
  sidebarToggle.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
    updateSidebarToggleState();
  });
  searchTrigger.addEventListener("click", openSearch);
  searchOverlay.addEventListener("click", (event) => {
    if (event.target === searchOverlay) closeSearch();
  });
  searchInput.addEventListener("input", () => renderSearchResults(searchInput.value));
  mobileNavigation.addEventListener?.("change", syncMobileNavigation);
  themeToggle.addEventListener("click", toggleTheme);
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress, { passive: true });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (searchOverlay.classList.contains("open")) closeSearch();
      else openSearch();
    }

    if (event.key === "Escape") {
      if (searchOverlay.classList.contains("open")) closeSearch();
      else setDrawer(false);
    }
  });

  if (localStorage.getItem("sidebar-collapsed") === "1") {
    document.body.classList.add("sidebar-collapsed");
  }
  updateThemeButton();
  updateSidebarToggleState();
  syncMobileNavigation();
  document.title = "Incoherent Values? — MINT Research Lab";
  rebuildNav();
  setupSectionObserver();
  updateProgress();
})();
