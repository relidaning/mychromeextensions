chrome.commands.onCommand.addListener(function (command) {
  if (command === "search-selected-text") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        function: searchSelectedText
      });
      console.log('bg.js: excuteScript called')
    });
  }
});

function searchSelectedText() {
  console.log('function searchSelectedText executing...')
  let selectedText = window.getSelection().toString();
  if (selectedText) {
    let searchURL = `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`;
    window.open(searchURL, "_blank");
  } else {
    alert("Please select text first!");
  }
}
