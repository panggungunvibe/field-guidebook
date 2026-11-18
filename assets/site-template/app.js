import { PLANTS } from "./plant-data.js";
import { SITE } from "./site-config.js";
import { searchPlants, filterPlants } from "./search-model.js";
import { getGalleryLayout, getGallerySpacing, getProjectedBookBounds, wrap } from "./gallery-geometry.js";
import { computeFlightFrame } from "./flight-model.js";
import { createGalleryRenderer } from "./gallery-renderer.js";
import { createProvenanceModel } from "./provenance-model.js";
import "./article-interactions.css";
import "./replica-motion.css";

const BOOKS = PLANTS;
const ALL_BOOKS = PLANTS;

const state = {
  theme: localStorage.getItem(SITE.themeStorageKey) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  phase: 0,
  wheelDelta: 0,
  raf: 0,
  lastFrame: 0,
  placeholderTimer: 0,
  filterTimers: [],
  filterToken: 0,
  dragging: null,
  suppressOpen: false,
  keyboardMode: false,
  hoverEntries: new Map(),
  galleryVisible: true,
  stageObserver: null,
  motionPreferenceHandler: null,
  headerOutsideHandler: null,
  transitionCancelled: false,
  transitionCleanup: null,
  query: "",
  bookTransition: null,
  filteredBooks: PLANTS,
  galleryPool: new Map(),
  galleryPoses: new WeakMap(),
  galleryLayoutRunning: false,
  galleryRenderer: null,
  galleryFrame: null,
  homeCleanup: null,
  opening: false,
  scrollOrigin: 0,
};

const app = document.querySelector("#app");
const transitionLayer = document.querySelector("#transition-layer");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function svgSearch() {
  return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5"></circle><path d="m13 13 4 4" stroke="currentColor" stroke-width="1.5"></path></svg>';
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem(SITE.themeStorageKey, state.theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.body).backgroundColor);
}

function headerMarkup() {
  const article = document.body.dataset.page === "article";
  return `
    <header class="site-header">
      <div class="header-inner">
        <div class="header-navigation">
        <a class="brand" href="/" data-home-link aria-label="${escapeArticleText(SITE.brand.returnLabel)}">
          ${SITE.brand.logo?.trim() ? `<img class="brand-logo" src="${escapeContentURL(SITE.brand.logo)}" alt="${escapeArticleText(SITE.brand.logoAlt)}" />` : `<span class="brand-wordmark">${escapeArticleText(SITE.brand.wordmark || SITE.title)}</span>`}
        </a>
        </div>
        <div class="header-utility">
        ${article ? `<div class="header-search-shell"><form class="header-search" role="search" aria-label="${escapeArticleText(SITE.search.formLabel)}">
          <button type="submit" class="header-search-icon" aria-label="搜索">${svgSearch()}</button>
          <input type="search" name="q" maxlength="120" placeholder="${escapeArticleText(SITE.search.placeholder)}" aria-label="${escapeArticleText(SITE.search.placeholder)}" role="combobox" aria-autocomplete="list" aria-haspopup="dialog" aria-expanded="false" autocomplete="off" />
          <button class="header-search-dismiss" type="button" aria-label="关闭搜索">×</button>
        </form></div>` : ""}
        <div class="theme-toggle" role="group" aria-label="显示主题" ${article ? 'aria-disabled="true"' : ""}>
          <button type="button" data-theme-choice="light" aria-pressed="${state.theme === "light"}" ${article ? "disabled" : ""}>Light</button>
          <button type="button" data-theme-choice="dark" aria-pressed="${state.theme === "dark"}" ${article ? "disabled" : ""}>Dark</button>
        </div>
        </div>
      </div>
    </header>`;
}

function footerMarkup(article = false) {
  return `
    <footer class="${article ? "article-footer" : "home-footer"}">
      <div class="footer-meta">
        <a href="${escapeContentURL(SITE.brand.url)}" target="_blank" rel="noopener noreferrer">${escapeArticleText(SITE.brand.label)} ↗</a>
        <span>${escapeArticleText(SITE.brand.year)}</span>
      </div>
      <div class="footer-wordmark-frame"><a class="footer-wordmark" href="/" data-home-link aria-label="${escapeArticleText(SITE.brand.homeLabel)}" data-wordmark="${escapeArticleText(SITE.brand.wordmark)}">${escapeArticleText(SITE.brand.wordmark)}</a></div>
    </footer>`;
}

function bookMarkup(book) {
  return `
    <a class="hero-book" href="/t/${escapeArticleText(book.slug)}" data-original="true" data-book="${escapeArticleText(book.slug)}" draggable="false" aria-label="打开 ${escapeArticleText(book.title)}" style="--book-color:${escapeArticleText(book.color)}">
      <span class="book-volume">
        <span class="book-spine"><span class="spine-number">${escapeArticleText(book.number)}</span><span class="spine-title">${escapeArticleText(book.title)}</span></span>
        <span class="book-pages" aria-hidden="true"></span>
        <span class="book-top" aria-hidden="true"></span>
        <span class="book-bottom" aria-hidden="true"></span>
        <span class="book-back">
          <span class="book-head"><span>${escapeArticleText(SITE.brand.bookTitle)}</span><span>Nº ${escapeArticleText(book.number)}</span></span>
          <span class="book-back-copy"><small>${escapeArticleText(book.kicker)}</small><strong>${escapeArticleText(book.title)}</strong><span>${escapeArticleText(book.overview)}</span></span>
          <span class="book-back-foot">${escapeArticleText(SITE.brand.bookMotto)}</span>
        </span>
        <span class="book-cover">
          <span class="book-front-artwork" style="--front-title-size:${book.title.length > 100 ? 20 : 25}px">
            <span class="book-head"><span>${escapeArticleText(SITE.brand.bookTitle)}</span><span>Nº ${escapeArticleText(book.number)}</span></span>
            <span class="book-art"><img src="${escapeContentURL(book.image)}" alt="" draggable="false" /></span>
            <span class="book-copy"><span class="book-kicker">${escapeArticleText(book.kicker)}</span><span class="book-title">${escapeArticleText(book.title)}</span><span class="book-meta"><span>${escapeArticleText(book.scientific)}</span><span>打开 ↗</span></span></span>
          </span>
        </span>
      </span>
    </a>`;
}

function findBook(slug) {
  return ALL_BOOKS.find((book) => book.slug === slug) || BOOKS[0];
}

function miniBookMarkup(item, index, open = false, extraClass = "") {
  const height = [310, 326, 300, 318][index % 4];
  return `<a class="mini-book ${extraClass}" href="/t/${escapeArticleText(item.slug)}" data-book="${escapeArticleText(item.slug)}" data-open="${open}" style="--book-color:${escapeArticleText(item.color)};--book-h:${height}px" aria-label="打开 ${escapeArticleText(item.title)}"><span class="mini-volume"><span class="mini-spine"><small>${escapeArticleText(item.number)}</small><span>${escapeArticleText(item.title)}</span></span><span class="mini-back"><span class="mini-head">${escapeArticleText(SITE.brand.bookTitle)} · Nº ${escapeArticleText(item.number)}</span><strong>${escapeArticleText(item.title)}</strong><span>${escapeArticleText(item.overview)}</span></span><span class="mini-edge" aria-hidden="true"></span><span class="mini-top" aria-hidden="true"></span><span class="mini-bottom" aria-hidden="true"></span><span class="mini-cover"><span class="mini-head"><span>${escapeArticleText(SITE.brand.bookTitle)}</span><span>Nº ${escapeArticleText(item.number)}</span></span><span class="mini-art"><img src="${escapeContentURL(item.image)}" alt="" loading="lazy" /></span><span class="mini-copy"><small>${escapeArticleText(item.kicker)}</small><strong>${escapeArticleText(item.title)}</strong><span class="mini-foot"><span>${escapeArticleText(item.confidence)}</span><span>打开 ↗</span></span></span></span></span></a>`;
}

function renderHome(initialQuery = "") {
  stopDynamicWork();
  document.body.dataset.page = "home";
  document.body.style.removeProperty("--paper");
  document.title = SITE.homeTitle;
  app.innerHTML = `
    ${headerMarkup()}
    <main id="main-content" class="home-main">
      <section class="home-hero" aria-labelledby="hero-heading">
        <div class="hero-copy">
          <h1 id="hero-heading">${SITE.hero.titleLines.map(line => `<span>${escapeArticleText(line)}</span>`).join("")}</h1>
          <p class="hero-description">${escapeArticleText(SITE.hero.description)}</p>
          <form class="topic-search" role="search" aria-label="${escapeArticleText(SITE.search.homeFormLabel)}">
            <div class="topic-input-wrap">${svgSearch()}<input id="topic-search" type="search" autocomplete="off" maxlength="120" placeholder="${escapeArticleText(SITE.search.homePlaceholder)}" aria-label="${escapeArticleText(SITE.search.placeholder)}" aria-describedby="topic-search-status" /><button class="topic-clear" type="button" aria-label="清除搜索" hidden>×</button><span class="topic-rotator" aria-hidden="true"><span class="topic-rotator-names"></span></span></div>
            <button type="submit" aria-label="打开第一个匹配结果"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
          </form>
          <p id="topic-search-status" class="sr-only" role="status"></p>
          <div class="topic-feedback" aria-live="polite" aria-atomic="true"></div>
        </div>
        <div class="gallery-stage" role="region" aria-label="${escapeArticleText(SITE.gallery.label)}，共 ${BOOKS.length} 个条目" tabindex="0">
          <div class="gallery-visual" aria-hidden="true"><div class="gallery-canvas-host"></div></div>
          <div class="book-field">${BOOKS.map(bookMarkup).join("")}</div>
          <p class="gallery-status" aria-live="polite"><span class="gallery-collection">${escapeArticleText(SITE.gallery.collectionLabel)} · ${BOOKS.length} 个条目</span><span class="gallery-motion-note">持续缓慢移动 · 纵向滚动探索</span><span class="gallery-keyboard-note">键盘浏览 · 使用方向键或 Tab</span><span class="gallery-manual-note">滚动或滑动浏览 · 自动移动已关闭</span></p>
        </div>
      </section>
      <section id="recommended" class="home-recommended" aria-label="${escapeArticleText(SITE.gallery.recommendedLabel)}">
        <div class="home-shelf-viewport related-viewport" role="region" aria-label="推荐阅读书架" tabindex="0">
          <ul class="home-shelf related-shelf" data-default-book="${BOOKS.at(-1).slug}">
            ${BOOKS.map((book, index) => `<li>${miniBookMarkup(book, index + 2, index === BOOKS.length - 1)}</li>`).join("")}
          </ul>
        </div>
      </section>
      ${footerMarkup(false)}
    </main>`;

  bindHeader();
  bindHome(initialQuery);
  applyTheme();
  bindImageFallbacks();
}

function bindHeader() {
  if (state.headerOutsideHandler) document.removeEventListener("pointerdown", state.headerOutsideHandler);
  if (state.headerOutsideHandler) document.removeEventListener("focusin", state.headerOutsideHandler);
  state.headerOutsideHandler = null;
  document.querySelectorAll("[data-home-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateHome();
    });
  });
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      state.theme = button.dataset.themeChoice;
      applyTheme();
      document.querySelectorAll("[data-theme-choice]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.themeChoice === state.theme)));
    });
  });
  const shell = document.querySelector(".header-search-shell");
  const form = shell?.querySelector(".header-search");
  const input = form?.querySelector("input");
  const dismiss = form?.querySelector(".header-search-dismiss");
  let panel = null;

  const closeHeaderSearch = (blur = false) => {
    panel?.remove();
    panel = null;
    shell?.removeAttribute("data-open");
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-controls");
    if (blur) input?.blur();
  };

  const headerMatches = () => {
    return searchPlants(ALL_BOOKS, input?.value || "").matches;
  };

  const openHeaderSearch = () => {
    if (!shell || !input) return;
    shell.dataset.open = "true";
    if (!input.value.trim()) {
      panel?.remove();
      panel = null;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-controls");
      return;
    }
    const matches = headerMatches();
    panel?.remove();
    panel = document.createElement("div");
    panel.className = "header-search-panel";
    panel.id = "header-search-results";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", SITE.search.resultsLabel);
    panel.innerHTML = `<p class="header-search-message" role="status" aria-live="polite">${matches.length ? `${matches.length} 个匹配条目${matches.length > 8 ? " · 显示前 8 个" : ""}` : `没有匹配的${escapeArticleText(SITE.search.noun)}。`}</p>${matches.length ? `<ul aria-label="${escapeArticleText(SITE.search.matchesLabel)}">${matches.slice(0, 8).map((book) => `<li><a href="/t/${escapeArticleText(book.slug)}" data-result-book="${escapeArticleText(book.slug)}"><span>${escapeArticleText(book.title)}</span><small>${escapeArticleText(book.scientific)}</small></a></li>`).join("")}</ul>` : ""}`;
    shell.append(panel);
    shell.dataset.open = "true";
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", panel.id);
    panel.querySelectorAll("[data-result-book]").forEach((button) => button.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const target = findBook(button.dataset.resultBook);
      closeHeaderSearch();
      openBook(target.slug, null);
    }));
  };

  input?.addEventListener("focus", openHeaderSearch);
  input?.addEventListener("click", openHeaderSearch);
  input?.addEventListener("input", openHeaderSearch);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const first = headerMatches()[0];
    if (first) {
      closeHeaderSearch();
      openBook(first.slug, null);
    } else {
      openHeaderSearch();
      input?.focus();
    }
  });
  shell?.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      input?.focus();
      closeHeaderSearch();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    if (!panel) openHeaderSearch();
    const items = [...(panel?.querySelectorAll("a") || [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? (current + 1) % items.length : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length);
    items[next]?.focus();
  });
  dismiss?.addEventListener("click", () => closeHeaderSearch(true));
  state.headerOutsideHandler = (event) => {
    if (shell && event.target instanceof Node && !shell.contains(event.target)) closeHeaderSearch();
  };
  document.addEventListener("pointerdown", state.headerOutsideHandler);
  document.addEventListener("focusin", state.headerOutsideHandler);
}

function bindShelf(shelf, defaultSlug) {
  if (!shelf) return;
  const books = [...shelf.querySelectorAll(".mini-book")];
  const clearSheen = bindShelfSheen(shelf);
  let hoverTimer = 0;
  let pending = null;
  let lastPointer = null;
  const open = (element) => books.forEach((item) => { item.dataset.open = String(item === element); });
  const cancelPending = () => {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    pending = null;
  };
  const scheduleOpen = (element) => {
    if (pending === element || element.dataset.open === "true") return;
    cancelPending();
    pending = element;
    hoverTimer = window.setTimeout(() => { open(element); pending = null; hoverTimer = 0; }, 100);
  };
  const reset = () => {
    cancelPending();
    lastPointer = null;
    const visible = books.filter((item) => !item.hidden);
    open(visible.find((item) => item.dataset.book === defaultSlug) || visible[0]);
  };
  const canHover = (event) => event.pointerType !== "touch" && matchMedia("(hover: hover)").matches;
  shelf.addEventListener("pointermove", (event) => {
    if (!canHover(event) || (lastPointer?.x === event.clientX && lastPointer.y === event.clientY)) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (shelf.querySelector(":focus-visible")) { cancelPending(); return; }
    const target = event.target.closest(".mini-book");
    if (target && books.includes(target)) scheduleOpen(target);
    else cancelPending();
  }, { passive: true });
  books.forEach((element) => {
    element.addEventListener("pointerdown", (event) => { cancelPending(); if (canHover(event)) open(element); });
    element.addEventListener("focus", cancelPending);
    element.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openBook(element.dataset.book, element);
    });
  });
  shelf.addEventListener("pointerleave", reset);
  shelf.addEventListener("pointercancel", reset);
  shelf.addEventListener("scroll", cancelPending, { passive: true });
  shelf.closest(".home-shelf-viewport, .related-viewport")?.addEventListener("scroll", cancelPending, { passive: true });
  return () => { cancelPending(); clearSheen(); };
}

function bindShelfSheen(shelf) {
  const viewport = shelf.closest(".related-viewport") || shelf;
  const listeners = new AbortController();
  let surface = null, target = null, frame = 0, last = 0;
  let pointer = { x: 50, y: 50 }, intensity = 0;
  const draw = (now) => {
    const elapsed = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const desiredIntensity = target ? 1 : 0;
    const intensityStep = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 0.12);
    const pointerStep = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 0.07);
    intensity += (desiredIntensity - intensity) * intensityStep;
    if (Math.abs(desiredIntensity - intensity) < 0.002) intensity = desiredIntensity;
    if (target) {
      pointer.x += (target.x - pointer.x) * pointerStep;
      pointer.y += (target.y - pointer.y) * pointerStep;
    }
    surface.style.setProperty("--sheen-x", `${pointer.x}%`);
    surface.style.setProperty("--sheen-y", `${pointer.y}%`);
    surface.style.setProperty("--cover-sheen-intensity", String(intensity));
    if (target || intensity !== 0) frame = requestAnimationFrame(draw);
    else { frame = 0; surface = null; }
  };
  const start = () => {
    if (frame || !surface) return;
    last = performance.now();
    frame = requestAnimationFrame(draw);
  };
  const clear = () => { target = null; start(); };
  const move = (event) => {
    if (event.pointerType === "touch" || !matchMedia("(hover: hover)").matches) return;
    const book = event.target.closest(".mini-book");
    const face = book && shelf.contains(book) && book.dataset.open === "true" ? book.querySelector(".mini-cover") : null;
    if (!face) { clear(); return; }
    const bounds = face.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 100;
    const y = (event.clientY - bounds.top) / bounds.height * 100;
    if (![x, y].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100) { clear(); return; }
    if (surface !== face) {
      surface?.style.removeProperty("--cover-sheen-intensity");
      surface = face;
      pointer = { x, y };
      intensity = 0;
    }
    target = { x, y };
    start();
  };
  viewport.addEventListener("pointermove", move, { passive: true, signal: listeners.signal });
  viewport.addEventListener("pointerleave", clear, { signal: listeners.signal });
  viewport.addEventListener("pointercancel", clear, { signal: listeners.signal });
  viewport.addEventListener("pointerdown", clear, { passive: true, signal: listeners.signal });
  return () => {
    listeners.abort();
    cancelAnimationFrame(frame);
    surface?.style.removeProperty("--cover-sheen-intensity");
    surface = target = null;
  };
}

function bindHome(initialQuery = "") {
  const listeners = new AbortController();
  let entranceTimer;
  const recommendedShelf = document.querySelector("#recommended .related-shelf");
  const clearRecommendedShelf = bindShelf(recommendedShelf, recommendedShelf?.dataset.defaultBook);
  state.homeCleanup = () => {
    listeners.abort();
    clearTimeout(entranceTimer);
    clearRecommendedShelf?.();
    state.galleryRenderer?.dispose();
    state.galleryRenderer = null;
    state.galleryFrame = null;
  };
  state.filteredBooks = BOOKS;
  state.galleryPool = new Map();
  state.scrollOrigin = window.scrollY;
  const search = document.querySelector("#topic-search");
  const form = document.querySelector(".topic-search");
  const stage = document.querySelector(".gallery-stage");
  state.galleryRenderer = createGalleryRenderer(stage.querySelector(".gallery-canvas-host"), BOOKS, {
    onStatus({ renderer }) {
      if (!stage.isConnected) return;
      stage.dataset.renderer = renderer;
      queueMicrotask(() => { if (stage.isConnected) layoutBooks(); });
    },
  });
  const clear = document.querySelector(".topic-clear");
  const rotator = document.querySelector(".topic-rotator");
  const rotatorNames = document.querySelector(".topic-rotator-names");
  const searchStatus = document.querySelector("#topic-search-status");
  const feedback = document.querySelector(".topic-feedback");
  const suggestions = [...new Set(BOOKS.map((book) => book.title))];
  const suggestionOrder = [...suggestions].sort(() => Math.random() - 0.5);
  let suggestionIndex = 0;
  stage.dataset.entering = "true";
  entranceTimer = window.setTimeout(() => { delete stage.dataset.entering; }, 600);

  state.query = "";
  search.value = initialQuery;

  const updateSearchChrome = () => {
    const hasValue = Boolean(search.value);
    clear.hidden = !hasValue;
    rotator.hidden = hasValue;
    search.classList.toggle("is-clearable", hasValue);
    search.classList.toggle("is-rotating", !hasValue);
  };

  const showSuggestion = (nextIndex, animate = true) => {
    const previous = suggestionOrder[suggestionIndex % suggestionOrder.length];
    const current = suggestionOrder[nextIndex % suggestionOrder.length];
    suggestionIndex = nextIndex;
    rotatorNames.replaceChildren();
    if (animate && previous !== current) {
      const outgoing = document.createElement("span");
      outgoing.className = "topic-rotator-name is-outgoing";
      outgoing.textContent = previous;
      rotatorNames.append(outgoing);
    }
    const incoming = document.createElement("span");
    incoming.className = `topic-rotator-name${animate ? " is-incoming" : ""}`;
    incoming.textContent = current;
    rotatorNames.append(incoming);
  };

  showSuggestion(0, false);
  updateSearchChrome();
  state.placeholderTimer = window.setInterval(() => {
    if (!search.value) showSuggestion(suggestionIndex + 1);
  }, 2400);

  let filterEnterDeadline = 0;
  const filter = () => {
    updateSearchChrome();
    feedback.replaceChildren();
    state.filterTimers.forEach(clearTimeout);
    state.filterTimers = [];
    const query = search.value.trim();
    const filtered = filterPlants(BOOKS, query).slice(0, 40);
    const token = ++state.filterToken;
    const unchanged = filtered.length === state.filteredBooks.length && filtered.every((book, index) => book.slug === state.filteredBooks[index].slug);
    if (unchanged) {
      state.query = query;
      stageOriginals();
      // Case, punctuation or equivalent words can change the query without
      // changing the rendered books. Keep their drift and current entrance.
      if (stage.dataset.filter === "in" && filterEnterDeadline > performance.now()) {
        state.filterTimers.push(window.setTimeout(() => {
          if (token === state.filterToken) delete stage.dataset.filter;
        }, filterEnterDeadline - performance.now()));
      } else delete stage.dataset.filter;
      return;
    }
    const applyFilter = () => {
      if (token !== state.filterToken) return;
      state.query = query;
      state.filteredBooks = filtered;
      stageOriginals();
      state.phase = 0;
      state.wheelDelta = 0;
      state.hoverEntries.clear();
      if (reducedMotion.matches) delete stage.dataset.filter;
      else {
        stage.dataset.filter = "in";
        filterEnterDeadline = performance.now() + 520;
        state.filterTimers.push(window.setTimeout(() => {
          if (token === state.filterToken) delete stage.dataset.filter;
        }, 520));
      }
      layoutBooks();
    };
    const startFilter = () => {
      if (token !== state.filterToken) return;
      if (reducedMotion.matches) { applyFilter(); return; }
      stage.dataset.filter = "out";
      state.filterTimers.push(window.setTimeout(applyFilter, 160));
    };
    state.filterTimers.push(window.setTimeout(startFilter, 180));
  };

  search.addEventListener("input", filter);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !search.value) return;
    event.preventDefault();
    search.value = "";
    filter();
  });
  clear.addEventListener("click", () => {
    search.value = "";
    filter();
    search.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const first = searchPlants(BOOKS, search.value).matches[0];
    if (first && search.value.trim()) {
      feedback.replaceChildren();
      openBook(first.slug, null);
      return;
    }
    const message = search.value.trim() ? `没有与“${search.value.trim()}”匹配的${SITE.search.noun}。` : `请输入要搜索的${SITE.search.noun}。`;
    feedback.innerHTML = `<p>${escapeArticleText(message)}</p>`;
    search.focus();
  });

  // The live reference explicitly passes enhancedHover:false. Its moving
  // covers do not flip, enlarge or hinge when the pointer merely enters.
  stage.addEventListener("click", (event) => {
      const element = event.target.closest(".hero-book");
      if (!element || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (state.suppressOpen) {
        state.suppressOpen = false;
        if (event.detail > 0) {
          event.preventDefault();
          return;
        }
      }
      event.preventDefault();
      openBook(element.dataset.book, element);
  });
  stage.addEventListener("dragstart", (event) => event.preventDefault());

  stage.addEventListener("wheel", (event) => {
    if (event.ctrlKey || stage.hasAttribute("data-reading") || stage.hasAttribute("data-manual")) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
    if (!horizontal) return;
    event.preventDefault();
    const delta = event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const mode = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, stage.clientWidth) : 1;
    const limit = 8 * state.filteredBooks.length * getGallerySpacing(stage.clientWidth);
    if (Math.sign(delta) !== Math.sign(state.wheelDelta)) state.wheelDelta = 0;
    state.wheelDelta = Math.max(-limit, Math.min(limit, state.wheelDelta + delta * mode));
  }, { passive: false });

  stage.addEventListener("pointerdown", (event) => {
    if (state.opening || event.button !== 0 || event.isPrimary === false || stage.hasAttribute("data-reading") || stage.hasAttribute("data-manual")) return;
    state.suppressOpen = false;
    state.dragging = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      phase: state.phase,
      axis: "pending",
    };
    state.wheelDelta = 0;
  });
  window.addEventListener("pointermove", (event) => {
    if (!state.dragging || state.dragging.id !== event.pointerId) return;
    const dx = event.clientX - state.dragging.x;
    const dy = event.clientY - state.dragging.y;
    if (state.dragging.axis === "pending" && Math.max(Math.abs(dx), Math.abs(dy)) >= 6) {
      state.dragging.axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (state.dragging.axis === "horizontal") {
        stage.setPointerCapture?.(event.pointerId);
        stage.dataset.dragging = "true";
      }
    }
    if (state.dragging.axis !== "horizontal") return;
    event.preventDefault();
    state.phase += state.dragging.lastX - event.clientX;
    state.dragging.lastX = event.clientX;
  }, { passive: false, signal: listeners.signal });
  const release = (event) => {
    if (state.dragging?.id !== event.pointerId) return;
    const wasHorizontal = state.dragging.axis === "horizontal";
    state.dragging = null;
    delete stage.dataset.dragging;
    if (wasHorizontal) {
      state.suppressOpen = true;
    }
  };
  window.addEventListener("pointerup", release, { signal: listeners.signal });
  window.addEventListener("pointercancel", release, { signal: listeners.signal });
  stage.addEventListener("lostpointercapture", release);

  stage.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    stage.dataset.reading = "true";
    state.keyboardMode = true;
    layoutBooks();
    const books = [...stage.querySelectorAll(".book-field .hero-book:not([hidden])")];
    if (!books.length) return;
    const active = books.indexOf(document.activeElement);
    let next = active;
    if (event.key === "ArrowLeft") next = active <= 0 ? books.length - 1 : active - 1;
    if (event.key === "ArrowRight") next = active < 0 || active === books.length - 1 ? 0 : active + 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = books.length - 1;
    books[next]?.focus({ preventScroll: true });
    books[next]?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
  });
  stage.addEventListener("focusin", (event) => {
      if (state.opening) return;
      if (!(event.target instanceof HTMLElement) || (!event.target.matches(":focus-visible") && !event.target.matches("[data-original]"))) return;
      stage.dataset.reading = "true";
      state.keyboardMode = true;
      state.hoverEntries.clear();
      if (event.target === stage) stage.scrollLeft = 0;
      layoutBooks();
  });
  stage.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && stage.contains(event.relatedTarget)) return;
    state.keyboardMode = false;
    delete stage.dataset.reading;
    stage.scrollLeft = 0;
    queueMicrotask(() => { if (stage.isConnected) layoutBooks(); });
  });

  const applyMotionPreference = () => {
    if (reducedMotion.matches) stage.dataset.manual = "true";
    else delete stage.dataset.manual;
    layoutBooks();
  };
  state.motionPreferenceHandler = applyMotionPreference;
  reducedMotion.addEventListener("change", applyMotionPreference);
  applyMotionPreference();

  state.stageObserver = new IntersectionObserver(([entry]) => {
    state.galleryVisible = Boolean(entry?.isIntersecting);
    state.lastFrame = performance.now();
  }, { threshold: 0.02 });
  state.stageObserver.observe(stage);

  if (initialQuery) filter();
  state.lastFrame = performance.now();
  state.raf = requestAnimationFrame(animateGallery);
}

function animateGallery(now) {
  if (now - state.lastFrame < 1000 / 60 - 0.5) {
    state.raf = requestAnimationFrame(animateGallery);
    return;
  }
  const elapsed = Math.min(50, now - state.lastFrame);
  state.lastFrame = now;
  const stage = document.querySelector(".gallery-stage");
  const active = stage && state.galleryVisible && !reducedMotion.matches && !document.hidden && !stage.hasAttribute("data-reading") && !stage.hasAttribute("data-manual");
  if (active && !state.opening && !state.keyboardMode) state.phase += getGallerySpacing(stage.clientWidth) * elapsed / 10000;

  if (active && !state.opening && !state.dragging && Math.abs(state.wheelDelta) > 0.00001) {
    const next = springValue(state.wheelDelta, 0, elapsed / 1000, 12, 0.01);
    state.phase += state.wheelDelta - next;
    state.wheelDelta = next;
  }

  if (active && !state.opening) layoutBooks();
  state.raf = requestAnimationFrame(animateGallery);
}

function springValue(value, target, seconds, rate = 14, threshold = 0.001) {
  const amount = -Math.expm1(-Math.min(100, Math.max(0, rate)) * Math.min(0.05, Math.max(0, seconds)));
  const next = value * (1 - amount) + target * amount;
  return Math.abs(next - target) <= threshold ? target : next;
}

function layoutBooks() {
  if (state.galleryLayoutRunning) return;
  state.galleryLayoutRunning = true;
  try { reconcileBookLayout(); }
  finally { state.galleryLayoutRunning = false; }
}

function reconcileBookLayout() {
  const stage = document.querySelector(".gallery-stage");
  const copy = document.querySelector(".hero-copy");
  if (!stage || !copy) return;
  const stageRect = stage.getBoundingClientRect();
  const copyRect = copy.getBoundingClientRect();
  const contentBounds = { left: copyRect.left - stageRect.left, right: copyRect.right - stageRect.left, bottom: copyRect.bottom - stageRect.top };
  stage.style.setProperty("--hero-content-bottom", `${contentBounds.bottom}px`);
  document.querySelector(".home-hero").style.setProperty("--hero-content-floor", `${contentBounds.bottom}px`);
  const visual = stage.querySelector(".gallery-visual");
  const manual = stage.hasAttribute("data-reading") || stage.hasAttribute("data-manual");
  visual.hidden = manual;
  state.galleryRenderer?.setHidden(manual);
  if (manual) return;
  const width = stage.clientWidth, height = stage.clientHeight;
  const overflow = Math.max(360, contentBounds.bottom + 840 - height);
  const spacing = getGallerySpacing(width);
  stage.dataset.spacing = String(spacing);
  stage.style.setProperty("--gallery-bleed", `${overflow}px`);
  const poses = getGalleryLayout({ books: state.filteredBooks, width, height, phase: state.phase + (window.scrollY - state.scrollOrigin) * 0.8, contentBounds, overflow });
  if (width < 640) poses.forEach((pose) => { pose.blur = 0; });
  const canvasReady = ["webgpu", "canvas2d"].includes(stage.dataset.renderer);
  const pool = state.galleryPool;
  const remaining = new Set(pool.keys());
  poses.forEach((pose, index) => {
    const key = `${pose.slot}:${pose.slug}`;
    remaining.delete(key);
    let element = state.galleryPool.get(key);
    if (!element) {
      const template = document.createElement("template");
      template.innerHTML = bookMarkup(findBook(pose.slug));
      element = template.content.firstElementChild;
      element.removeAttribute("data-original");
      element.dataset.slot = String(pose.slot);
      element.tabIndex = -1;
      element.setAttribute("aria-hidden", "true");
      visual.append(element);
      state.galleryPool.set(key, element);
    }
    const baseWidth = width < 640 ? 200 : 230;
    const baseHeight = width < 640 ? 280 : 310;
    const scale = pose.width / baseWidth;
    // Keep projection local to each book. Applying perspective on the entire
    // shelf shifts the vanishing point and does not match the reference camera.
    if (canvasReady) {
      const bounds = getProjectedBookBounds(pose);
      element.style.transform = `translate(${bounds.left}px,${bounds.top}px)`;
      element.style.width = `${bounds.right - bounds.left}px`;
      element.style.height = `${bounds.bottom - bounds.top}px`;
      element.style.perspective = "none";
      element.style.filter = "none";
    } else {
      element.style.transform = `translate(${pose.x - baseWidth / 2}px,${pose.y - baseHeight / 2}px) rotate(${pose.rotation}rad) scale(${scale})`;
      element.style.removeProperty("width");
      element.style.removeProperty("height");
      element.style.perspective = `${Math.max(900, pose.width, pose.height) / scale}px`;
      element.style.filter = pose.blur ? `blur(${pose.blur / scale}px)` : "none";
    }
    element.style.opacity = "1";
    element.style.zIndex = String(index + 1);
    element.style.pointerEvents = pose.hoverable ? "auto" : "none";
    element.style.setProperty("--book-yaw", `${pose.yaw}rad`);
    element.style.setProperty("--book-pitch", `${pose.pitch}rad`);
    element.style.setProperty("--cover-open", "0deg");
    state.galleryPoses.set(element, { ...pose, x: pose.x + stageRect.left, y: pose.y + stageRect.top, baseWidth, baseHeight });
  });
  remaining.forEach((key) => {
    if (state.galleryPool !== pool || !stage.isConnected) return;
    const element = pool.get(key);
    // Removing a focused hit link dispatches focusout synchronously. Unregister
    // it first so another reconciliation cannot attempt to remove it again.
    pool.delete(key);
    if (element?.parentElement === visual) element.remove();
  });
  state.galleryFrame = { poses, width, height: height + overflow, overflow, bottomFade: Math.round(Math.min(overflow * 0.6, 216)) };
  paintGallery();
}

function paintGallery() {
  if (!state.galleryFrame || !state.galleryRenderer) return;
  const poses = state.galleryFrame.poses.filter((pose) => state.galleryPool.get(`${pose.slot}:${pose.slug}`)?.style.visibility !== "hidden");
  state.galleryRenderer.render({ ...state.galleryFrame, poses, active: state.galleryVisible && !document.hidden });
}

let articleCleanup = () => {};

function articleData(book) {
  return book;
}

function escapeArticleText(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeContentURL(value) {
  const url = String(value ?? "");
  try {
    const parsed = new URL(url, location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? escapeArticleText(url) : "#";
  } catch { return "#"; }
}

function passageAttributes(passage) {
  return `data-source-passage-id="${escapeArticleText(passage.id)}"`;
}

function citationMarkup(passage, provenance) {
  const numbers = provenance.citationNumbers(passage);
  return numbers.length ? `<sup class="source-citations" aria-label="引用来源 ${numbers.join("、")}">${numbers.join(",")}</sup>` : "";
}

function sourcedProse(paragraphs, provenance, className = "") {
  return paragraphs.map((paragraph) => `<p class="${className}">${paragraph.map((passage) => `<span class="source-sentence" role="button" tabindex="0" ${passageAttributes(passage)} aria-label="查看这段介绍的参考资料">${escapeArticleText(passage.text)}${citationMarkup(passage, provenance)}</span>`).join("")}</p>`).join("");
}

function referenceMarkup(book, data, mobile = false, provenance) {
  const facts = [
    [SITE.article.factLabels[0], book.scientific],
    [SITE.article.factLabels[1], book.confidence],
    [SITE.article.factLabels[2], book.lookFor],
  ];
  return `
    <${mobile ? "details" : "aside"} class="${mobile ? "mobile-reference" : "article-aside"}" aria-label="一眼速查">
      ${mobile ? '<summary><span>一眼速查</span><small>资料依据</small></summary>' : ""}
      <figure class="portrait-plate">
        <a class="portrait-link" href="${escapeContentURL(book.image)}" target="_blank" rel="noopener noreferrer"><img src="${escapeContentURL(book.image)}" alt="${escapeArticleText(book.title)}的${escapeArticleText(SITE.article.photosTitle)}" /></a>
        <figcaption class="plate-caption"><span>Plate I · ${escapeArticleText(SITE.article.photosTitle)}</span><span class="plate-caption-text">${escapeArticleText(book.title)}：${escapeArticleText(book.locate)}</span><span class="plate-credit">${escapeArticleText(SITE.article.photoCredit)}</span></figcaption>
      </figure>
      <section class="facts" aria-labelledby="facts-heading-${mobile ? "mobile" : "desktop"}">
        <h2 id="facts-heading-${mobile ? "mobile" : "desktop"}">一眼速查</h2>
        <ul class="fact-list">
          ${facts.map(([label, text], index) => `<li><button class="fact-button" type="button" ${passageAttributes(provenance.facts[index])}><span class="fact-label">${escapeArticleText(label)}</span><span class="fact-text">${escapeArticleText(text)}${citationMarkup(provenance.facts[index], provenance)}</span><span class="fact-source">查看依据 ↗</span></button></li>`).join("")}
        </ul>
      </section>
    </${mobile ? "details" : "aside"}>`;
}

function tocItems(data) {
  const sectionItems = data.sectionTitles.map((title, index) => ({ id: `section-${index + 1}`, title }));
  return [
    { id: "overview", title: SITE.article.overviewTitle },
    ...sectionItems,
    { id: "image-plates", title: SITE.article.photosTitle },
    { id: "sources", title: SITE.article.sourcesTocTitle },
    { id: "lifeline", title: data.observation.title },
  ];
}

function tocMarkup(data) {
  return `<ol class="toc-list">${tocItems(data).map((item, index) => `<li><a href="#${item.id}" ${index === 0 ? 'aria-current="true"' : ""}>${escapeArticleText(item.title)}</a></li>`).join("")}</ol>`;
}

function imageGalleryMarkup(plates) {
  return `
    <section id="image-plates" class="image-gallery" aria-labelledby="image-plates-title">
      <div class="gallery-head">
        <div><h2 id="image-plates-title">${escapeArticleText(SITE.article.photosTitle)}</h2><p>${plates.length} 张 · ${escapeArticleText(SITE.article.photosCaption)}</p></div>
        ${plates.length > 1 ? '<div class="gallery-controls"><button class="circle-button" type="button" data-gallery-prev aria-label="上一张照片">←</button><button class="circle-button" type="button" data-gallery-next aria-label="下一张照片">→</button></div>' : ""}
      </div>
      <div class="plates-track" tabindex="0" aria-label="${escapeArticleText(SITE.article.photosTitle)}">
        ${plates.map((item, index) => `<figure class="image-plate" style="--ratio:${item.ratio || 1.5}"><a class="plate-frame" href="${escapeContentURL(item.image)}" target="_blank" rel="noopener noreferrer"><img src="${escapeContentURL(item.image)}" alt="${escapeArticleText(item.caption)}" loading="lazy" style="object-position:${escapeArticleText(item.position || "center 45%")}" /></a><figcaption><span class="plate-roman">${roman(index + 2)}</span><span>${escapeArticleText(item.caption)}</span><span class="plate-credit">${escapeArticleText(item.credit)}</span></figcaption></figure>`).join("")}
      </div>
      ${plates.length > 1 ? '<div class="gallery-progress" aria-hidden="true"><span></span></div>' : ""}
    </section>`;
}

function observationTrailMarkup(book, provenance) {
  const { title, intro, items } = book.observation;
  const photoStack = (item) => {
    if (!item.photoIndices.length) return "";
    return `<div class="trail-photo-stack" data-photo-count="${item.photoIndices.length}" aria-label="${escapeArticleText(SITE.article.photosTitle)}">${item.photoIndices.map((photoIndex, index) => {
      const photo = book.plates[photoIndex];
      const rotation = index % 2 ? 4 : -4;
      return `<button type="button" class="trail-photo" data-trail-photo="${photoIndex}" data-rotation="${rotation}" style="--photo-rotation:${rotation}deg;--photo-stack-index:${index};--photo-ratio:${photo.ratio || 1.5}" aria-label="放大${escapeArticleText(SITE.article.photosTitle)}：${escapeArticleText(photo.caption)}"><span><img src="${escapeContentURL(photo.image)}" alt="${escapeArticleText(photo.caption)}" draggable="false" loading="lazy" /></span></button>`;
    }).join("")}</div>`;
  };
  return `
    <section id="lifeline" class="lifeline-section field-study" aria-labelledby="lifeline-title">
      <div class="lifeline-head"><div><h2 id="lifeline-title">${escapeArticleText(title)}</h2><p>${escapeArticleText(intro)}</p></div><div class="lifeline-controls"><button class="circle-button" type="button" data-trail-prev aria-label="前面的观察线索">←</button><button class="circle-button" type="button" data-trail-next aria-label="后面的观察线索">→</button></div></div>
      <div class="lifeline-window" tabindex="0" aria-label="${escapeArticleText(book.title)}：${escapeArticleText(title)}">
        <div class="lifeline-rail"><div class="timeline-events" style="--event-count:${items.length}">${items.map((item, index) => `<article class="timeline-event"><span class="event-step">${String(index + 1).padStart(2, "0")}</span><h3 class="event-year">${escapeArticleText(item.title)}</h3><button class="trail-observation" type="button" ${passageAttributes(provenance.observations[index])}><span>${escapeArticleText(item.text)}</span><small>查看依据 ↗</small></button><p class="observation-cue"><span>${escapeArticleText(item.cue.label)}</span>${escapeArticleText(item.cue.text)}</p>${photoStack(item)}</article>`).join("")}</div></div>
      </div>
    </section>`;
}

function relatedMarkup(book) {
  const requested = (book.related || []).map(findBook).filter((item) => item.slug !== book.slug);
  const related = [...requested];
  ALL_BOOKS.forEach((item) => {
    if (related.length < 6 && item.slug !== book.slug && !related.some((entry) => entry.slug === item.slug)) related.push(item);
  });
  if (!related.length) return "";
  const openIndex = related.length - 1;
  return `
    <section class="related-section" aria-labelledby="related-title">
      <h2 id="related-title" class="related-title">${escapeArticleText(SITE.article.relatedTitle)}</h2>
      <div class="related-viewport" role="region" aria-label="${escapeArticleText(SITE.article.relatedLabel)}" tabindex="0"><div class="related-shelf" data-default-book="${related[openIndex].slug}">
        ${related.map((item, index) => miniBookMarkup(item, index, index === openIndex)).join("")}
      </div></div>
    </section>`;
}

function sourcesMarkup(book, prefix = "", provenance) {
  return `<ol class="sources-list">${(provenance?.sources || book.sources).map((source, index) => `<li id="${prefix}source-${index + 1}"><span class="source-number">${index + 1}</span><span><a href="${escapeContentURL(source.url)}" target="_blank" rel="noopener noreferrer">${escapeArticleText(source.title)} ↗</a><span class="source-meta">${escapeArticleText(source.meta)}</span></span></li>`).join("")}</ol>`;
}

function provenanceSourceLink(source, retrievedAt) {
  const recordedDate = typeof retrievedAt === "string" ? retrievedAt.slice(0, 10) : "";
  const label = [source.title, source.domain, recordedDate ? `检索于 ${recordedDate}` : ""].filter(Boolean).join(" · ");
  return `<a class="provenance-source-link" href="${escapeContentURL(source.url)}" target="_blank" rel="noopener noreferrer">${escapeArticleText(label)} ↗</a>`;
}

function evidenceCardMarkup(evidence, provenance) {
  const source = provenance.sourceById.get(evidence.sourceId);
  const verification = evidence.verification;
  const verificationLabel = verification && typeof verification.label === "string" ? [verification.label, verification.method ? `(${verification.method})` : ""].filter(Boolean).join(" ") : "";
  return `<li class="provenance-evidence-card" data-evidence-id="${escapeArticleText(evidence.id)}">
    <div class="provenance-evidence-meta"><span class="provenance-record-id">${escapeArticleText(evidence.id)}</span>${evidence.tier ? `<span class="provenance-badge">${escapeArticleText(evidence.tier)}</span>` : ""}${verificationLabel ? `<span class="provenance-badge" data-verification="${escapeArticleText(verification.label)}">${escapeArticleText(verificationLabel)}</span>` : ""}</div>
    <blockquote class="provenance-evidence-quote">“${escapeArticleText(evidence.quote)}”</blockquote>
    ${provenanceSourceLink(source, evidence.retrievedAt || source.retrievedAt)}
  </li>`;
}

function selectedProvenanceMarkup(passage, provenance) {
  const type = { sentence: "句子", fact: "观察事实", observation: "观察线索" }[passage.kind];
  const evidence = provenance.evidenceFor(passage);
  const contextualSources = provenance.contextualSourcesFor(passage);
  return `<section class="provenance-card" data-selected-passage="${escapeArticleText(passage.id)}">
    <header class="provenance-card-heading"><h3>${type} ${passage.number}</h3><span>导览说明</span></header>
    <div class="provenance-card-body">
      <div class="provenance-evidence"><p class="provenance-label">证据</p>${evidence.length ? "" : '<p class="provenance-empty">尚未录入这段介绍的证据摘录。</p>'}<ul class="provenance-evidence-list">${evidence.map((record) => evidenceCardMarkup(record, provenance)).join("")}</ul></div>
      ${contextualSources.length ? `<div class="provenance-context"><p class="provenance-label">本条目参考资料</p><p class="provenance-scope-note">以下资料属于整个条目，尚未与所选介绍逐句核验。</p><ul class="provenance-evidence-list">${contextualSources.map((source) => `<li class="provenance-evidence-card" data-contextual-source-id="${escapeArticleText(source.id)}"><div class="provenance-evidence-meta"><span class="provenance-record-id">资料 ${source.number}</span><span class="provenance-badge">条目范围</span></div>${source.meta ? `<p class="provenance-context-meta">${escapeArticleText(source.meta)}</p>` : ""}${provenanceSourceLink(source)}</li>`).join("")}</ul></div>` : ""}
    </div>
  </section>`;
}

function renderArticle(book) {
  stopDynamicWork();
  const data = articleData(book);
  const provenance = createProvenanceModel(book);
  const items = tocItems(data);
  document.body.dataset.page = "article";
  document.body.style.setProperty("--paper", book.color);
  document.title = `${book.title} — ${SITE.title}`;
  app.innerHTML = `
    <div class="article-shell">
      ${headerMarkup()}
      <main id="main-content" class="article-reader">
        <h1 class="article-title">${escapeArticleText(book.title)}</h1>
        <ul class="article-categories">${book.categories.map((category) => `<li>${escapeArticleText(category)}</li>`).join("")}</ul>
        <details class="mobile-toc"><summary>目录 · ${items.length} 节</summary>${tocMarkup(data)}</details>
        <div class="article-layout">
          <nav class="article-toc" aria-label="详情页目录"><p class="toc-heading">GUIDE · 目录</p>${tocMarkup(data)}</nav>
          <article class="article-main">
            <section id="overview" tabindex="-1"><h2>${escapeArticleText(SITE.article.overviewTitle)}</h2>${sourcedProse(provenance.prose.overview, provenance, "overview-copy")}</section>
            ${referenceMarkup(book, data, true, provenance)}
            ${data.sectionTitles.map((title, index) => `<section id="section-${index + 1}" class="article-section" tabindex="-1"><h2>${escapeArticleText(title)}</h2>${sourcedProse(provenance.prose[`section-${index + 1}`], provenance)}</section>`).join("")}
            <figure class="pull-quote"><span class="pull-quote-mark" aria-hidden="true">“</span><blockquote>${escapeArticleText(data.quote)}</blockquote><figcaption><strong>${escapeArticleText(book.title)}</strong><span>${escapeArticleText(data.quoteNote)}</span></figcaption></figure>
            <section id="sources" class="article-section"><h2>${escapeArticleText(SITE.article.sourcesTitle)}</h2>${sourcesMarkup(book, "", provenance)}<p class="fact-check">${escapeArticleText(SITE.article.factCheck)}</p></section>
          </article>
          ${referenceMarkup(book, data, false, provenance)}
        </div>
        ${imageGalleryMarkup(data.plates)}
        ${observationTrailMarkup(book, provenance)}
        ${relatedMarkup(book)}
      </main>
      ${footerMarkup(true)}
      <div class="source-drawer" hidden><div class="source-drawer-backdrop" data-close-source></div><aside class="source-drawer-panel" role="dialog" aria-modal="true" aria-label="介绍的参考资料" tabindex="-1"><button class="source-drawer-close" type="button" data-close-source aria-label="关闭资料面板">关闭 ×</button><p class="source-selected-passage"></p><div class="source-provenance-content"></div></aside></div>
      <div class="trail-photo-dialog" role="dialog" aria-modal="true" aria-label="${escapeArticleText(SITE.article.photosTitle)}" hidden><div class="trail-photo-backdrop" data-close-trail-photo></div><button class="trail-photo-close" type="button" data-close-trail-photo aria-label="关闭放大照片">×</button><figure class="trail-photo-enlarged" data-close-trail-photo><img alt="" /><figcaption class="sr-only"></figcaption></figure></div>
    </div>`;

  bindHeader();
  bindArticle(book, data, provenance);
  applyTheme();
  bindImageFallbacks();
}

function bindArticle(book, data, provenance) {
  const cleanup = [];
  const listen = (target, name, callback, options) => {
    target?.addEventListener(name, callback, options);
    cleanup.push(() => target?.removeEventListener(name, callback, options));
  };
  document.querySelectorAll(".portrait-link img").forEach((image) => {
    const sizePortrait = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      image.dataset.photoOrientation = image.naturalHeight > image.naturalWidth ? "portrait" : image.naturalWidth / image.naturalHeight >= 1.45 ? "wide" : "landscape";
    };
    listen(image, "load", sizePortrait);
    sizePortrait();
  });
  const tocLinks = [...document.querySelectorAll('.toc-list a[href^="#"]')];
  const observed = tocItems(data).map((item) => document.getElementById(item.id)).filter(Boolean);
  const visibleSections = new Set();
  const selectToc = (id) => tocLinks.forEach((link) => {
    if (link.getAttribute("href") === `#${id}`) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.isIntersecting ? visibleSections.add(entry.target) : visibleSections.delete(entry.target));
    const first = [...visibleSections].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    if (first) selectToc(first.id);
  }, { rootMargin: "-80px 0px -55% 0px" });
  observed.forEach((section) => observer.observe(section));
  cleanup.push(() => observer.disconnect());
  const selectHash = () => {
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Retain an undecodable hash as text. */ }
    if (observed.some((section) => section.id === id)) selectToc(id);
  };
  listen(window, "hashchange", selectHash);
  selectHash();
  tocLinks.forEach((link) => listen(link, "click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    selectToc(link.hash.slice(1));
  }));

  const drawer = document.querySelector(".source-drawer");
  const drawerPanel = drawer.querySelector(".source-drawer-panel");
  let sourceFocus = null;
  const closeSource = (restoreFocus = true) => {
    drawer.hidden = true;
    sourceFocus?.classList.remove("is-source-active");
    if (restoreFocus && sourceFocus?.isConnected) sourceFocus.focus({ preventScroll: true });
    sourceFocus = null;
  };
  const showSource = (element) => {
    const passage = provenance.passageById.get(element.dataset.sourcePassageId);
    if (!passage) return;
    sourceFocus?.classList.remove("is-source-active");
    sourceFocus = element;
    element.classList.add("is-source-active");
    drawer.querySelector(".source-selected-passage").textContent = passage.text;
    drawer.querySelector(".source-provenance-content").innerHTML = selectedProvenanceMarkup(passage, provenance);
    drawer.hidden = false;
    drawerPanel.scrollTop = 0;
    drawer.querySelector(".source-drawer-close").focus({ preventScroll: true });
  };
  document.querySelectorAll("[data-source-passage-id]").forEach((element) => {
    listen(element, "click", () => showSource(element));
    if (element.tagName !== "BUTTON") listen(element, "keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      showSource(element);
    });
  });
  drawer.querySelectorAll("[data-close-source]").forEach((element) => listen(element, "click", () => closeSource()));
  listen(document, "keydown", (event) => {
    if (drawer.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); closeSource(); return; }
    if (event.key !== "Tab") return;
    const focusables = [...drawerPanel.querySelectorAll('button:not([disabled]), a[href]')].filter((element) => element.getClientRects().length);
    const first = focusables[0], last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  cleanup.push(() => closeSource(false));

  const photoDialog = document.querySelector(".trail-photo-dialog");
  const photoFigure = photoDialog.querySelector(".trail-photo-enlarged");
  const photoClose = photoDialog.querySelector(".trail-photo-close");
  let photoSource = null, photoFrame = 0, photoTimer = 0, photoClosing = false, ignorePhotoClickUntil = 0;
  const photoPose = (element) => {
    const rect = element.getBoundingClientRect();
    const angle = Math.abs(Number(element.dataset.rotation) * Math.PI / 180);
    const projectedWidth = element.offsetWidth * Math.cos(angle) + element.offsetHeight * Math.sin(angle);
    const scale = projectedWidth > 0 ? rect.width / projectedWidth : 1;
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, width: element.offsetWidth * scale, height: element.offsetHeight * scale, rotation: Number(element.dataset.rotation) || 0 };
  };
  const returnPhotoTransform = () => {
    if (!photoSource) return "none";
    const pose = photoPose(photoSource);
    const width = parseFloat(photoFigure.style.width);
    return `translate(${pose.cx - innerWidth / 2}px,${pose.cy - innerHeight / 2}px) scale(${pose.width / width}) rotate(${pose.rotation}deg)`;
  };
  const finishPhoto = (restoreFocus = true) => {
    cancelAnimationFrame(photoFrame); clearTimeout(photoTimer);
    photoDialog.hidden = true;
    photoDialog.classList.remove("is-visible");
    if (photoSource) {
      photoSource.style.removeProperty("visibility");
      if (restoreFocus && photoSource.isConnected) photoSource.focus({ preventScroll: true });
    }
    photoSource = null; photoClosing = false;
  };
  const closePhoto = () => {
    if (!photoSource || photoClosing || performance.now() < ignorePhotoClickUntil) return;
    if (reducedMotion.matches) return finishPhoto();
    photoClosing = true;
    photoDialog.classList.remove("is-visible");
    photoFigure.style.transform = returnPhotoTransform();
    photoTimer = window.setTimeout(() => finishPhoto(), 640);
  };
  const openPhoto = (element, pointer = false) => {
    if (photoSource) return;
    const pose = photoPose(element);
    const ratio = pose.height / Math.max(1, pose.width);
    const width = Math.min(innerWidth * .85, innerHeight * .85 / ratio);
    const height = width * ratio;
    const image = element.querySelector("img");
    photoSource = element;
    photoClosing = false;
    photoFigure.querySelector("img").src = image.currentSrc || image.src;
    photoFigure.querySelector("img").alt = image.alt;
    photoFigure.querySelector("figcaption").textContent = image.alt;
    photoDialog.setAttribute("aria-label", image.alt);
    Object.assign(photoFigure.style, { left: `${(innerWidth - width) / 2}px`, top: `${(innerHeight - height) / 2}px`, width: `${width}px`, height: `${height}px`, transition: "none" });
    photoFigure.style.transform = reducedMotion.matches ? "none" : returnPhotoTransform();
    photoDialog.hidden = false;
    element.style.visibility = "hidden";
    ignorePhotoClickUntil = pointer ? performance.now() + 100 : 0;
    photoClose.focus({ preventScroll: true });
    if (reducedMotion.matches) photoDialog.classList.add("is-visible");
    else photoFrame = requestAnimationFrame(() => {
      photoFrame = requestAnimationFrame(() => {
        photoFigure.style.removeProperty("transition");
        photoDialog.classList.add("is-visible");
        photoFigure.style.transform = "translate(0px,0px) scale(1) rotate(0deg)";
      });
    });
  };
  photoDialog.querySelectorAll("[data-close-trail-photo]").forEach((element) => listen(element, "click", closePhoto));
  listen(photoFigure, "transitionend", (event) => { if (event.propertyName === "transform" && photoClosing) finishPhoto(); });
  listen(photoDialog, "touchmove", (event) => event.preventDefault(), { passive: false });
  listen(photoDialog, "wheel", (event) => event.preventDefault(), { passive: false });
  listen(document, "keydown", (event) => {
    if (photoDialog.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); closePhoto(); }
    else if (event.key === "Tab") { event.preventDefault(); photoClose.focus(); }
  });
  document.querySelectorAll(".trail-photo").forEach((element) => {
    let position = { x: 0, y: 0 }, drag = null;
    const place = () => element.style.transform = `translate(${position.x}px,${position.y}px) rotate(${element.dataset.rotation}deg)`;
    listen(element, "pointerdown", (event) => {
      if (event.button !== 0 || photoSource) return;
      event.stopPropagation(); event.preventDefault();
      element.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: position.x, baseY: position.y, moved: false, slop: event.pointerType === "touch" ? 10 : 4 };
      element.classList.add("is-dragging");
    });
    listen(element, "pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.stopPropagation();
      const x = event.clientX - drag.startX, y = event.clientY - drag.startY;
      if (Math.hypot(x, y) > drag.slop) drag.moved = true;
      position = { x: drag.baseX + x, y: drag.baseY + y };
      place();
    });
    listen(element, "pointerup", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.stopPropagation();
      const moved = drag.moved;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      drag = null; element.classList.remove("is-dragging");
      if (!moved) openPhoto(element, true);
    });
    listen(element, "pointercancel", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      position = { x: drag.baseX, y: drag.baseY }; place();
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      drag = null; element.classList.remove("is-dragging");
    });
    listen(element, "click", (event) => { event.preventDefault(); if (event.detail === 0) openPhoto(element); });
  });
  cleanup.push(() => finishPhoto(false));

  const track = document.querySelector(".plates-track");
  const previous = document.querySelector("[data-gallery-prev]");
  const next = document.querySelector("[data-gallery-next]");
  const progress = document.querySelector(".gallery-progress span");
  const updateGallery = () => {
    const max = track.scrollWidth - track.clientWidth;
    if (progress) progress.style.transform = `scaleX(${Math.max(0.04, max > 0 ? track.scrollLeft / max : 1)})`;
    if (previous) previous.disabled = track.scrollLeft <= 2;
    if (next) next.disabled = track.scrollLeft >= max - 2;
  };
  const stepGallery = (direction) => {
    const padding = parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    const left = track.scrollLeft + padding;
    const plates = [...track.children];
    const target = direction > 0 ? plates.find((plate) => plate.offsetLeft > left + 4) : plates.reverse().find((plate) => plate.offsetLeft < left - 4);
    if (target) track.scrollTo({ left: target.offsetLeft - padding, behavior: reducedMotion.matches ? "instant" : "smooth" });
  };
  listen(previous, "click", () => stepGallery(-1));
  listen(next, "click", () => stepGallery(1));
  listen(track, "keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    stepGallery(event.key === "ArrowRight" ? 1 : -1);
  });
  listen(track, "scroll", updateGallery, { passive: true });
  const galleryResize = new ResizeObserver(updateGallery);
  galleryResize.observe(track);
  cleanup.push(() => galleryResize.disconnect());
  updateGallery();

  const lifeline = document.querySelector(".lifeline-window");
  const trailPrevious = document.querySelector("[data-trail-prev]");
  const trailNext = document.querySelector("[data-trail-next]");
  const markers = [...lifeline.querySelectorAll(".timeline-event")];
  const trailVertical = matchMedia("(max-width: 767px)");
  let trailFrame = 0, trailDrag = null, trailVelocity = 0, trailIntro = false;
  const trailPosition = () => trailVertical.matches ? lifeline.scrollTop : lifeline.scrollLeft;
  const placeTrail = (position) => { if (trailVertical.matches) lifeline.scrollTop = position; else lifeline.scrollLeft = position; };
  const maxTrail = () => Math.max(0, trailVertical.matches ? lifeline.scrollHeight - lifeline.clientHeight : lifeline.scrollWidth - lifeline.clientWidth);
  const updateTrail = () => {
    const max = maxTrail();
    trailPrevious.disabled = trailIntro || trailPosition() <= 1;
    trailNext.disabled = trailIntro || trailPosition() >= max - 1;
    trailPrevious.parentElement.hidden = !trailVertical.matches && max <= 1;
    lifeline.classList.toggle("is-scrollable", max > 0);
    const bounds = lifeline.getBoundingClientRect();
    markers.forEach((marker) => {
      const box = marker.getBoundingClientRect();
      const visibleWidth = Math.min(box.right, bounds.right - 12) - Math.max(box.left, bounds.left + 24);
      marker.style.opacity = trailVertical.matches ? "1" : String(Math.max(0, Math.min(1, visibleWidth / Math.max(1, box.width * 0.5))));
    });
  };
  const stopTrail = () => { cancelAnimationFrame(trailFrame); trailFrame = 0; trailVelocity = 0; };
  const glideTrail = () => {
    cancelAnimationFrame(trailFrame);
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(32, now - last); last = now;
      if (Math.abs(trailVelocity) < 0.025) { trailFrame = 0; return; }
      placeTrail(trailPosition() + trailVelocity * dt);
      trailVelocity *= Math.pow(0.94, dt / 16.67);
      updateTrail();
      if (trailPosition() <= 0 || trailPosition() >= maxTrail()) { trailFrame = 0; return; }
      trailFrame = requestAnimationFrame(frame);
    };
    trailFrame = requestAnimationFrame(frame);
  };
  const stepTrail = (direction) => {
    if (trailIntro) return;
    stopTrail();
    const from = trailPosition();
    const to = Math.max(0, Math.min(maxTrail(), from + direction * Math.max(240, lifeline.clientWidth * 0.6)));
    if (reducedMotion.matches) { placeTrail(to); updateTrail(); return; }
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / 450);
      placeTrail(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      updateTrail();
      trailFrame = t < 1 ? requestAnimationFrame(frame) : 0;
    };
    trailFrame = requestAnimationFrame(frame);
  };
  listen(trailPrevious, "click", () => stepTrail(-1));
  listen(trailNext, "click", () => stepTrail(1));
  listen(lifeline, "wheel", (event) => {
    if (trailVertical.matches || trailIntro || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || !maxTrail()) return;
    event.preventDefault();
    stopTrail();
    const delta = event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerWidth : 1) * 1.4;
    lifeline.scrollLeft += delta;
    updateTrail();
    if (!reducedMotion.matches) { trailVelocity = delta / 16.67 * 0.35 * 0.65; glideTrail(); }
  }, { passive: false });
  listen(lifeline, "pointerdown", (event) => {
    if (trailVertical.matches || trailIntro || !maxTrail() || event.button !== 0 || event.target.closest("a,button")) return;
    stopTrail();
    trailDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: lifeline.scrollLeft, axis: event.pointerType === "touch" ? null : "x", lastX: event.clientX, lastTime: performance.now(), touch: event.pointerType === "touch" };
    if (!trailDrag.touch) { lifeline.setPointerCapture(event.pointerId); lifeline.classList.add("is-dragging"); }
  });
  listen(lifeline, "pointermove", (event) => {
    if (!trailDrag || trailDrag.id !== event.pointerId) return;
    const x = event.clientX - trailDrag.x, y = event.clientY - trailDrag.y;
    if (!trailDrag.axis) {
      if (Math.max(Math.abs(x), Math.abs(y)) < 8) return;
      trailDrag.axis = Math.abs(x) >= Math.abs(y) ? "x" : "y";
      if (trailDrag.axis === "y") { trailDrag = null; return; }
      lifeline.setPointerCapture(event.pointerId); lifeline.classList.add("is-dragging");
    }
    event.preventDefault();
    const now = performance.now(), dt = now - trailDrag.lastTime, factor = trailDrag.touch ? 1.15 : 1;
    if (dt > 0 && dt < 80) trailVelocity = -(event.clientX - trailDrag.lastX) / dt * factor * 0.65 + trailVelocity * 0.35;
    trailDrag.lastX = event.clientX; trailDrag.lastTime = now;
    lifeline.scrollLeft = trailDrag.left - x * factor;
    updateTrail();
  }, { passive: false });
  const releaseTrail = (event) => {
    if (!trailDrag || trailDrag.id !== event.pointerId) return;
    const moved = trailDrag.axis === "x";
    trailDrag = null;
    if (lifeline.hasPointerCapture(event.pointerId)) lifeline.releasePointerCapture(event.pointerId);
    lifeline.classList.remove("is-dragging");
    if (moved && !reducedMotion.matches) glideTrail();
  };
  listen(lifeline, "pointerup", releaseTrail);
  listen(lifeline, "pointercancel", releaseTrail);
  listen(lifeline, "keydown", (event) => {
    if (trailVertical.matches || trailIntro || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); stopTrail();
    lifeline.scrollLeft += (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) * maxTrail() * 0.05;
    updateTrail();
  });
  listen(lifeline, "scroll", updateTrail, { passive: true });
  const trailResize = new ResizeObserver(updateTrail);
  trailResize.observe(lifeline);
  listen(trailVertical, "change", () => {
    stopTrail(); trailIntro = false; trailDrag = null;
    delete lifeline.dataset.intro;
    lifeline.scrollLeft = 0; lifeline.scrollTop = 0;
    updateTrail();
  });
  const trailEntrance = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    trailEntrance.disconnect();
    if (reducedMotion.matches) { placeTrail(maxTrail()); updateTrail(); return; }
    trailIntro = true;
    lifeline.dataset.intro = "true";
    const start = performance.now(), duration = 3200;
    const frame = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = Math.pow(t * t * (3 - 2 * t), 2.6);
      placeTrail(maxTrail() * eased);
      lifeline.style.setProperty("--trail-progress", String(eased));
      updateTrail();
      if (t < 1) trailFrame = requestAnimationFrame(frame);
      else { trailFrame = 0; trailIntro = false; delete lifeline.dataset.intro; updateTrail(); }
    };
    trailFrame = requestAnimationFrame(frame);
  }, { rootMargin: "0px 200px", threshold: 0.1 });
  trailEntrance.observe(lifeline);
  cleanup.push(() => { stopTrail(); trailResize.disconnect(); trailEntrance.disconnect(); });
  updateTrail();

  const relatedShelf = document.querySelector(".related-shelf");
  const clearShelfIntent = bindShelf(relatedShelf, relatedShelf?.dataset.defaultBook);
  if (clearShelfIntent) cleanup.push(clearShelfIntent);
  articleCleanup = () => { cleanup.forEach((dispose) => dispose()); articleCleanup = () => {}; };
}

const OPEN_SPIN_MS = 600;
const OPEN_ZOOM_MS = 460;
const PAPER_REVEAL_MS = 220;

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function afterFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function sourceFlightPose(source) {
  const moving = state.galleryPoses.get(source);
  if (moving) return { ...moving };
  const volume = source.querySelector(".mini-volume, .book-volume");
  const anchor = source.getBoundingClientRect();
  const mini = volume?.classList.contains("mini-volume");
  const baseWidth = volume?.offsetWidth || source.offsetWidth;
  const baseHeight = volume?.offsetHeight || source.offsetHeight;
  const zoom = anchor.height / Math.max(1, source.offsetHeight);
  const matrix = new DOMMatrixReadOnly(getComputedStyle(volume || source).transform);
  const yaw = Math.atan2(-matrix.m13, matrix.m11);
  const pitch = Math.atan2(-matrix.m32, matrix.m22);
  return {
    x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2,
    width: baseWidth * zoom, height: baseHeight * zoom,
    thickness: (mini ? 38 : 26) * zoom, yaw, pitch, rotation: 0,
    baseWidth, baseHeight, baseDepth: mini ? 38 : 26,
    optics: { perspective: (mini ? 1200 : 900) * zoom, cameraX: 0,
      cameraY: mini ? baseHeight * zoom / 2 : 0, pivotX: 0,
      pivotY: mini ? baseHeight * zoom / 2 : 0, translateX: 0,
      translateY: 0, translateZ: matrix.m43 * zoom },
  };
}

function replaceFlightVolume(paper, source, fallbackVolume) {
  const original = source?.querySelector(".mini-volume, .book-volume") || fallbackVolume;
  const volume = original.cloneNode(true);
  paper.toggleAttribute("data-home-shelf", Boolean(source?.closest(".home-recommended")));
  if (source && original.classList.contains("mini-volume")) {
    // The flight sits outside its shelf. Retain the shelf's rendered material,
    // while leaving geometry and opacity to the flight's transform/reveal CSS.
    const properties = [
      "background-color", "background-image", "background-position", "background-size",
      "background-repeat", "background-clip", "-webkit-background-clip",
      "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
      "box-shadow", "color", "-webkit-text-fill-color", "text-shadow",
      "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
      "filter", "mix-blend-mode", "object-position",
    ];
    const originals = [original, ...original.querySelectorAll("*")];
    const clones = [volume, ...volume.querySelectorAll("*")];
    originals.forEach((element, index) => {
      const computed = getComputedStyle(element);
      properties.forEach((property) => clones[index].style.setProperty(property, computed.getPropertyValue(property)));
    });
    const material = getComputedStyle(original);
    ["--shelf-cover", "--book-ink", "--book-ink-gradient", "--book-ink-shadow", "--book-material-line",
      "--book-image-filter", "--book-image-blend", "--book-page-light", "--book-page-shade", "--book-page-mid",
    ].forEach((property) => {
      const value = material.getPropertyValue(property);
      if (value) volume.style.setProperty(property, value);
    });
  }
  paper.replaceChildren(volume);
}

function createBookFlight(book, source, pose, label, cancelable = false) {
  transitionLayer.removeAttribute("aria-hidden");
  transitionLayer.innerHTML = `<div class="flight-overlay" role="dialog" aria-modal="true" aria-label="${label} ${escapeArticleText(book.title)}" tabindex="-1"><div class="flight-paper"></div><span class="flight-status" role="status">${label} ${escapeArticleText(book.title)}</span></div>`;
  const paper = transitionLayer.querySelector(".flight-paper");
  const template = document.createElement("template");
  template.innerHTML = bookMarkup(book);
  replaceFlightVolume(paper, source, template.content.querySelector(".book-volume"));
  paper.style.setProperty("--flight-color", book.color);
  paper.style.setProperty("--book-color", book.color);
  paper.style.setProperty("--cover-width", `${pose.baseWidth || 230}px`);
  paper.style.setProperty("--book-h", `${pose.baseHeight || 310}px`);
  paper.style.setProperty("--book-depth", `${pose.baseDepth || 26}px`);
  state.transitionCancelled = false;
  const overlay = transitionLayer.querySelector(".flight-overlay");
  const onKeydown = (event) => {
    if (event.key === "Tab") event.preventDefault();
    if (cancelable && event.key === "Escape") { event.preventDefault(); state.transitionCancelled = "escape"; }
  };
  document.addEventListener("keydown", onKeydown, true);
  state.transitionCleanup = () => document.removeEventListener("keydown", onKeydown, true);
  overlay.focus({ preventScroll: true });
  return paper;
}

function clearBookFlight() {
  state.transitionCleanup?.();
  state.transitionCleanup = null;
  state.transitionCancelled = false;
  transitionLayer.replaceChildren();
  transitionLayer.setAttribute("aria-hidden", "true");
}

function setFlightFrame(paper, pose, elapsed, direction = "open") {
  const frame = computeFlightFrame(pose, { width: innerWidth, height: innerHeight }, elapsed, direction);
  paper.style.left = `${-frame.baseWidth / 2}px`;
  paper.style.top = `${-frame.baseHeight / 2}px`;
  paper.style.width = `${frame.baseWidth}px`;
  paper.style.height = `${frame.baseHeight}px`;
  paper.style.transform = frame.transform;
  paper.style.setProperty("--flight-content-opacity", String(frame.contentOpacity));
  paper.dataset.phase = frame.phase;
}

function animateBookFlight(paper, pose, direction = "open") {
  const duration = OPEN_SPIN_MS + OPEN_ZOOM_MS;
  return new Promise((resolve) => {
    const started = performance.now();
    const draw = (now) => {
      if (state.transitionCancelled) return resolve(false);
      const elapsed = Math.min(duration, now - started);
      setFlightFrame(paper, pose, elapsed, direction);
      if (elapsed < duration) requestAnimationFrame(draw);
      else resolve(true);
    };
    setFlightFrame(paper, pose, 0, direction);
    requestAnimationFrame(draw);
  });
}

async function openBook(slug, source) {
  if (state.opening) return;
  const book = findBook(slug);
  if (reducedMotion.matches || !source) {
    state.bookTransition = null;
    history.pushState({ slug: book.slug }, "", `/t/${book.slug}`);
    window.scrollTo({ top: 0, behavior: "instant" });
    renderArticle(book);
    return;
  }
  const pose = sourceFlightPose(source);
  const sourceStage = source.closest(".gallery-stage");
  const sourceShelf = source.closest(".related-shelf");
  const sourceReading = sourceStage?.hasAttribute("data-reading");
  const sourceScrollLeft = sourceStage?.scrollLeft || 0;
  const memory = {
    slug: book.slug, fromPath: location.pathname,
    surface: sourceShelf ? (location.pathname === "/" ? "home-shelf" : "related") : "hero",
    scrollY: window.scrollY, scrollOrigin: state.scrollOrigin, query: state.query,
    homeNative: Boolean(source.closest(".book-field")), homeScrollLeft: sourceScrollLeft,
    shelfScrollLeft: source.closest(".related-viewport, .home-shelf-viewport")?.scrollLeft || 0,
    sourceKeyboardFocus: source.matches(":focus-visible"),
    phase: state.phase, sceneX: pose.x / innerWidth, pose,
  };
  state.opening = true;
  state.bookTransition = memory;
  const paper = createBookFlight(book, source, pose, "正在打开", true);
  source.style.visibility = "hidden";
  paintGallery();
  const previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  try {
    const completed = await animateBookFlight(paper, pose);
    if (!completed) { source.style.removeProperty("visibility"); state.bookTransition = null; return; }
    history.pushState({ slug: book.slug }, "", `/t/${book.slug}`);
    renderArticle(book);
    window.scrollTo({ top: 0, behavior: "instant" });
    await afterFrame();
    if (state.transitionCancelled) return;
    const overlay = paper.parentElement;
    await overlay.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.02)" }], { duration: PAPER_REVEAL_MS, easing: "cubic-bezier(.23,1,.32,1)", fill: "forwards" }).finished.catch(() => {});
  } finally {
    const restoreSource = state.transitionCancelled === "escape" && source.isConnected;
    document.documentElement.style.overflow = previousOverflow;
    clearBookFlight();
    if (restoreSource) {
      source.focus({ preventScroll: true });
      if (sourceReading && sourceStage?.isConnected) {
        sourceStage.dataset.reading = "true";
        state.keyboardMode = true;
        layoutBooks();
        sourceStage.scrollLeft = sourceScrollLeft;
      }
    }
    state.opening = false;
    state.lastFrame = performance.now();
    paintGallery();
  }
}

async function returnBook(memory, targetPath, historyMode = "push") {
  if (state.opening) return;
  state.opening = true;
  const book = findBook(memory.slug);
  const returningShelf = memory.surface === "related" || memory.surface === "home-shelf";
  const paper = createBookFlight(book, null, memory.pose, "正在返回");
  setFlightFrame(paper, memory.pose, OPEN_SPIN_MS + OPEN_ZOOM_MS);
  const overlay = paper.parentElement;
  const previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  let target;
  let landed = false;
  let restoreShelfTransitions = () => {};
  try {
    await overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PAPER_REVEAL_MS, easing: "linear", fill: "forwards" }).finished.catch(() => {});
    if (state.transitionCancelled) return;
    if (historyMode === "push") history.pushState({}, "", targetPath);
    if (targetPath === "/") {
      renderHome();
      state.query = memory.query;
      const input = document.querySelector("#topic-search");
      input.value = memory.query;
      state.filteredBooks = filterPlants(BOOKS, memory.query).slice(0, 40);
      stageOriginals();
      state.phase = memory.phase;
      state.scrollOrigin = memory.scrollOrigin;
      if (memory.homeNative) {
        const stage = document.querySelector(".gallery-stage");
        stage.dataset.reading = "true";
        state.keyboardMode = true;
        layoutBooks();
        stage.scrollLeft = memory.homeScrollLeft;
      }
    } else {
      renderArticle(findBook(targetPath.split("/").pop()));
    }
    window.scrollTo({ top: memory.scrollY, behavior: "instant" });
    await afterFrame();
    if (state.transitionCancelled) return;
    if (targetPath === "/" && !returningShelf) {
      layoutBooks();
      target = memory.homeNative
        ? document.querySelector(`.book-field .hero-book[data-book="${book.slug}"]`)
        : [...state.galleryPool.values()].filter((item) => item.dataset.book === book.slug).sort((a,b) => Math.abs(state.galleryPoses.get(a).x - memory.sceneX * innerWidth) - Math.abs(state.galleryPoses.get(b).x - memory.sceneX * innerWidth))[0];
    } else {
      const shelf = document.querySelector(targetPath === "/" ? "#recommended .related-viewport" : ".related-section .related-viewport");
      target = shelf?.querySelector(`.mini-book[data-book="${book.slug}"]`);
      if (target) {
        const books = [...target.closest(".related-shelf").querySelectorAll(".mini-book")];
        const transitions = books.flatMap((item) => [item, item.querySelector(".mini-volume")]).map((element) => ({
          element,
          value: element.style.getPropertyValue("transition"),
          priority: element.style.getPropertyPriority("transition"),
        }));
        transitions.forEach(({ element }) => element.style.setProperty("transition", "none"));
        books.forEach((item) => { item.dataset.open = String(item === target); });
        // Measure the final shelf pose, so the landing book cannot keep rotating
        // or changing width underneath the reverse flight.
        target.getBoundingClientRect();
        restoreShelfTransitions = () => transitions.forEach(({ element, value, priority }) => {
          if (value) element.style.setProperty("transition", value, priority);
          else element.style.removeProperty("transition");
        });
      }
      if (shelf) shelf.scrollLeft = memory.shelfScrollLeft;
    }
    if (!target) throw new Error("Return target is unavailable");
    const pose = sourceFlightPose(target);
    replaceFlightVolume(paper, target);
    target.style.visibility = "hidden";
    paintGallery();
    landed = await animateBookFlight(paper, pose, "return");
  } finally {
    target?.style.removeProperty("visibility");
    restoreShelfTransitions();
    clearBookFlight();
    if (landed && (memory.homeNative || memory.sourceKeyboardFocus) && target?.isConnected) {
      target.focus({ preventScroll: true });
      if (memory.homeNative) target.closest(".gallery-stage").scrollLeft = memory.homeScrollLeft;
    }
    state.opening = false;
    state.lastFrame = performance.now();
    state.bookTransition = null;
    document.documentElement.style.overflow = previousOverflow;
    paintGallery();
  }
}

function stageOriginals() {
  const slugs = new Set(state.filteredBooks.map((book) => book.slug));
  const field = document.querySelector(".book-field");
  const originals = [...(field?.querySelectorAll(".hero-book") || [])];
  const bySlug = new Map(originals.map((element) => [element.dataset.book, element]));
  originals.forEach((element) => { element.hidden = !slugs.has(element.dataset.book); });
  const order = [...state.filteredBooks.map((book) => bySlug.get(book.slug)).filter(Boolean), ...originals.filter((element) => element.hidden)];
  order.forEach((element, index) => {
    if (field.children[index] !== element) field.insertBefore(element, field.children[index] || null);
  });
  const clear = document.querySelector(".topic-clear"), rotator = document.querySelector(".topic-rotator"), input = document.querySelector("#topic-search");
  if (input) { clear.hidden = !input.value; rotator.hidden = Boolean(input.value); input.classList.toggle("is-clearable", Boolean(input.value)); input.classList.toggle("is-rotating", !input.value); }
  const collection = document.querySelector(".gallery-collection");
  if (collection) collection.textContent = state.query ? `${state.filteredBooks.length} 个与“${state.query}”匹配的条目` : `${SITE.gallery.collectionLabel} · ${BOOKS.length} 个条目`;
  const count = state.filteredBooks.length;
  const status = document.querySelector("#topic-search-status");
  if (status) status.textContent = state.query ? (count ? `${count} 个${SITE.search.noun}匹配“${state.query}”` : `没有${SITE.search.noun}匹配“${state.query}”`) : "";
  const stage = document.querySelector(".gallery-stage");
  stage?.querySelector(".gallery-empty")?.remove();
  if (stage && !count && state.query) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.setAttribute("role", "status");
    empty.textContent = `没有与“${state.query}”匹配的${SITE.search.noun}。`;
    stage.append(empty);
  }
}

async function navigateHome(query = "", historyMode = "push") {
  if (state.opening) return;
  if (document.body.dataset.page === "home") {
    const input = document.querySelector("#topic-search");
    if (input && query) { input.value = query; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); }
    else window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
    return;
  }
  const memory = state.bookTransition;
  if (!query && !reducedMotion.matches && memory?.fromPath === "/") {
    await returnBook(memory, "/", historyMode);
    return;
  }
  if (historyMode === "push") history.pushState({}, "", "/");
  window.scrollTo({ top: 0, behavior: "instant" });
  renderHome(query);
}

function bindImageFallbacks() {
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("error", () => {
      image.style.visibility = "hidden";
      image.parentElement?.style.setProperty("background", "linear-gradient(135deg, rgba(22,72,53,.28), transparent 48%, rgba(255,255,255,.16))");
    }, { once: true });
  });
}

function roman(number) {
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return numerals[number - 1] || String(number);
}

function stopDynamicWork() {
  articleCleanup();
  state.homeCleanup?.();
  state.homeCleanup = null;
  cancelAnimationFrame(state.raf);
  clearInterval(state.placeholderTimer);
  state.filterTimers.forEach(clearTimeout);
  state.filterTimers = [];
  if (state.motionPreferenceHandler) reducedMotion.removeEventListener("change", state.motionPreferenceHandler);
  state.motionPreferenceHandler = null;
  state.stageObserver?.disconnect();
  state.stageObserver = null;
  state.raf = 0;
  state.placeholderTimer = 0;
  state.dragging = null;
  state.wheelDelta = 0;
  state.hoverEntries.clear();
  state.keyboardMode = false;
}

function renderFromLocation() {
  const slug = location.pathname.match(/^\/t\/([^/]+)/)?.[1];
  const exact = slug ? ALL_BOOKS.find((book) => book.slug === slug) : null;
  if (exact) renderArticle(exact);
  else {
    if (slug) history.replaceState({}, "", "/");
    renderHome();
  }
}

window.addEventListener("popstate", () => {
  if (state.opening) {
    state.transitionCancelled = "navigation";
    state.bookTransition = null;
    transitionLayer.replaceChildren();
    transitionLayer.setAttribute("aria-hidden", "true");
    renderFromLocation();
    return;
  }
  const memory = state.bookTransition;
  if (!reducedMotion.matches && memory && memory.fromPath === location.pathname && document.body.dataset.page === "article") {
    returnBook(memory, location.pathname, "none").catch(renderFromLocation);
  } else renderFromLocation();
});
window.addEventListener("resize", () => document.body.dataset.page === "home" && layoutBooks());
document.addEventListener("visibilitychange", () => { state.lastFrame = performance.now(); });

function installPaperGrain() {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(512 * ratio);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const value = Math.round(255 * (1 - (Math.random() + Math.random()) / 2 * 0.07));
    pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  document.documentElement.style.setProperty("--paper-grain", `url(${canvas.toDataURL()})`);
}

document.documentElement.lang = SITE.language;
document.querySelector('meta[name="description"]')?.setAttribute("content", SITE.description);
document.querySelector('link[rel="icon"]')?.setAttribute("href", SITE.favicon);
installPaperGrain();
applyTheme();
renderFromLocation();
