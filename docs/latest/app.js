const html=document.documentElement
const docsRoot=html.dataset.docsRoot||'./'
const docsBase=new URL(docsRoot,location.href)
const searchRevision="06bbb8ef61d9ccd6"
const languageButton=document.getElementById('language')
const searchButton=document.getElementById('search-button')
const dialog=document.getElementById('search-dialog')
const input=document.getElementById('search')
const results=document.getElementById('results')
const sidebar=document.getElementById('sidebar')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
let guideEntries=[]
let apiEntries=[]
let indexesPending=2
let searchReturnFocus=null
function updateSearchStats(){const stats=document.getElementById('search-stats');if(!stats)return;stats.textContent=locale==='zh'?'指南、Editor API 与完整类型参考':'Guides, Editor API and complete type reference'}
function applyLanguage(){
  html.dataset.locale=locale
  html.lang=locale==='zh'?'zh-CN':'en'
  languageButton.textContent=locale==='zh'?'EN':'中文'
  input.placeholder=locale==='zh'?'搜索 KJDraw 指南与 API':'Search KJDraw guides and API'
  const option=document.querySelector('#docs-version option')
  if(option)option.textContent=option.textContent.replace(/ · (?:current|当前)$/,locale==='zh'?' · 当前':' · current')
  updateSearchStats()
}
function normalizeGuide(entry){return{...entry,href:new URL(entry.href,docsBase).href}}
function normalizeApi(entry){return{...entry,kind:'api',locale:null,title:entry.name,summary:entry.module+' · '+entry.kind,href:new URL(entry.href,docsBase).href,text:entry.summary}}
function score(entry,query){const haystack=(entry.title+' '+entry.summary+' '+entry.text).toLowerCase();if(entry.title.toLowerCase()===query)return 100;if(entry.title.toLowerCase().startsWith(query))return 80;if(entry.title.toLowerCase().includes(query))return 60;return haystack.includes(query)?20:0}
function renderSearch(){
  const query=input.value.trim().toLowerCase()
  const entries=[...guideEntries.filter(entry=>entry.locale===locale),...apiEntries]
  const matches=entries.map(entry=>({entry,rank:query?score(entry,query):entry.kind==='guide'?10:1})).filter(row=>row.rank>0).sort((a,b)=>b.rank-a.rank||a.entry.title.localeCompare(b.entry.title)).slice(0,60)
  results.replaceChildren(...matches.map(({entry})=>{
    const link=document.createElement('a');const title=document.createElement('b');const summary=document.createElement('span');const kind=document.createElement('em')
    link.href=entry.href;title.textContent=entry.title;summary.textContent=entry.summary;kind.textContent=entry.kind
    link.append(title,summary,kind);link.onclick=()=>dialog.close();return link
  }))
  if(!matches.length){const empty=document.createElement('p');empty.textContent=indexesPending?(locale==='zh'?'正在加载搜索索引…':'Loading search index…'):(locale==='zh'?'没有找到匹配结果。':'No matching documentation.');results.replaceChildren(empty)}
}
function restoreSearchFocus(){const target=searchReturnFocus;searchReturnFocus=null;if(target&&target.isConnected)target.focus()}
function closeSearch(){if(dialog.open)dialog.close();else restoreSearchFocus()}
function openSearch(){if(!dialog.open){searchReturnFocus=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:searchButton;dialog.showModal()}renderSearch();setTimeout(()=>input.focus())}
searchButton.onclick=openSearch
input.oninput=renderSearch
languageButton.onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);applyLanguage();renderSearch()}
document.getElementById('menu-button').onclick=()=>sidebar.classList.toggle('open')
for(const link of sidebar.querySelectorAll('a'))link.addEventListener('click',()=>sidebar.classList.remove('open'))
for(const button of document.querySelectorAll('.copy'))button.onclick=async()=>{await navigator.clipboard.writeText(button.nextElementSibling.textContent);const old=button.textContent;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.textContent=old,1200)}
dialog.addEventListener('close',restoreSearchFocus)
dialog.addEventListener('cancel',event=>{event.preventDefault();closeSearch()})
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.open){event.preventDefault();closeSearch();return}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch()}if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement&&document.activeElement.tagName)){event.preventDefault();openSearch()}})
if(location.hash.startsWith('#zh-'))locale='zh';if(location.hash.startsWith('#en-'))locale='en';applyLanguage()
async function fetchSearchEntries(path,label){
  let failure
  for(let attempt=0;attempt<2;attempt++){
    const url=new URL(path,docsBase);url.searchParams.set('v',searchRevision);if(attempt)url.searchParams.set('retry',String(attempt))
    try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(label+' index '+response.status);const value=await response.json();if(!Array.isArray(value.entries))throw new Error(label+' index has no entries');return value.entries}
    catch(error){failure=error;if(!attempt)await new Promise(resolve=>setTimeout(resolve,250))}
  }
  console.warn('KJDraw documentation '+label.toLowerCase()+' search is unavailable.',failure)
  return []
}
function finishIndex(){indexesPending=Math.max(0,indexesPending-1);updateSearchStats();renderSearch()}
void fetchSearchEntries('search-index.json','Guide').then(entries=>{guideEntries=entries.map(normalizeGuide);finishIndex()})
void fetchSearchEntries('api/search-index.json','API').then(entries=>{apiEntries=entries.map(normalizeApi);finishIndex()})
