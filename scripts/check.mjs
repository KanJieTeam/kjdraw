import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const failures = []
async function walk(dir = '') {
  const paths=[]
  for(const e of await readdir(resolve(root,dir),{withFileTypes:true})){
    if(['.git','node_modules','dist','target'].includes(e.name))continue
    const p=dir?`${dir}/${e.name}`:e.name
    if(e.isSymbolicLink())failures.push(`Symbolic link is not allowed in release: ${p}`)
    else if(e.isDirectory())paths.push(...await walk(p));else paths.push(p)
  }return paths
}
const files=await walk()
for(const required of ['LICENSE','NOTICE','README.md','README.zh-CN.md','CONTRIBUTING.md','SECURITY.md','SECURITY_ARCHITECTURE.md','docs/assets/hero.svg','docs/assets/mark.svg','docs/capability-matrix.md','docs/deployment.md','docs/open-source-boundary.md','web/public/kjcore/kjcore.wasm'])if(!files.includes(required))failures.push(`Missing ${required}`)
for(const p of files){
  if(/(^|\/)(storage|server|vendor|\.env)(\/|$)|\.(mdb|accdb|docx|dwg|exe|dll|pfx|pem)$/i.test(p))failures.push(`Excluded release path: ${p}`)
  if(!['.md','.json','.js','.mjs','.rs','.toml','.yml','.html','.css','.svg'].includes(extname(p)))continue
  const text=await readFile(resolve(root,p),'utf8')
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/.test(text))failures.push(`Credential-shaped content: ${p}`)
  if(p!=='scripts/check.mjs'&&extname(p)!=='.md'&&/(?:KJDrawAssets|YTKCDrawAssets|LIZHENG_REVERSE|[A-Z]:\\product\\|\/product-ai\/tools\/kjdraw)/i.test(text))failures.push(`Downstream implementation reference in public code: ${p}`)
  if(extname(p)==='.md'){
    const links=[...text.matchAll(/\]\(([^)]+)\)/g),...text.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1])
    for(let link of links){if(/^(https?:|mailto:|#)/.test(link))continue;link=decodeURIComponent(link.split('#')[0]);if(!link)continue;const dest=resolve(root,p,'..',link);if(relative(root,dest).startsWith('..')){failures.push(`Link escapes repository: ${p} → ${link}`);continue}try{await stat(dest)}catch{failures.push(`Broken link: ${p} → ${link}`)}}
  }
}
const pkg=JSON.parse(await readFile(resolve(root,'packages/kjdraw-sdk/package.json'),'utf8'))
const rootPkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'))
if(pkg.license!=='Apache-2.0')failures.push('SDK license mismatch')
if(pkg.version!==rootPkg.version)failures.push(`Release version mismatch: root ${rootPkg.version}, SDK ${pkg.version}`)
if(pkg.dependencies && Object.keys(pkg.dependencies).length)failures.push('Review added SDK runtime dependencies and notices')
for(const path of Object.values(pkg.exports)){try{await stat(resolve(root,'packages/kjdraw-sdk',path))}catch{failures.push(`Missing SDK export: ${path}`)}}
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(`Release checks passed: ${files.length} files; local links, exports, excluded paths and credential patterns checked.`)
