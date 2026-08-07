chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'speed-broadcast') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) return;
    // No frameId means "every frame in the tab" - lets a cross-origin iframe
    // (e.g. an embedded YouTube player) apply the speed change to its own
    // real <video>, even though the keydown itself landed on the top frame.
    chrome.tabs.sendMessage(tabId, { type: 'speed-apply', delta: message.delta });
    return;
  }

  if (message.type !== 'yt-skip-click') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;

  const { x, y } = message;
  const target = { tabId };

  chrome.debugger.attach(target, '1.3', () => {
    if (chrome.runtime.lastError) return;

    const dispatch = (type) =>
      new Promise((resolve) => {
        chrome.debugger.sendCommand(
          target,
          'Input.dispatchMouseEvent',
          { type, x, y, button: 'left', clickCount: 1 },
          resolve
        );
      });

    dispatch('mousePressed')
      .then(() => dispatch('mouseReleased'))
      .finally(() => chrome.debugger.detach(target, () => chrome.runtime.lastError));
  });
});
