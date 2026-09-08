#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import {
  KJDRAW_VERSION,
  createKJDrawSDK,
  createKjpPackage,
  openKjpPackage,
} from '../src/index.js'

const HELP = `KJDraw ${KJDRAW_VERSION}

Headless CAD document tools

Usage:
  kjdraw inspect <drawing.kjd|drawing.dxf|project.kjp>
  kjdraw validate <drawing.kjd|drawing.dxf|project.kjp>
  kjdraw convert <input> <output.kjd|output.dxf|output.kjp> [--dxf-version 2018]
  kjdraw --version

All commands run locally. No drawing data is uploaded.`

const SOURCE_LIMITS = Object.freeze({ '.kjd': 64 * 1024 ** 2, '.dxf': 64 * 1024 ** 2, '.kjp': 512 * 1024 ** 2 })

function extension(path) {
  const value = extname(path).toLowerCase()
  if (!Object.hasOwn(SOURCE_LIMITS, value)) throw new Error(`Unsupported CAD file extension: ${value || '<none>'}`)
  return value
}

async function readBounded(path) {
  const absolute = resolve(path)
  const suffix = extension(absolute)
  const info = await stat(absolute)
  const maximum = SOURCE_LIMITS[suffix]
  if (!info.isFile()) throw new Error(`Input is not a file: ${absolute}`)
  if (info.size > maximum) throw new Error(`Input exceeds the ${Math.round(maximum / 1024 ** 2)} MiB ${suffix.slice(1).toUpperCase()} limit`)
  return { absolute, suffix, bytes: new Uint8Array(await readFile(absolute)) }
}

function decodeText(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

async function openInput(path) {
  const source = await readBounded(path)
  if (source.suffix === '.kjp') {
    const project = await openKjpPackage(source.bytes)
    return { ...source, document: project.activeDocument, project }
  }
  const sdk = createKJDrawSDK()
  const format = source.suffix === '.dxf' ? 'DXF' : 'KJD'
  const document = await sdk.readDocument(decodeText(source.bytes), { format })
  return { ...source, document, project: null }
}

function frequencies(values) {
  const output = {}
  for (const value of values) output[value] = (output[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function summary(opened) {
  const document = opened.document
  const snapshot = document.snapshot()
  const objects = document.listObjects({ includeErased: true })
  const entities = document.listEntities({ includeErased: true })
  return {
    valid: true,
    sdkVersion: KJDRAW_VERSION,
    source: opened.absolute,
    format: opened.suffix.slice(1).toUpperCase(),
    bytes: opened.bytes.byteLength,
    project: opened.project ? {
      id: opened.project.manifest.projectId,
      title: opened.project.manifest.title,
      drawings: opened.project.drawings.size,
      activeDrawing: opened.project.manifest.activeDrawing,
    } : null,
    document: {
      id: document.id,
      title: snapshot.title,
      revision: document.revision,
      schemaVersion: document.schemaVersion,
      units: snapshot.header.units,
      objects: objects.length,
      entities: entities.length,
      objectKinds: frequencies(objects.map(object => object.kind)),
      entityTypes: frequencies(entities.map(entity => entity.type)),
      layers: document.getTable('layers').records.length,
      fingerprint: document.fingerprint(),
    },
  }
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`)
  return value
}

async function convert(input, output, args) {
  const opened = await openInput(input)
  const outputPath = resolve(output)
  const suffix = extension(outputPath)
  let value
  if (suffix === '.kjp') {
    value = await createKjpPackage({
      projectId: opened.project?.manifest.projectId ?? `${opened.document.id}-project`,
      title: opened.project?.manifest.title ?? opened.document.snapshot().title ?? 'KJDraw project',
      activeDrawing: opened.document.id,
      drawings: { [opened.document.id]: opened.document },
      writerVersion: KJDRAW_VERSION,
    })
  } else {
    const sdk = createKJDrawSDK()
    sdk.attachDocument(opened.document)
    value = await sdk.writeDocument(opened.document, suffix === '.dxf'
      ? { format: 'DXF', version: optionValue(args, '--dxf-version', '2018') }
      : { format: 'KJD' })
  }
  await writeFile(outputPath, value)
  return { ...summary(opened), output: outputPath, outputFormat: suffix.slice(1).toUpperCase() }
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  if (args[0] === '--version' || args[0] === '-V') {
    console.log(KJDRAW_VERSION)
    return
  }
  const [command, input, output] = args
  if (command === 'inspect' || command === 'validate') {
    if (!input) throw new Error(`${command} requires an input file`)
    console.log(JSON.stringify(summary(await openInput(input)), null, 2))
    return
  }
  if (command === 'convert') {
    if (!input || !output) throw new Error('convert requires input and output files')
    console.log(JSON.stringify(await convert(input, output, args), null, 2))
    return
  }
  throw new Error(`Unknown command: ${String(command)}\n\n${HELP}`)
}

main().catch(error => {
  console.error(`KJDraw: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
