var input = document.getElementById('kw')//baidu
if(!input) input = document.getElementById('APjFqb')//google
if(!input) input = document.getElementById('chat-input')//chatgpt
if(!input) input = document.getElementById('prompt-textarea')//deepseek
if(input){
  input.innerHTML = ''
  input.value=''
  input.focus()
}