import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('../', import.meta.url))
const failures = []
const publicBenchmarkReports = new Set(['docs/benchmarks/deepseek-2026-09-28.md', 'docs/benchmarks/deepseek-2026-09-29.md', 'docs/benchmarks/multi-round-editor-soak.md'])
const publicBenchmarkIndices = new Set(['docs/benchmarks/evidence/2026-09-28-deepseek-flash/README.md', 'docs/benchmarks/evidence/2026-09-29-deepseek-flash/README.md'])
const benchmarkHashes = new Map()
for (const index of publicBenchmarkIndices) {
  const content = await readFile(resolve(root, index), 'utf8')
  for (const [, name, digest] of content.matchAll(/^\| `([^`/\\]+\.zip)` \|[^\r\n]*\| `([0-9a-f]{64})` \|$/gm)) benchmarkHashes.set(`${dirname(index).replaceAll('\\', '/')}/${name}`, digest)
}
async function walk(dir = '') {
  const paths=[]
  for(const e of await readdir(resolve(root,dir),{withFileTypes:true})){
    if(['.git','.cache','node_modules','dist','target','test-results','playwright-report'].includes(e.name))continue
    const p=dir?`${dir}/${e.name}`:e.name
    if(e.isSymbolicLink())failures.push(`Symbolic link is not allowed in release: ${p}`)
    else if(e.isDirectory())paths.push(...await walk(p));else paths.push(p)
  }return paths
}
const files=await walk()
for(const required of ['LICENSE','NOTICE','README.md','README.en.md','CONTRIBUTING.md','SECURITY.md','SECURITY_ARCHITECTURE.md','docs/assets/hero.svg','docs/assets/mark.svg','docs/capability-matrix.md','docs/deployment.md','docs/open-source-boundary.md','web/public/kjcore/kjcore.wasm'])if(!files.includes(required))failures.push(`Missing ${required}`)
for(const p of files){
  if(/^docs\/product(?:\/|$)|^docs\/audits\/.*\d{4}-\d{2}-\d{2}/.test(p) || p.startsWith('docs/benchmarks/') && !publicBenchmarkReports.has(p) && !publicBenchmarkIndices.has(p) && !benchmarkHashes.has(p))failures.push(`Internal development material must remain outside the public repository: ${p}`)
  if(benchmarkHashes.has(p)){
    const bytes=await readFile(resolve(root,p))
    if(bytes.length>5_000_000 || createHash('sha256').update(bytes).digest('hex')!==benchmarkHashes.get(p))failures.push(`Public benchmark archive size or SHA-256 mismatch: ${p}`)
  }
  if(/(^|\/)(storage|server|vendor|\.env)(\/|$)|\.(mdb|accdb|docx|dwg|exe|dll|pfx|pem)$/i.test(p))failures.push(`Excluded release path: ${p}`)
  if(!['.md','.json','.js','.mjs','.ts','.tsx','.rs','.toml','.yml','.yaml','.html','.css','.svg'].includes(extname(p)))continue
  const text=await readFile(resolve(root,p),'utf8')
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/.test(text))failures.push(`Credential-shaped content: ${p}`)
  if(p!=='scripts/check.mjs'&&extname(p)!=='.md'&&/(?:KJDrawAssets|[A-Z]+DrawAssets|[A-Z]+_REVERSE|[A-Z]:\\product\\|\/product-ai\/tools\/kjdraw)/i.test(text))failures.push(`Downstream implementation reference in public code: ${p}`)
  if(extname(p)==='.md'){
    const links=[...text.matchAll(/\]\(([^)]+)\)/g),...text.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1])
    for(let link of links){if(/^(https?:|mailto:|#)/.test(link))continue;link=decodeURIComponent(link.split('#')[0]);if(!link)continue;const dest=resolve(root,p,'..',link);if(relative(root,dest).startsWith('..')){failures.push(`Link escapes repository: ${p} → ${link}`);continue}try{await stat(dest)}catch{failures.push(`Broken link: ${p} → ${link}`)}}
  }
}
for(const p of benchmarkHashes.keys())if(!files.includes(p))failures.push(`Missing public benchmark archive: ${p}`)
const pkg=JSON.parse(await readFile(resolve(root,'packages/kjdraw-sdk/package.json'),'utf8'))
const rootPkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'))
const lockfile=JSON.parse(await readFile(resolve(root,'package-lock.json'),'utf8'))
if(pkg.license!=='Apache-2.0')failures.push('SDK license mismatch')
if(pkg.version!==rootPkg.version)failures.push(`Release version mismatch: root ${rootPkg.version}, SDK ${pkg.version}`)
if(pkg.dependencies && Object.keys(pkg.dependencies).length)failures.push('Review added SDK runtime dependencies and notices')
for(const path of Object.keys(lockfile.packages??{})){
  if(path.includes('.pnpm/')||/^[A-Za-z]:[\\/]/.test(path))failures.push(`Non-portable package-lock path: ${path}`)
}
function exportTargets(value){
  if(typeof value==='string')return [value]
  if(!value||typeof value!=='object')return []
  return Object.values(value).flatMap(exportTargets)
}
for(const path of exportTargets(pkg.exports)){try{await stat(resolve(root,'packages/kjdraw-sdk',path))}catch{failures.push(`Missing SDK export: ${path}`)}}
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(`Release checks passed: ${files.length} files; local links, exports, excluded paths and credential patterns checked.`)
