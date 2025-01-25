console.log('alt+tab to chrome.')
var keywordElement = document.getElementById('kw')
if(!keywordElement) keywordElement = document.getElementById('APjFqb')
if(!keywordElement) keywordElement = document.getElementById('chat-input')
if(!keywordElement) keywordElement = document.getElementById('prompt-textarea')
if(keywordElement){
  keywordElement.focus()
}