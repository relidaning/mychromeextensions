const OBSIDIAN_TOKEN = '442a69dc9bc2d9d1ebbe41219ed2cbbea7f90679f43fa65c8212a7e98fa72a34';
const OBSIDIAN_URL = 'http://127.0.0.1:27123';
// A request that never answers would hold up every save queued behind it, and
// the service worker is killed after ~30s without ever showing a toast.
const OBSIDIAN_TIMEOUT_MS = 8000;

chrome.commands.onCommand.addListener(function (command) {
  if (command === "record-selected-text") {
    chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
      if (!tabs[0]) return;
      // executeScript rejects on pages we can't inject into (chrome://, the Web
      // Store, the PDF viewer); there is nothing to record or toast on there.
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => window.getSelection().toString()
        });
        const text = results[0]?.result?.trim();
        if (!text) return;
        const ok = await recordToObsidian(text);
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: showToast,
          args: [ok
            ? `Recorded: "${text.length > 60 ? text.slice(0, 60) + '…' : text}"`
            : 'Failed to reach Obsidian']
        });
      } catch (e) {}
    });
    return;
  }

  const suffixMap = {
    "search-selected-text": " meaning",
    "search-selected-text-chinese": " 中文"
  };
  const suffix = suffixMap[command];
  if (suffix) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: searchWithSuffix,
        args: [suffix]
      }).catch(() => {});
    });
  }
});

// Saving is GET-then-PUT of the whole month, so two saves that overlap would
// both read the same file and the second PUT would drop the first entry. Run
// them one after another.
let saveQueue = Promise.resolve();

function recordToObsidian(text) {
  const result = saveQueue.then(() => saveToObsidian(text));
  saveQueue = result.catch(() => {});
  return result;
}

async function saveToObsidian(text) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const filePath = `0_lidaning/Diaries/${year}/${year}-${month}.md`;

  const authHeader = { 'Authorization': `Bearer ${OBSIDIAN_TOKEN}` };
  const dateHeading = dateStr;
  const newEntry = `- ${timeStr} ${text}`;

  // Only a 404 means "no diary for this month yet". Any other failure (Obsidian
  // closed, auth error, 5xx) must abort: the PUT below replaces the whole file,
  // so treating it as empty would wipe the month's diary down to one entry.
  let existing = null;
  try {
    const resp = await fetch(`${OBSIDIAN_URL}/vault/${filePath}`, {
      headers: authHeader,
      signal: AbortSignal.timeout(OBSIDIAN_TIMEOUT_MS)
    });
    if (resp.ok) existing = await resp.text();
    else if (resp.status !== 404) return false;
  } catch (e) {
    return false;
  }

  const newContent = buildContent(existing, dateHeading, newEntry);

  try {
    const resp = await fetch(`${OBSIDIAN_URL}/vault/${filePath}`, {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'text/markdown' },
      body: newContent,
      signal: AbortSignal.timeout(OBSIDIAN_TIMEOUT_MS)
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

function buildContent(existing, dateHeading, newEntry) {
  if (!existing) {
    return `${dateHeading}\n\n${newEntry}\n`;
  }

  // A heading is a line that is just the date, or a markdown heading ending in
  // it ("### 2026-10-05"). Matching the date anywhere would also hit an entry
  // that merely mentions it and file the new entry under the wrong day.
  const heading = existing.match(new RegExp(`^(#{1,6} .*)?${dateHeading}[ \\t\\r]*$`, 'm'));
  if (!heading) {
    // No section for today yet — append at end
    return existing.trimEnd() + '\n\n' + dateHeading + '\n\n' + newEntry + '\n';
  }

  // Find where this date's section ends (next date heading or EOF)
  const afterHeading = heading.index + heading[0].length;
  const tail = existing.slice(afterHeading);
  const nextMatch = tail.search(/\n(#{1,6} .*)?\d{4}-\d{2}-\d{2}[ \t\r]*(\n|$)/);

  if (nextMatch === -1) {
    return existing.trimEnd() + '\n' + newEntry + '\n';
  }
  const splitAt = afterHeading + nextMatch;
  return existing.slice(0, splitAt).trimEnd() + '\n' + newEntry + '\n\n' + existing.slice(splitAt + 1);
}

function showToast(message) {
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    background: 'rgba(24,24,24,0.93)',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: '1.5',
    zIndex: '2147483647',
    maxWidth: '340px',
    boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
    opacity: '1',
    transition: 'opacity 0.4s ease',
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1800);
  setTimeout(() => el.remove(), 2300);
}

function searchWithSuffix(suffix) {
  let selectedText = window.getSelection().toString();
  const searchURL = `https://www.google.com/search?q=`;
  if (selectedText) {
    window.open(searchURL + encodeURIComponent(selectedText + suffix), "_blank");
  } else {
    navigator.clipboard.readText()
      .then(text => {
        window.open(searchURL + encodeURIComponent(text + suffix), "_blank");
      })
      .catch(err => {
        console.error("无法访问剪贴板:", err);
      });
  }
}
