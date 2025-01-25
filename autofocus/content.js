console.log('alt+tab to chrome.')
var keywordElement = document.getElementById('kw')//baidu
if(!keywordElement) keywordElement = document.getElementById('APjFqb')//google
if(!keywordElement) keywordElement = document.getElementById('chat-input')//chatgpt
if(!keywordElement) keywordElement = document.getElementById('prompt-textarea')//deepseek
if(keywordElement){
  keywordElement.focus()
}