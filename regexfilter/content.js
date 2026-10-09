(function () {
  // Matches are painted with the CSS Custom Highlight API instead of being
  // wrapped in <mark> elements, so the page's DOM is never touched. Splitting a
  // text node detaches the node a framework (React, Vue, ...) still holds, and
  // its later updates to that text are then lost for good, even after Esc; an
  // HTML <mark> inside SVG <text> also makes the text disappear.
  const HIGHLIGHT_NAME = 'rgx-filter-hl';
  const CURRENT_NAME = 'rgx-filter-hl-current';
  const STYLE_ID = 'rgx-filter-style';

  let overlayEl = null;
  let inputEl = null;
  let counterEl = null;
  let matches = [];
  let currentIndex = -1;
  let lastSearchedPattern = null;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) {
        background-color: #ffe066;
        color: #1a1a1a;
      }
      ::highlight(${CURRENT_NAME}) {
        background-color: #ff9f1c;
        color: #1a1a1a;
      }
      #rgx-filter-overlay {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(32,32,32,0.95);
        color: #fff;
        padding: 6px 8px;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.35);
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
      }
      #rgx-filter-overlay input {
        width: 220px;
        padding: 4px 6px;
        border-radius: 4px;
        border: 1px solid #555;
        background: #111;
        color: #fff;
        outline: none;
      }
      #rgx-filter-overlay input.rgx-filter-error {
        border-color: #ff4d4f;
      }
      #rgx-filter-overlay .rgx-filter-count {
        min-width: 42px;
        text-align: center;
        color: #ccc;
      }
      #rgx-filter-overlay button {
        background: #333;
        color: #fff;
        border: 1px solid #555;
        border-radius: 4px;
        width: 24px;
        height: 24px;
        line-height: 1;
        cursor: pointer;
      }
      #rgx-filter-overlay button:hover {
        background: #444;
      }
    `;
    document.head.appendChild(style);
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') {
          return NodeFilter.FILTER_REJECT;
        }
        if (overlayEl && overlayEl.contains(parent)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function findNodeMatches(textNode, regex) {
    regex.lastIndex = 0;
    // StaticRange, not Range: every live Range has to be fixed up on each DOM
    // mutation the page makes, which gets slow with thousands of matches.
    const ranges = [];
    for (const m of textNode.nodeValue.matchAll(regex)) {
      if (m[0].length === 0) continue;
      ranges.push(new StaticRange({
        startContainer: textNode,
        startOffset: m.index,
        endContainer: textNode,
        endOffset: m.index + m[0].length,
      }));
    }
    return ranges;
  }

  function clearHighlights() {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    CSS.highlights.delete(CURRENT_NAME);
    matches = [];
    currentIndex = -1;
  }

  // What mark.scrollIntoView({ block: 'center', inline: 'nearest' }) did, for a
  // range: centre it in every scrollable ancestor, innermost first, then in the
  // viewport.
  function scrollToMatch(match) {
    const range = document.createRange();
    try {
      range.setStart(match.startContainer, match.startOffset);
      range.setEnd(match.endContainer, match.endOffset);
    } catch (e) {
      return; // the page has shortened this text since the scan
    }
    if (range.getClientRects().length === 0) return; // hidden or removed
    const scrollInto = (scroller, top, left, width, height) => {
      const rect = range.getBoundingClientRect();
      const dy = rect.top + rect.height / 2 - (top + height / 2);
      let dx = 0;
      if (rect.left < left) dx = rect.left - left;
      else if (rect.right > left + width) dx = rect.right - (left + width);
      // 'instant' so a page with scroll-behavior: smooth can't leave the next
      // measurement mid-animation.
      scroller.scrollBy({ top: dy, left: dx, behavior: 'instant' });
    };
    const root = document.documentElement;
    for (let el = match.startContainer.parentElement; el && el !== root; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) continue;
      const box = el.getBoundingClientRect();
      scrollInto(el, box.top + el.clientTop, box.left + el.clientLeft, el.clientWidth, el.clientHeight);
    }
    scrollInto(window, 0, 0, root.clientWidth, root.clientHeight);
  }

  function setCurrent(index) {
    const match = matches[index];
    if (!match) {
      CSS.highlights.delete(CURRENT_NAME);
      return;
    }
    const current = new Highlight(match);
    current.priority = 1; // paint over the all-matches highlight
    CSS.highlights.set(CURRENT_NAME, current);
    scrollToMatch(match);
  }

  function updateCounter() {
    if (!counterEl) return;
    counterEl.textContent = matches.length ? `${currentIndex + 1}/${matches.length}` : '0/0';
  }

  function setInputError(hasError) {
    if (inputEl) inputEl.classList.toggle('rgx-filter-error', hasError);
  }

  function runSearch(pattern) {
    clearHighlights();
    if (!pattern) {
      setInputError(false);
      updateCounter();
      return;
    }

    let regex;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch (e) {
      setInputError(true);
      updateCounter();
      return;
    }
    setInputError(false);

    // add() one by one, not new Highlight(...matches) or push(...ranges):
    // spreading a six-figure match count overflows the call stack.
    const highlight = new Highlight();
    for (const node of collectTextNodes(document.body)) {
      for (const range of findNodeMatches(node, regex)) {
        matches.push(range);
        highlight.add(range);
      }
    }
    if (matches.length) CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    currentIndex = matches.length ? 0 : -1;
    setCurrent(currentIndex);
    updateCounter();
  }

  function goNext() {
    if (!matches.length) return;
    currentIndex = (currentIndex + 1) % matches.length;
    setCurrent(currentIndex);
    updateCounter();
  }

  function goPrev() {
    if (!matches.length) return;
    currentIndex = (currentIndex - 1 + matches.length) % matches.length;
    setCurrent(currentIndex);
    updateCounter();
  }

  function openOverlay() {
    injectStyle();

    overlayEl = document.createElement('div');
    overlayEl.id = 'rgx-filter-overlay';

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = 'Regex…';

    counterEl = document.createElement('span');
    counterEl.className = 'rgx-filter-count';
    counterEl.textContent = '0/0';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '▲';
    prevBtn.title = 'Previous (Shift+Enter)';
    prevBtn.addEventListener('click', goPrev);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '▼';
    nextBtn.title = 'Next (Enter)';
    nextBtn.addEventListener('click', goNext);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (Esc)';
    closeBtn.addEventListener('click', closeOverlay);

    overlayEl.append(inputEl, counterEl, prevBtn, nextBtn, closeBtn);
    document.body.appendChild(overlayEl);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const pattern = inputEl.value;
      if (pattern !== lastSearchedPattern) {
        lastSearchedPattern = pattern;
        runSearch(pattern);
      } else if (e.shiftKey) {
        goPrev();
      } else {
        goNext();
      }
    });

    inputEl.focus();
  }

  function closeOverlay() {
    clearHighlights();
    if (overlayEl) overlayEl.remove();
    overlayEl = null;
    inputEl = null;
    counterEl = null;
    lastSearchedPattern = null;
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (overlayEl && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeOverlay();
        return;
      }

      if (!overlayEl && event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'q') {
        const target = event.target;
        const tag = target && target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
        event.preventDefault();
        event.stopPropagation();
        openOverlay();
      }
    },
    true
  );
})();
