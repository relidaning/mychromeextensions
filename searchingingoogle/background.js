chrome.commands.onCommand.addListener(function (command) {
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
