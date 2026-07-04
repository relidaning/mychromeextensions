const OBSIDIAN_TOKEN = '442a69dc9bc2d9d1ebbe41219ed2cbbea7f90679f43fa65c8212a7e98fa72a34';
const OBSIDIAN_URL = 'http://127.0.0.1:27123';

chrome.commands.onCommand.addListener(function (command) {
  if (command === "record-selected-text") {
    chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => window.getSelection().toString()
      });
      const text = results[0]?.result?.trim();
      if (!text) return;
      const ok = await recordToObsidian(text);
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: showToast,
        args: [ok
          ? `Recorded: "${text.length > 60 ? text.slice(0, 60) + '…' : text}"`
          : 'Failed to reach Obsidian']
      });
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
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: searchWithSuffix,
        args: [suffix]
      });
    });
  }
});

async function recordToObsidian(text) {
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

  let existing = null;
  try {
    const resp = await fetch(`${OBSIDIAN_URL}/vault/${filePath}`, { headers: authHeader });
    if (resp.ok) existing = await resp.text();
  } catch (e) {}

  const newContent = buildContent(existing, dateHeading, newEntry);

  try {
    const resp = await fetch(`${OBSIDIAN_URL}/vault/${filePath}`, {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'text/markdown' },
      body: newContent
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

  const idx = existing.indexOf(dateHeading);
  if (idx === -1) {
    // No section for today yet — append at end
    return existing.trimEnd() + '\n\n' + dateHeading + '\n\n' + newEntry + '\n';
  }

  // Find where this date's section ends (next date heading or EOF)
  const afterHeading = idx + dateHeading.length;
  const tail = existing.slice(afterHeading);
  const nextMatch = tail.search(/\n\d{4}-\d{2}-\d{2}/);

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
