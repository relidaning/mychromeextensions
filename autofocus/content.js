var input = null
var module = null
if(!input) input = document.getElementById('kw'), module='BAIDU'//baidu
if(!input) input = document.getElementById('APjFqb'), module='GOOGLE'//google
if(!input) input = document.getElementById('chat-input'), module='CHATGPT'//chatgpt
if(!input) input = document.getElementById('prompt-textarea'), module='DEEPSEEK'//deepseek
// clear
if(module=='BAIDU' || module=='GOOGLE'){
  input.innerHTML = ''
  input.value=''
}
// focus
if(input){
  
  input.focus()
}