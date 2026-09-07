import { KJCommandRegistry, registerCoreCommands } from './commands.js'
import { KJDocument } from './document.js'
import { KJEventBus } from './events.js'
import { KJExtensionRegistry } from './extensions.js'
import { KJFileAdapterRegistry } from './file-adapters.js'
import { KJValidationError } from './errors.js'
import { KJSelectionManager } from './selection.js'
import { findSnapCandidates } from './snapping.js'
import { buildSDKCapabilityManifest } from './capabilities.js'
import { createKJDFileAdapter } from './kjd-adapter.js'
import { createDXFFileAdapter } from './dxf-adapter.js'
import {
  createCommandEnvelope,
  createCommandReceipt,
  validateCommandEnvelope,
} from './product-contract.js'
import {
  assertPluginCompatibility,
  assertPluginContribution,
  assertPluginPermission,
  createPluginGrant,
} from './plugin-contract.js'

export class KJDrawSDK {
  constructor(options = {}) {
    this.version = options.version ?? '0.5.0-preview.1'
    this.events = new KJEventBus()
    this.extensions = new KJExtensionRegistry()
    this.commands = new KJCommandRegistry()
    this.fileAdapters = new KJFileAdapterRegistry()
    this.documents = new Map()
    this.selections = new Map()
    this.activeDocumentId = null
    this.documentAuthority = options.documentAuthority ?? null
    this.solidAuthority = options.solidAuthority ?? null
    registerCoreCommands(this.commands)
    if (options.registerDefaultAdapters !== false) {
      this.fileAdapters.register(createKJDFileAdapter())
      this.fileAdapters.register(createDXFFileAdapter())
    }
  }

  createDocument(options = {}) { return this.attachDocument(KJDocument.create(options)) }
  openDocument(input, options = {}) { return this.attachDocument(KJDocument.open(input, options)) }

  attachDocument(document) {
    if (!(document instanceof KJDocument)) throw new KJValidationError('Expected a KJDocument')
    if (this.documentAuthority && !document.hasAuthoritativeBackend) document.bindAuthority(this.documentAuthority.open(document.serialize()))
    this.documents.set(document.id, document)
    if (!this.selections.has(document.id)) this.selections.set(document.id, new KJSelectionManager(document))
    this.activeDocumentId ??= document.id
    this.events.emit('document:attached', { document })
    return document
  }

  closeDocument(id) {
    id = String(id)
    const document = this.documents.get(id)
    if (!document) return false
    this.documents.delete(id)
    document.unbindAuthority()
    this.selections.get(id)?.dispose()
    this.selections.delete(id)
    if (this.activeDocumentId === id) this.activeDocumentId = this.documents.keys().next().value ?? null
    this.events.emit('document:closed', { documentId: id })
    return true
  }

  get activeDocument() { return this.documents.get(this.activeDocumentId) ?? null }
  get activeSelection() { return this.selections.get(this.activeDocumentId)?.active ?? null }
  getSelectionManager(documentId = this.activeDocumentId) { return this.selections.get(String(documentId)) ?? null }

  setDocumentAuthority(authority) {
    if (!authority || authority.authoritative !== true || typeof authority.open !== 'function') throw new KJValidationError('An authoritative document provider is required')
    const newlyBound = []
    try {
      for (const document of this.documents.values()) {
        if (document.hasAuthoritativeBackend) continue
        document.bindAuthority(authority.open(document.serialize()))
        newlyBound.push(document)
      }
      this.documentAuthority = authority
      this.events.emit('document:authority-ready', { authority, documentIds: [...this.documents.keys()] })
      return authority
    } catch (error) {
      for (const document of newlyBound.reverse()) document.unbindAuthority()
      throw error
    }
  }

  setSolidAuthority(authority) {
    if (!authority || authority.authoritative !== true || typeof authority.openMesh !== 'function' || typeof authority.box !== 'function') throw new KJValidationError('An authoritative KJCore solid provider is required')
    this.solidAuthority = authority
    this.events.emit('solid:authority-ready', { authority })
    return authority
  }

  setActiveDocument(id) {
    id = String(id)
    if (!this.documents.has(id)) throw new KJValidationError(`Document is not attached: ${id}`)
    this.activeDocumentId = id
    this.events.emit('document:active-changed', { documentId: id })
    return this.activeDocument
  }

  executeCommand(id, args = {}, options = {}) {
    if (id && typeof id === 'object') return this.executeCommandEnvelope(id, args)
    const document = options.document ?? this.activeDocument
    return this.commands.execute(id, {
      sdk: this,
      document,
      events: this.events,
      extensions: this.extensions,
      author: options.author,
      expectedRevision: options.expectedRevision,
      commandEnvelope: options.commandEnvelope,
    }, args)
  }

  createCommandEnvelope(command, args = {}, options = {}) {
    const document = options.document ?? this.activeDocument
    return createCommandEnvelope(command, args, {
      ...options,
      documentId: options.documentId ?? document?.id,
    })
  }

  async executeCommandEnvelope(input, options = {}) {
    const envelope = validateCommandEnvelope(input)
    const document = options.document ?? this.documents.get(envelope.documentId)
    if (!document) throw new KJValidationError(`Command document is not attached: ${envelope.documentId}`)
    if (document.id !== envelope.documentId) throw new KJValidationError(`Command document mismatch: ${envelope.documentId}`)
    const beforeRevision = document.revision
    if (envelope.mode === 'plan') {
      const receipt = createCommandReceipt(envelope, { status: 'planned', beforeRevision, afterRevision: beforeRevision })
      this.events.emit('command:planned', { envelope, receipt, document })
      return receipt
    }
    this.events.emit('command:before-execute', { envelope, document, beforeRevision })
    try {
      const result = await this.executeCommand(envelope.command, envelope.arguments, {
        ...options,
        document,
        expectedRevision: envelope.expectedRevision,
        commandEnvelope: envelope,
      })
      const receipt = createCommandReceipt(envelope, { status: 'committed', beforeRevision, afterRevision: document.revision, result })
      this.events.emit('command:committed', { envelope, receipt, document })
      return receipt
    } catch (error) {
      this.events.emit('command:failed', { envelope, document, beforeRevision, afterRevision: document.revision, error })
      throw error
    }
  }

  snap(cursor, options = {}) {
    const document = options.document ?? this.activeDocument
    return findSnapCandidates(document, cursor, options)
  }

  async readDocument(source, options = {}) {
    const result = await this.fileAdapters.read(source, options)
    return this.attachDocument(result instanceof KJDocument ? result : KJDocument.open(result, options))
  }

  writeDocument(document = this.activeDocument, options = {}) {
    if (!(document instanceof KJDocument)) throw new KJValidationError('Expected a KJDocument')
    return this.fileAdapters.write(document, options)
  }

  capabilities() { return buildSDKCapabilityManifest(this) }

  createPluginScope(manifestInput, { grantedPermissions = [] } = {}) {
    const manifest = assertPluginCompatibility(manifestInput, { sdkVersion: this.version })
    const grant = createPluginGrant(manifest, grantedPermissions)
    const owner = manifest.id
    const disposers = []
    const track = dispose => { disposers.push(dispose); return dispose }
    const register = (permission, kind, definition, work) => {
      assertPluginPermission(grant, permission)
      assertPluginContribution(manifest, kind, definition?.id)
      return track(work())
    }
    return Object.freeze({
      owner,
      manifest,
      registerCommand: definition => register('commands.register', 'commands', definition, () => this.commands.register(definition, { owner })),
      registerExtension: (point, definition) => register('extensions.register', 'extensions', { ...definition, id: `${point}/${definition?.id}` }, () => this.extensions.register(point, definition, { owner })),
      registerFileAdapter: definition => register('file-adapters.register', 'fileAdapters', definition, () => this.fileAdapters.register(definition)),
      executeCommand: (id, args, options) => { assertPluginPermission(grant, 'commands.execute'); return this.executeCommand(id, args, options) },
      dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose(); this.commands.removeOwner(owner); this.extensions.removeOwner(owner) },
    })
  }
}

export function createKJDrawSDK(options = {}) { return new KJDrawSDK(options) }
