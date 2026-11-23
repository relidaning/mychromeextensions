chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'speed-broadcast' && message.type !== 'key-broadcast') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;
  if (message.type === 'key-broadcast') {
    // Seek / play-pause pressed in a frame that has no video of its own:
    // let whichever frame owns the real <video> handle it.
    chrome.tabs.sendMessage(tabId, { type: 'key-apply', action: message.action });
    return;
  }
  // No frameId means "every frame in the tab" - lets a cross-origin iframe
  // (e.g. an embedded YouTube player) apply the speed change to its own
  // real <video>, even though the keydown itself landed on the top frame.
  chrome.tabs.sendMessage(tabId, { type: 'speed-apply', delta: message.delta });
});
