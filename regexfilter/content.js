(function () {
  const HIGHLIGHT_CLASS = 'rgx-filter-hl';
  const CURRENT_CLASS = 'rgx-filter-hl-current';
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
      mark.${HIGHLIGHT_CLASS} {
        background: #ffe066;
        color: #1a1a1a;
        border-radius: 2px;
        padding: 0;
      }
      mark.${CURRENT_CLASS} {
        background: #ff9f1c;
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

  function highlightNodeMatches(textNode, regex) {
    const text = textNode.nodeValue;
    regex.lastIndex = 0;
    const found = [...text.matchAll(regex)];
    if (found.length === 0) return [];

    const frag = document.createDocumentFragment();
    const marks = [];
    let lastEnd = 0;
    for (const m of found) {
      if (m[0].length === 0) continue;
      if (m.index > lastEnd) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd, m.index)));
      }
      const mark = document.createElement('mark');
      mark.className = HIGHLIGHT_CLASS;
      mark.textContent = m[0];
      frag.appendChild(mark);
      marks.push(mark);
      lastEnd = m.index + m[0].length;
    }
    if (marks.length === 0) return [];
    if (lastEnd < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastEnd)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
    return marks;
  }

  function clearHighlights() {
    document.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    matches = [];
    currentIndex = -1;
  }

  function setCurrent(index) {
    matches.forEach((m, i) => m.classList.toggle(CURRENT_CLASS, i === index));
    if (index >= 0 && matches[index]) {
      matches[index].scrollIntoView({ block: 'center', inline: 'nearest' });
    }
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

    for (const node of collectTextNodes(document.body)) {
      const marks = highlightNodeMatches(node, regex);
      if (marks.length) matches.push(...marks);
    }
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
