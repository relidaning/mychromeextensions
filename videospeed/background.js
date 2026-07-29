chrome.runtime.onMessage.addListener((message, sender) => {
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
