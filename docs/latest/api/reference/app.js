const html=document.documentElement,input=document.getElementById('api-search'),modules=[...document.querySelectorAll('.api-module')],empty=document.getElementById('empty-state'),searchStatus=document.getElementById('reference-search-status')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
function applyLanguage(){html.dataset.locale=locale;html.lang=locale==='zh'?'zh-CN':'en';document.getElementById('language').textContent=locale==='zh'?'EN':'中文';input.placeholder=locale==='zh'?'搜索全部包导出':'Search package exports'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);applyLanguage()}
document.addEventListener('click',async event=>{const button=event.target.closest('[data-copy-code]');if(!button)return;await navigator.clipboard.writeText(button.nextElementSibling.textContent);const old=button.textContent;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.textContent=old,1200)})
let referencePromise
function loadReference(){
  if(!referencePromise)referencePromise=fetch('./api-reference.json').then(response=>{if(!response.ok)throw new Error('API reference unavailable');return response.json()}).then(data=>{
    const declarations=new Map(),searchText=new Map()
    for(const module of data.modules)for(const symbol of module.symbols){declarations.set(symbol.anchor,symbol.declaration);searchText.set(symbol.anchor,(symbol.name+' '+symbol.kind+' '+module.packageName+' '+symbol.declaration).toLowerCase())}
    return {declarations,searchText}
  }).catch(error=>{referencePromise=null;throw error})
  return referencePromise
}
document.addEventListener('toggle',async event=>{
  const details=event.target
  if(!details.matches?.('.symbol-declaration')||!details.open||details.dataset.loaded||details.dataset.loading)return
  details.dataset.loading='true'
  details.querySelector('.declaration-status')?.remove()
  const status=document.createElement('p')
  status.className='declaration-status'
  status.textContent=locale==='zh'?'正在加载类型声明…':'Loading type declaration…'
  details.append(status)
  try{
    const {declarations}=await loadReference()
    const declaration=declarations.get(details.dataset.symbol)
    if(!declaration)throw new Error('Declaration not found')
    const pre=document.createElement('pre')
    pre.dataset.language='ts'
    const button=document.createElement('button')
    button.className='copy'
    button.type='button'
    button.dataset.copyCode=''
    button.textContent='Copy'
    const code=document.createElement('code')
    code.textContent=declaration
    pre.append(button,code)
    status.replaceWith(pre)
    details.dataset.loaded='true'
  }catch{status.textContent=locale==='zh'?'类型声明暂时无法加载，请重试。':'Could not load declaration. Close and reopen to retry.'}
  delete details.dataset.loading
},true)
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
let searchEpoch=0
async function search(){
  const epoch=++searchEpoch
  const terms=input.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const url=new URL(location.href)
  if(input.value)url.searchParams.set('q',input.value)
  else url.searchParams.delete('q')
  history.replaceState(null,'',url)
  searchStatus.hidden=true
  let fullSearch
  if(terms.length){
    try{fullSearch=(await loadReference()).searchText}
    catch{
      if(epoch!==searchEpoch)return
      for(const module of modules){module.hidden=false;for(const symbol of module.querySelectorAll('.api-symbol'))symbol.hidden=false}
      empty.hidden=true
      searchStatus.hidden=false
      updateReferenceToc()
      return
    }
  }
  if(epoch!==searchEpoch)return
  let visible=0
  for(const module of modules){
    let moduleVisible=0
    for(const symbol of module.querySelectorAll('.api-symbol')){
      const haystack=fullSearch?.get(symbol.id)??symbol.dataset.search
      const show=terms.every(term=>haystack.includes(term))
      symbol.hidden=!show
      if(show)moduleVisible+=1
    }
    module.hidden=moduleVisible===0
    visible+=moduleVisible
  }
  empty.hidden=visible!==0
  updateReferenceToc()
}
document.getElementById('retry-reference-search').onclick=search;
input.value=new URL(location.href).searchParams.get('q')??'';input.addEventListener('input',search);search();window.addEventListener('keydown',event=>{if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName)){event.preventDefault();input.focus()}});applyLanguage()
