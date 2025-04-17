chrome.commands.onCommand.addListener(function (command) {
  if (command === "search-selected-text") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        function: searchSelectedText
      });
    });
  }
});

function searchSelectedText() {
  let selectedText = window.getSelection().toString();
  let searchURL = `https://dictionary.cambridge.org/dictionary/english`;
  if (selectedText) {
    searchURL+=`/${encodeURIComponent(selectedText)}`
    window.open(searchURL, "_blank");
  } else {
    // alert("Please select text first!");
    navigator.clipboard.readText()
      .then(text => {
        searchURL+=`/${encodeURIComponent(text)}`
        window.open(searchURL, "_blank");
      })
      .catch(err => {
        console.error("无法访问剪贴板:", err);
      });
  }
}
