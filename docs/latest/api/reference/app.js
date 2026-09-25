const html=document.documentElement,input=document.getElementById('api-search'),modules=[...document.querySelectorAll('.api-module')],empty=document.getElementById('empty-state')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
function applyLanguage(){html.dataset.locale=locale;html.lang=locale==='zh'?'zh-CN':'en';document.getElementById('language').textContent=locale==='zh'?'EN':'中文';input.placeholder=locale==='zh'?'搜索全部包导出':'Search package exports'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);applyLanguage()}
for(const button of document.querySelectorAll('[data-copy-code]'))button.onclick=async()=>{await navigator.clipboard.writeText(button.nextElementSibling.textContent);const old=button.textContent;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.textContent=old,1200)}
for(const button of document.querySelectorAll('[data-copy-import]'))button.onclick=async()=>{await navigator.clipboard.writeText(button.dataset.copyImport);const old=button.innerHTML;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.innerHTML=old,1200)}
const toc=document.querySelector('.reference-toc'),tocTitle=document.getElementById('reference-toc-title'),tocLinks=document.getElementById('reference-toc-links')
function updateReferenceToc(){
  const visible=modules.filter(module=>!module.hidden)
  const current=visible.filter(module=>module.getBoundingClientRect().top<150).at(-1)??visible[0]
  if(!current){toc.hidden=true;return}
  toc.hidden=false
  const symbols=[...current.querySelectorAll('.api-symbol:not([hidden])')]
  const key=current.id+':'+symbols.map(symbol=>symbol.id).join(',')
  if(toc.dataset.key===key)return
  toc.dataset.key=key
  tocTitle.textContent=current.querySelector('.module-header h2')?.textContent??''
  tocLinks.replaceChildren()
  for(const symbol of symbols){
    const link=document.createElement('a')
    link.href='#'+symbol.id
    link.textContent=symbol.querySelector('h3')?.textContent??symbol.id
    tocLinks.append(link)
  }
}
let tocFrame=0
addEventListener('scroll',()=>{if(tocFrame)return;tocFrame=requestAnimationFrame(()=>{tocFrame=0;updateReferenceToc()})},{passive:true})
function search(){const terms=input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);let visible=0;for(const module of modules){let moduleVisible=0;for(const symbol of module.querySelectorAll('.api-symbol')){const show=terms.every(term=>symbol.dataset.search.includes(term));symbol.hidden=!show;if(show)moduleVisible+=1}module.hidden=moduleVisible===0;visible+=moduleVisible}empty.hidden=visible!==0;const url=new URL(location.href);if(input.value)url.searchParams.set('q',input.value);else url.searchParams.delete('q');history.replaceState(null,'',url);updateReferenceToc()}
input.value=new URL(location.href).searchParams.get('q')??'';input.addEventListener('input',search);search();window.addEventListener('keydown',event=>{if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName)){event.preventDefault();input.focus()}});applyLanguage()
