const html=document.documentElement,preview=document.getElementById('preview-tab'),sourceTab=document.getElementById('source-tab'),viewport=document.getElementById('viewport'),source=document.getElementById('source')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
function language(){html.dataset.locale=locale;html.lang=locale==='zh'?'zh-CN':'en';document.getElementById('language').textContent=locale==='zh'?'EN':'中文'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);language()};language()
function tab(showSource){source.hidden=!showSource;viewport.hidden=showSource;sourceTab.classList.toggle('active',showSource);preview.classList.toggle('active',!showSource);sourceTab.setAttribute('aria-selected',String(showSource));preview.setAttribute('aria-selected',String(!showSource))}
preview.onclick=()=>tab(false)
sourceTab.onclick=async()=>{tab(true);if(source.dataset.loaded)return;try{const sourcePath=document.querySelector('main.wrap').dataset.source;const response=await fetch(new URL('../../../../'+sourcePath,location.href));if(!response.ok)throw Error('Source unavailable');source.textContent=await response.text();source.dataset.loaded='true'}catch{source.textContent=locale==='zh'?'此处无法读取源码，请打开仓库源码链接。':'Source unavailable here. Open the repository source link.'}}
document.getElementById('fullscreen').onclick=()=>document.querySelector('.workspace').requestFullscreen?.()
