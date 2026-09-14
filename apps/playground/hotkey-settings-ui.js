import { KJ_DEFAULT_SNAP_APERTURE, KJ_DEFAULT_SNAP_MODES, KJ_SNAP_MODES } from '../../packages/kjdraw-sdk/src/snapping.js'
import {
  KJDRAW_HOTKEY_DEFINITIONS,
  createDefaultHotkeySettings,
  saveHotkeySettings,
  validateHotkeySettings,
} from './hotkey-settings.js'

const COPY = settings => ({ version: settings.version, bindings: Object.fromEntries(Object.entries(settings.bindings).map(([command, shortcuts]) => [command, [...shortcuts]])) })
const SNAP_LABELS = {
  endpoint:{en:'Endpoint',zh:'端点'}, midpoint:{en:'Midpoint',zh:'中点'}, center:{en:'Center',zh:'圆心'}, quadrant:{en:'Quadrant',zh:'象限点'},
  insertion:{en:'Insertion',zh:'插入点'}, node:{en:'Node',zh:'节点'}, nearest:{en:'Nearest',zh:'最近点'}, intersection:{en:'Intersection',zh:'交点'},
  perpendicular:{en:'Perpendicular',zh:'垂足'}, tangent:{en:'Tangent',zh:'切点'},
}
const TEXT = {
  en: { title:'Settings',hotkeysTab:'Keyboard shortcuts',snapsTab:'Object snaps',hotkeyHelp:'Search commands, then enter one or more aliases separated by spaces or commas. Letters and numbers only.',snapHelp:'Choose the exact geometric references used while drawing. Aperture is the pick distance around the pointer.',search:'Search commands',shortcut:'Aliases',snapModes:'Snap modes',aperture:'Aperture (pixels)',apertureHelp:'Use a value from 1 to 100 pixels.',apply:'Apply',restore:'Restore defaults',cancel:'Cancel',restored:'Default shortcuts restored.',snapRestored:'Default object snaps restored.',storage:'Could not save shortcuts in this browser.',invalid:'Use letters and numbers only.',invalidAperture:'Enter an aperture from 1 to 100 pixels.',applyFailed:'Could not update object snaps.',duplicate:'Remove the repeated alias.',conflict:shortcut=>`“${shortcut}” is also assigned to another command.` },
  zh: { title:'设置',hotkeysTab:'快捷键',snapsTab:'对象捕捉',hotkeyHelp:'搜索命令，并用空格或逗号分隔一个或多个别名。只能使用字母和数字。',snapHelp:'选择绘图时使用的精确几何参考。捕捉范围表示光标周围的拾取距离。',search:'搜索命令',shortcut:'快捷键',snapModes:'捕捉模式',aperture:'捕捉范围（像素）',apertureHelp:'请输入 1 到 100 像素。',apply:'应用',restore:'恢复默认',cancel:'取消',restored:'已恢复默认快捷键。',snapRestored:'已恢复默认对象捕捉。',storage:'无法在此浏览器中保存快捷键。',invalid:'只能使用字母和数字。',invalidAperture:'请输入 1 到 100 像素的捕捉范围。',applyFailed:'无法更新对象捕捉。',duplicate:'请删除重复快捷键。',conflict:shortcut=>`“${shortcut}”还分配给了其他命令。` },
}

export function createHotkeySettingsUI({ locale, getSettings, onApply, getSnapSettings, onApplySnap, storage = globalThis.localStorage } = {}) {
  const language = () => String(locale?.() ?? 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const L = key => TEXT[language()][key]
  const dialog=document.createElement('dialog');dialog.id='hotkey-settings-dialog';dialog.className='hotkey-settings-dialog';dialog.setAttribute('aria-labelledby','hotkey-settings-title')
  const form=document.createElement('form');form.method='dialog';form.onsubmit=event=>event.preventDefault()
  const heading=document.createElement('header'),title=document.createElement('h2'),help=document.createElement('p');title.id='hotkey-settings-title';heading.append(title,help)
  const tabs=document.createElement('div');tabs.className='settings-tabs';tabs.setAttribute('role','tablist')
  const snapTab=document.createElement('button'),hotkeyTab=document.createElement('button');snapTab.id='settings-tab-snaps';hotkeyTab.id='settings-tab-hotkeys'
  for(const [button,panel] of [[snapTab,'snap-settings-panel'],[hotkeyTab,'hotkey-settings-panel']]){button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-controls',panel)}
  tabs.append(snapTab,hotkeyTab)

  const snapPanel=document.createElement('section');snapPanel.id='snap-settings-panel';snapPanel.className='snap-settings-panel';snapPanel.setAttribute('role','tabpanel');snapPanel.setAttribute('aria-labelledby',snapTab.id)
  const modes=document.createElement('fieldset'),legend=document.createElement('legend'),modeGrid=document.createElement('div');modeGrid.className='snap-mode-grid';modes.append(legend,modeGrid)
  const snapInputs=new Map()
  for(const mode of KJ_SNAP_MODES){const label=document.createElement('label'),input=document.createElement('input'),modeText=document.createElement('span');input.type='checkbox';input.value=mode;input.dataset.snapMode=mode;label.append(input,modeText);modeGrid.append(label);snapInputs.set(mode,{input,text:modeText})}
  const apertureLabel=document.createElement('label'),apertureText=document.createElement('span'),aperture=document.createElement('input'),apertureHint=document.createElement('small');aperture.id='snap-aperture';aperture.type='number';aperture.min='1';aperture.max='100';aperture.step='1';aperture.required=true;apertureLabel.append(apertureText,aperture,apertureHint)
  snapPanel.append(modes,apertureLabel)

  const hotkeyPanel=document.createElement('section');hotkeyPanel.id='hotkey-settings-panel';hotkeyPanel.className='hotkey-settings-panel';hotkeyPanel.setAttribute('role','tabpanel');hotkeyPanel.setAttribute('aria-labelledby',hotkeyTab.id)
  const searchLabel=document.createElement('label'),searchText=document.createElement('span'),search=document.createElement('input');search.id='hotkey-search';search.type='search';search.autocomplete='off';searchLabel.append(searchText,search)
  const list=document.createElement('div');list.className='hotkey-settings-list';hotkeyPanel.append(searchLabel,list)
  const notice=document.createElement('p');notice.className='hotkey-settings-notice';notice.setAttribute('role','alert');notice.setAttribute('aria-live','assertive');notice.hidden=true
  const actions=document.createElement('footer'),restore=document.createElement('button'),cancel=document.createElement('button'),apply=document.createElement('button');restore.id='hotkey-restore';restore.type='button';cancel.id='hotkey-cancel';cancel.type='button';apply.id='hotkey-apply';apply.type='button';apply.className='dialog-primary';actions.append(restore,cancel,apply)
  form.append(heading,tabs,notice,snapPanel,hotkeyPanel,actions);dialog.append(form);document.body.append(dialog)
  let draft=createDefaultHotkeySettings(),active='snaps'

  const rows=new Map()
  for(const definition of KJDRAW_HOTKEY_DEFINITIONS){
    const row=document.createElement('label');row.className='hotkey-setting-row';row.dataset.command=definition.command
    const name=document.createElement('span'),label=document.createElement('b'),command=document.createElement('code'),input=document.createElement('input'),error=document.createElement('small')
    input.dataset.hotkeyCommand=definition.command;input.autocomplete='off';input.spellcheck=false;error.className='hotkey-row-error';error.setAttribute('role','alert');error.hidden=true
    name.append(label,command);row.append(name,input,error);list.append(row);rows.set(definition.command,{definition,row,label,command,input,error})
  }

  function selectTab(next,{focus=false}={}){active=next;const snaps=next==='snaps';snapTab.setAttribute('aria-selected',String(snaps));hotkeyTab.setAttribute('aria-selected',String(!snaps));snapTab.tabIndex=snaps?0:-1;hotkeyTab.tabIndex=snaps?-1:0;snapPanel.hidden=!snaps;hotkeyPanel.hidden=snaps;help.textContent=L(snaps?'snapHelp':'hotkeyHelp');if(focus)(snaps?snapTab:hotkeyTab).focus()}
  function localize(){
    title.textContent=L('title');snapTab.textContent=L('snapsTab');hotkeyTab.textContent=L('hotkeysTab');searchText.textContent=L('search');search.placeholder=L('search');legend.textContent=L('snapModes');apertureText.textContent=L('aperture');apertureHint.textContent=L('apertureHelp');restore.textContent=L('restore');cancel.textContent=L('cancel');apply.textContent=L('apply')
    for(const [mode,{input,text}] of snapInputs){text.textContent=SNAP_LABELS[mode][language()];input.setAttribute('aria-label',SNAP_LABELS[mode][language()])}
    for(const {definition,label,command,input} of rows.values()){label.textContent=definition.label[language()];command.textContent=definition.command;input.setAttribute('aria-label',`${definition.label[language()]} · ${L('shortcut')}`)}
    selectTab(active);filter()
  }
  function filter(){const query=search.value.trim().toLocaleLowerCase();for(const {definition,row,input} of rows.values())row.hidden=Boolean(query)&&![definition.command,definition.label.en,definition.label.zh,input.value].join(' ').toLocaleLowerCase().includes(query)}
  function read(){const settings=createDefaultHotkeySettings();for(const [command,{input}] of rows)settings.bindings[command]=input.value.split(/[\s,]+/).filter(Boolean);return settings}
  function write(settings){draft=COPY(settings);for(const [command,{input}] of rows)input.value=draft.bindings[command].join(', ');clearErrors();filter()}
  function writeSnaps(settings){const enabled=new Set(settings?.modes??KJ_DEFAULT_SNAP_MODES);for(const [mode,{input}] of snapInputs)input.checked=enabled.has(mode);aperture.value=String(settings?.aperture??KJ_DEFAULT_SNAP_APERTURE);clearErrors()}
  function clearErrors(){notice.hidden=true;notice.textContent='';aperture.removeAttribute('aria-invalid');for(const {row,input,error} of rows.values()){row.classList.remove('invalid');input.removeAttribute('aria-invalid');error.hidden=true;error.textContent=''}}
  function showNotice(value){notice.textContent=value;notice.hidden=false}
  function rowError(command,text){const item=rows.get(command);if(!item)return;item.row.classList.add('invalid');item.input.setAttribute('aria-invalid','true');item.error.hidden=false;item.error.textContent=[item.error.textContent,text].filter(Boolean).join(' ')}
  function showValidation(validation){clearErrors();for(const issue of validation.errors){if(issue.command)rowError(issue.command,issue.code==='duplicate-shortcut'?L('duplicate'):L('invalid'))}for(const conflict of validation.conflicts)for(const command of conflict.commands)rowError(command,L('conflict')(conflict.shortcut));search.value='';filter();list.querySelector('[aria-invalid="true"]')?.focus()}
  function open(){write(getSettings?.()??createDefaultHotkeySettings());writeSnaps(getSnapSettings?.()??{modes:KJ_DEFAULT_SNAP_MODES,aperture:KJ_DEFAULT_SNAP_APERTURE});search.value='';filter();selectTab('snaps');dialog.showModal();queueMicrotask(()=>snapTab.focus())}
  function close(){dialog.close('cancel')}
  search.oninput=filter;cancel.onclick=close;snapTab.onclick=()=>selectTab('snaps',{focus:true});hotkeyTab.onclick=()=>selectTab('hotkeys',{focus:true})
  for(const tab of [snapTab,hotkeyTab])tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();selectTab(active==='snaps'?'hotkeys':'snaps',{focus:true})}
  apply.onclick=async()=>{
    if(active==='snaps'){
      clearErrors();const value=Number(aperture.value)
      if(!Number.isFinite(value)||value<1||value>100){aperture.setAttribute('aria-invalid','true');showNotice(L('invalidAperture'));aperture.focus();return}
      apply.disabled=true
      try{await onApplySnap?.({modes:[...snapInputs].filter(([,item])=>item.input.checked).map(([mode])=>mode),aperture:value});dialog.close('apply')}
      catch(error){showNotice(error?.message||L('applyFailed'))}
      finally{apply.disabled=false}
      return
    }
    const validation=validateHotkeySettings(read());if(!validation.ok){showValidation(validation);return}
    const saved=saveHotkeySettings(validation.value,storage);if(!saved.ok){clearErrors();showNotice(L('storage'));return}
    draft=COPY(saved.value);onApply?.(COPY(saved.value));dialog.close('apply')
  }
  restore.onclick=()=>{if(active==='snaps'){writeSnaps({modes:KJ_DEFAULT_SNAP_MODES,aperture:KJ_DEFAULT_SNAP_APERTURE});showNotice(L('snapRestored'))}else{write(createDefaultHotkeySettings());showNotice(L('restored'))}}
  dialog.addEventListener('cancel',()=>{write(getSettings?.()??draft);try{writeSnaps(getSnapSettings?.())}catch{}})
  document.addEventListener('kjdraw:language',localize);localize()
  return { open, close, localize, get dialog(){return dialog} }
}
