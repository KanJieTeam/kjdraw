import { validateDwgProviderEndpoint } from './dwg-conversion.js'

const STORAGE_KEY = 'kjdraw.dwg-provider.v1'
const PHASES = ['validate', 'upload', 'convert', 'download', 'import']

const copy = {
  en: {
    settings: 'DWG conversion', title: 'DWG conversion service', help: 'KJDraw sends a selected DWG to this service and imports the returned editable DXF. The address stays only in this browser.',
    privacy: 'Use a provider you trust. Conversion can approximate unsupported DWG objects, fonts, references or layouts.', endpoint: 'Service URL', placeholder: 'https://your-converter.example/dwg-to-dxf', cancel: 'Cancel', save: 'Save', saveConvert: 'Save & convert', remove: 'Remove address', required: 'Configure a DWG conversion service to open this file.',
    converting: 'Converting DWG', conversionHelp: 'The current drawing remains unchanged until the converted DXF is validated and imported.', stop: 'Cancel conversion', close: 'Close', retry: 'Retry', failed: 'Conversion failed. The current drawing was not changed.',
    validate: 'Validate file', upload: 'Upload to provider', convert: 'Convert to DXF', download: 'Download result', import: 'Import editable geometry', working: 'Working', done: 'Done', waiting: 'Waiting', cancelled: 'DWG conversion cancelled. The current drawing was not changed.',
  },
  zh: {
    settings: 'DWG 转换', title: 'DWG 转换服务', help: 'KJDraw 会把所选 DWG 发送到此服务，再导入服务返回的可编辑 DXF。地址只保存在当前浏览器。',
    privacy: '请使用你信任的服务。服务不支持的 DWG 对象、字体、外部参照或布局可能产生近似。', endpoint: '服务地址', placeholder: 'https://your-converter.example/dwg-to-dxf', cancel: '取消', save: '保存', saveConvert: '保存并转换', remove: '删除地址', required: '请先配置 DWG 转换服务，再打开此文件。',
    converting: '正在转换 DWG', conversionHelp: '转换后的 DXF 完成校验并导入前，当前图纸不会被替换。', stop: '取消转换', close: '关闭', retry: '重试', failed: '转换失败，当前图纸未更改。',
    validate: '校验文件', upload: '上传到转换服务', convert: '转换为 DXF', download: '下载转换结果', import: '导入可编辑图形', working: '处理中', done: '完成', waiting: '等待', cancelled: 'DWG 转换已取消，当前图纸未更改。',
  },
}

function getSaved(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    return typeof value?.endpoint === 'string' ? value.endpoint : ''
  } catch { return '' }
}

export function createDwgSettingsUI({ locale = () => 'en', storage = globalThis.localStorage } = {}) {
  const language = () => locale() === 'zh' ? 'zh' : 'en'
  const t = key => copy[language()][key] ?? copy.en[key] ?? key
  let pendingResolve = null, pendingFile = '', controller = null, retryAction = null, history = []

  const settings = document.createElement('dialog')
  settings.id = 'dwg-provider-dialog'; settings.className = 'dwg-provider-dialog'
  settings.innerHTML = `<form method="dialog"><div class="dialog-kicker"></div><h2></h2><p class="dwg-help"></p><label><span></span><input id="dwg-provider-endpoint" name="endpoint" type="url" inputmode="url" autocomplete="url"></label><p class="dwg-privacy"></p><p class="dialog-error" role="alert" aria-live="assertive" hidden></p><div class="dialog-actions"><button value="cancel" data-action="cancel"></button><button type="button" data-action="remove"></button><button type="submit" class="dialog-primary" data-action="save"></button></div></form>`
  document.body.append(settings)
  const input = settings.querySelector('input'), error = settings.querySelector('.dialog-error'), save = settings.querySelector('[data-action="save"]')

  const progress = document.createElement('dialog')
  progress.id = 'dwg-conversion-dialog'; progress.className = 'dwg-conversion-dialog'
  progress.innerHTML = `<section><div class="dialog-kicker"></div><h2></h2><p class="dwg-file-name"></p><p class="dwg-conversion-help"></p><ol class="dwg-progress"></ol><p class="dwg-conversion-error" role="alert" aria-live="assertive" hidden></p><div class="dialog-actions"><button type="button" data-action="cancel"></button><button type="button" data-action="retry" hidden></button><button type="button" data-action="close" hidden></button></div></section>`
  document.body.append(progress)

  const localize = () => {
    settings.querySelector('.dialog-kicker').textContent=t('settings'); settings.querySelector('h2').textContent=t('title'); settings.querySelector('.dwg-help').textContent=pendingFile?`${t('required')} ${t('help')}`:t('help'); settings.querySelector('label span').textContent=t('endpoint'); input.placeholder=t('placeholder'); settings.querySelector('.dwg-privacy').textContent=t('privacy'); settings.querySelector('[data-action="cancel"]').textContent=t('cancel'); settings.querySelector('[data-action="remove"]').textContent=t('remove'); save.textContent=pendingFile?t('saveConvert'):t('save')
    progress.querySelector('.dialog-kicker').textContent=t('settings'); progress.querySelector('h2').textContent=t('converting'); progress.querySelector('.dwg-conversion-help').textContent=t('conversionHelp'); progress.querySelector('[data-action="cancel"]').textContent=t('stop'); progress.querySelector('[data-action="retry"]').textContent=t('retry'); progress.querySelector('[data-action="close"]').textContent=t('close'); renderProgress()
  }
  const renderProgress = () => {
    const current = progress.dataset.phase, failed = progress.dataset.state === 'failed'
    progress.querySelector('.dwg-progress').replaceChildren(...PHASES.map(phase => {
      const item=document.createElement('li'), index=PHASES.indexOf(phase), currentIndex=PHASES.indexOf(current), state=history.includes(phase)&&index<currentIndex?'done':phase===current&&!failed?'working':'waiting'
      item.dataset.phase=phase;item.dataset.state=state;item.innerHTML=`<span aria-hidden="true">${state==='done'?'✓':state==='working'?'●':'○'}</span><b>${t(phase)}</b><small>${t(state)}</small>`;return item
    }))
    progress.dataset.history=history.join(',')
  }
  const resolvePending = value => { const resolve=pendingResolve;pendingResolve=null;pendingFile='';resolve?.(value) }
  settings.addEventListener('cancel', event=>{event.preventDefault();settings.close();resolvePending(null)})
  settings.addEventListener('close', ()=>{if(settings.returnValue==='cancel')resolvePending(null)})
  settings.querySelector('[data-action="remove"]').onclick=()=>{try{storage?.removeItem(STORAGE_KEY)}catch{}input.value='';input.focus()}
  settings.querySelector('form').onsubmit=event=>{
    event.preventDefault();error.hidden=true
    try { const endpoint=validateDwgProviderEndpoint(input.value);storage?.setItem(STORAGE_KEY,JSON.stringify({endpoint}));settings.close('saved');resolvePending(endpoint) }
    catch(reason){error.textContent=language()==='zh'?String(reason.message).replace('DWG conversion service URL is required.','请输入 DWG 转换服务地址。').replace('Enter a valid HTTP or HTTPS service URL.','请输入有效的 HTTP 或 HTTPS 服务地址。').replace('The DWG service URL must use HTTP or HTTPS.','DWG 服务地址必须使用 HTTP 或 HTTPS。').replace('Use HTTPS for remote DWG services. HTTP is allowed only for localhost.','远程 DWG 服务必须使用 HTTPS；HTTP 仅允许 localhost、127.0.0.1 或 [::1]。').replace('Do not put credentials in the DWG service URL.','请勿把账号或密码写入 DWG 服务地址。'):reason.message;error.hidden=false;input.setAttribute('aria-invalid','true');input.focus()}
  }
  input.oninput=()=>{input.removeAttribute('aria-invalid');error.hidden=true}

  progress.addEventListener('cancel', event=>{event.preventDefault();controller?.abort();progress.close('cancelled')})
  progress.querySelector('[data-action="cancel"]').onclick=()=>{controller?.abort();progress.close('cancelled')}
  progress.querySelector('[data-action="close"]').onclick=()=>progress.close('closed')
  progress.querySelector('[data-action="retry"]').onclick=()=>{const action=retryAction;progress.close('retry');action?.()}
  document.addEventListener('kjdraw:language',localize)
  localize()

  return {
    getEndpoint(){return getSaved(storage)},
    openSettings({fileName='', requireEndpoint=false}={}){
      if(pendingResolve)resolvePending(null)
      pendingFile=requireEndpoint?String(fileName):'';input.value=getSaved(storage);error.hidden=true;input.removeAttribute('aria-invalid');localize();settings.showModal();input.focus()
      return new Promise(resolve=>{pendingResolve=resolve})
    },
    begin(fileName, abortController, retry){
      controller=abortController;retryAction=retry;history=[];progress.dataset.state='working';progress.dataset.phase='validate';progress.querySelector('.dwg-file-name').textContent=fileName;progress.querySelector('.dwg-conversion-error').hidden=true;progress.querySelector('[data-action="cancel"]').hidden=false;progress.querySelector('[data-action="retry"]').hidden=true;progress.querySelector('[data-action="close"]').hidden=true;localize();progress.showModal()
    },
    phase(value){if(!PHASES.includes(value))return;if(!history.includes(value))history.push(value);progress.dataset.phase=value;renderProgress()},
    complete(){progress.dataset.state='done';progress.dataset.phase='';renderProgress();if(progress.open)progress.close('done');controller=null;retryAction=null},
    fail(reason){progress.dataset.state='failed';const alert=progress.querySelector('.dwg-conversion-error');alert.textContent=`${t('failed')} ${String(reason?.message??reason)}`;alert.hidden=false;progress.querySelector('[data-action="cancel"]').hidden=true;progress.querySelector('[data-action="retry"]').hidden=false;progress.querySelector('[data-action="close"]').hidden=false;renderProgress();controller=null},
    cancelledMessage(){return t('cancelled')},
  }
}

export { STORAGE_KEY as DWG_PROVIDER_STORAGE_KEY }
