const html=document.documentElement,preview=document.getElementById('preview-tab'),sourceTab=document.getElementById('source-tab'),viewport=document.getElementById('viewport'),source=document.getElementById('source')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
function language(){html.dataset.locale=locale;html.lang=locale==='zh'?'zh-CN':'en';document.getElementById('language').textContent=locale==='zh'?'EN':'中文'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);language()};language()
function tab(showSource){source.hidden=!showSource;viewport.hidden=showSource;sourceTab.classList.toggle('active',showSource);preview.classList.toggle('active',!showSource);sourceTab.setAttribute('aria-selected',String(showSource));preview.setAttribute('aria-selected',String(!showSource))}
preview.onclick=()=>tab(false)
sourceTab.onclick=async()=>{tab(true);if(source.dataset.loaded)return;try{const sourcePath=document.querySelector('main.wrap').dataset.sourceSnippet;const response=await fetch(new URL(sourcePath,location.href));if(!response.ok)throw Error('Source unavailable');source.textContent=await response.text();source.dataset.loaded='true'}catch{source.textContent=locale==='zh'?'此处无法读取源码，请打开仓库源码链接。':'Source unavailable here. Open the repository source link.'}}
const frame=viewport.querySelector('iframe'),previewStatus=document.getElementById('preview-status'),previewLoading=previewStatus.querySelector('.preview-loading'),previewFailed=previewStatus.querySelector('.preview-failed')
let pollTimer,deadlineTimer,emptyFrameTimer
function clearPreviewTimers(){clearInterval(pollTimer);clearTimeout(deadlineTimer);clearTimeout(emptyFrameTimer)}
function previewFailure(){if(previewStatus.hidden)return;clearPreviewTimers();previewStatus.dataset.state='error';previewLoading.hidden=true;previewFailed.hidden=false}
function previewReady(){clearPreviewTimers();previewStatus.hidden=true}
function checkPreview(){try{const workbench=frame.contentDocument?.querySelector('.workbench');if(workbench?.dataset.demoState==='ready'){previewReady();return}if(workbench?.dataset.lastError)previewFailure()}catch{previewFailure()}}
function watchPreview(){clearPreviewTimers();previewStatus.hidden=false;previewStatus.dataset.state='loading';previewLoading.hidden=false;previewFailed.hidden=true;pollTimer=setInterval(checkPreview,250);deadlineTimer=setTimeout(previewFailure,45000);checkPreview()}
frame.addEventListener('load',()=>{checkPreview();emptyFrameTimer=setTimeout(()=>{try{if(!previewStatus.hidden&&!frame.contentDocument?.querySelector('.workbench'))previewFailure()}catch{previewFailure()}},1500)})
frame.addEventListener('error',previewFailure)
document.getElementById('preview-retry').onclick=()=>{watchPreview();frame.src=frame.src}
watchPreview()
document.getElementById('fullscreen').onclick=()=>document.querySelector('.workspace').requestFullscreen?.()
