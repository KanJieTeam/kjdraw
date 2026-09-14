import {
  KJDRAW_HOTKEY_DEFINITIONS,
  createDefaultHotkeySettings,
  saveHotkeySettings,
  validateHotkeySettings,
} from './hotkey-settings.js'

const COPY = settings => ({ version: settings.version, bindings: Object.fromEntries(Object.entries(settings.bindings).map(([command, shortcuts]) => [command, [...shortcuts]])) })
const TEXT = {
  en: { title:'Keyboard shortcuts',help:'Search commands, then enter one or more aliases separated by spaces or commas. Letters and numbers only.',search:'Search commands',shortcut:'Aliases',apply:'Apply',restore:'Restore defaults',cancel:'Cancel',restored:'Default shortcuts restored.',storage:'Could not save shortcuts in this browser.',invalid:'Use letters and numbers only.',duplicate:'Remove the repeated alias.',conflict:shortcut=>`“${shortcut}” is also assigned to another command.` },
  zh: { title:'快捷键设置',help:'搜索命令，并用空格或逗号分隔一个或多个别名。只能使用字母和数字。',search:'搜索命令',shortcut:'快捷键',apply:'应用',restore:'恢复默认',cancel:'取消',restored:'已恢复默认快捷键。',storage:'无法在此浏览器中保存快捷键。',invalid:'只能使用字母和数字。',duplicate:'请删除重复快捷键。',conflict:shortcut=>`“${shortcut}”还分配给了其他命令。` },
}

export function createHotkeySettingsUI({ locale, getSettings, onApply, storage = globalThis.localStorage } = {}) {
  const language = () => String(locale?.() ?? 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const L = key => TEXT[language()][key]
  const dialog=document.createElement('dialog');dialog.id='hotkey-settings-dialog';dialog.className='hotkey-settings-dialog';dialog.setAttribute('aria-labelledby','hotkey-settings-title')
  const form=document.createElement('form');form.method='dialog';form.onsubmit=event=>event.preventDefault()
  const heading=document.createElement('header'),title=document.createElement('h2'),help=document.createElement('p');title.id='hotkey-settings-title';heading.append(title,help)
  const searchLabel=document.createElement('label'),searchText=document.createElement('span'),search=document.createElement('input');search.id='hotkey-search';search.type='search';search.autocomplete='off';searchLabel.append(searchText,search)
  const notice=document.createElement('p');notice.className='hotkey-settings-notice';notice.setAttribute('role','alert');notice.hidden=true
  const list=document.createElement('div');list.className='hotkey-settings-list'
  const actions=document.createElement('footer'),restore=document.createElement('button'),cancel=document.createElement('button'),apply=document.createElement('button');restore.id='hotkey-restore';restore.type='button';cancel.id='hotkey-cancel';cancel.type='button';apply.id='hotkey-apply';apply.type='button';apply.className='dialog-primary';actions.append(restore,cancel,apply)
  form.append(heading,searchLabel,notice,list,actions);dialog.append(form);document.body.append(dialog)
  let draft=createDefaultHotkeySettings()

  const rows=new Map()
  for(const definition of KJDRAW_HOTKEY_DEFINITIONS){
    const row=document.createElement('label');row.className='hotkey-setting-row';row.dataset.command=definition.command
    const name=document.createElement('span'),label=document.createElement('b'),command=document.createElement('code'),input=document.createElement('input'),error=document.createElement('small')
    input.dataset.hotkeyCommand=definition.command;input.autocomplete='off';input.spellcheck=false;error.className='hotkey-row-error';error.setAttribute('role','alert');error.hidden=true
    name.append(label,command);row.append(name,input,error);list.append(row);rows.set(definition.command,{definition,row,label,command,input,error})
  }

  function localize(){
    title.textContent=L('title');help.textContent=L('help');searchText.textContent=L('search');search.placeholder=L('search');restore.textContent=L('restore');cancel.textContent=L('cancel');apply.textContent=L('apply')
    for(const {definition,label,command,input} of rows.values()){label.textContent=definition.label[language()];command.textContent=definition.command;input.setAttribute('aria-label',`${definition.label[language()]} · ${L('shortcut')}`)}
    filter()
  }
  function filter(){
    const query=search.value.trim().toLocaleLowerCase()
    for(const {definition,row,input} of rows.values())row.hidden=Boolean(query)&&![definition.command,definition.label.en,definition.label.zh,input.value].join(' ').toLocaleLowerCase().includes(query)
  }
  function read(){
    const settings=createDefaultHotkeySettings()
    for(const [command,{input}] of rows)settings.bindings[command]=input.value.split(/[\s,]+/).filter(Boolean)
    return settings
  }
  function write(settings){draft=COPY(settings);for(const [command,{input}] of rows)input.value=draft.bindings[command].join(', ');clearErrors();filter()}
  function clearErrors(){notice.hidden=true;notice.textContent='';for(const {row,input,error} of rows.values()){row.classList.remove('invalid');input.removeAttribute('aria-invalid');error.hidden=true;error.textContent=''}}
  function rowError(command,text){const item=rows.get(command);if(!item)return;item.row.classList.add('invalid');item.input.setAttribute('aria-invalid','true');item.error.hidden=false;item.error.textContent=[item.error.textContent,text].filter(Boolean).join(' ')}
  function showValidation(validation){
    clearErrors()
    for(const issue of validation.errors){if(issue.command)rowError(issue.command,issue.code==='duplicate-shortcut'?L('duplicate'):L('invalid'))}
    for(const conflict of validation.conflicts)for(const command of conflict.commands)rowError(command,L('conflict')(conflict.shortcut))
    search.value='';filter()
    const first=list.querySelector('[aria-invalid="true"]');first?.focus()
  }
  function open(){write(getSettings?.() ?? createDefaultHotkeySettings());search.value='';filter();dialog.showModal();queueMicrotask(()=>search.focus())}
  function close(){dialog.close('cancel')}
  search.oninput=filter;cancel.onclick=close
  apply.onclick=()=>{
    const validation=validateHotkeySettings(read());if(!validation.ok){showValidation(validation);return}
    const saved=saveHotkeySettings(validation.value,storage);if(!saved.ok){clearErrors();notice.textContent=L('storage');notice.hidden=false;return}
    draft=COPY(saved.value);onApply?.(COPY(saved.value));dialog.close('apply')
  }
  restore.onclick=()=>{write(createDefaultHotkeySettings());notice.textContent=L('restored');notice.hidden=false}
  dialog.addEventListener('cancel',()=>write(getSettings?.() ?? draft))
  document.addEventListener('kjdraw:language',localize);localize()
  return { open, close, localize, get dialog(){return dialog} }
}
