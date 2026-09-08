// Generated from sdk.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJAgentPlanRegistry } from './agent-plans.js';
import { buildSDKCapabilityManifest } from './capabilities.js';
import { KJCommandRegistry, registerCoreCommands } from './commands.js';
import { KJDocument } from './document.js';
import { createDXFFileAdapter } from './dxf-adapter.js';
import { KJValidationError } from './errors.js';
import { KJEventBus } from './events.js';
import { KJExtensionRegistry } from './extensions.js';
import { KJFileAdapterRegistry } from './file-adapters.js';
import { createKJDFileAdapter } from './kjd-adapter.js';
import { assertPluginCompatibility, assertPluginContribution, assertPluginPermission, createPluginGrant } from './plugin-contract.js';
import { createCommandEnvelope as createProtocolCommandEnvelope, createCommandReceipt, validateCommandEnvelope } from './product-contract.js';
import { KJSelectionManager } from './selection.js';
import { findSnapCandidates } from './snapping.js';
import { KJDRAW_VERSION } from './version.js';
function isOpenDocumentInput(value) {
    return typeof value === 'string' || value !== null && typeof value === 'object';
}
function optionalProperty(key, value) {
    return value === undefined ? {} : {
        [key]: value
    };
}
export class KJDrawSDK {
    version;
    events;
    extensions;
    commands;
    fileAdapters;
    documents;
    selections;
    agentPlans;
    activeDocumentId;
    documentAuthority;
    solidAuthority;
    constructor(options = {}){
        this.version = options.version ?? KJDRAW_VERSION;
        this.events = new KJEventBus();
        this.extensions = new KJExtensionRegistry();
        this.commands = new KJCommandRegistry();
        this.fileAdapters = new KJFileAdapterRegistry();
        this.documents = new Map();
        this.selections = new Map();
        this.activeDocumentId = null;
        this.documentAuthority = options.documentAuthority ?? null;
        this.solidAuthority = options.solidAuthority ?? null;
        this.agentPlans = options.agentPlans ?? new KJAgentPlanRegistry(options.agentPlanOptions);
        registerCoreCommands(this.commands);
        if (options.registerDefaultAdapters !== false) {
            this.fileAdapters.register(createKJDFileAdapter());
            this.fileAdapters.register(createDXFFileAdapter());
        }
    }
    createDocument(options = {}) {
        return this.attachDocument(KJDocument.create(options));
    }
    openDocument(input, options = {}) {
        return this.attachDocument(KJDocument.open(input, options));
    }
    attachDocument(document) {
        if (!(document instanceof KJDocument)) throw new KJValidationError('Expected a KJDocument');
        if (this.documentAuthority && !document.hasAuthoritativeBackend) {
            document.bindAuthority(this.documentAuthority.open(document.serialize()));
        }
        this.documents.set(document.id, document);
        if (!this.selections.has(document.id)) this.selections.set(document.id, new KJSelectionManager(document));
        this.activeDocumentId ??= document.id;
        this.events.emit('document:attached', {
            document
        });
        return document;
    }
    closeDocument(inputId) {
        const id = String(inputId);
        const document = this.documents.get(id);
        if (!document) return false;
        this.documents.delete(id);
        document.unbindAuthority();
        this.selections.get(id)?.dispose();
        this.selections.delete(id);
        if (this.activeDocumentId === id) this.activeDocumentId = this.documents.keys().next().value ?? null;
        this.events.emit('document:closed', {
            documentId: id
        });
        return true;
    }
    get activeDocument() {
        return this.activeDocumentId === null ? null : this.documents.get(this.activeDocumentId) ?? null;
    }
    get activeSelection() {
        return this.activeDocumentId === null ? null : this.selections.get(this.activeDocumentId)?.active ?? null;
    }
    getSelectionManager(documentId = this.activeDocumentId) {
        return documentId === null ? null : this.selections.get(String(documentId)) ?? null;
    }
    setDocumentAuthority(authority) {
        if (!authority || authority.authoritative !== true || typeof authority.open !== 'function') {
            throw new KJValidationError('An authoritative document provider is required');
        }
        const newlyBound = [];
        try {
            for (const document of this.documents.values()){
                if (document.hasAuthoritativeBackend) continue;
                document.bindAuthority(authority.open(document.serialize()));
                newlyBound.push(document);
            }
            this.documentAuthority = authority;
            this.events.emit('document:authority-ready', {
                authority,
                documentIds: [
                    ...this.documents.keys()
                ]
            });
            return authority;
        } catch (error) {
            for (const document of newlyBound.reverse())document.unbindAuthority();
            throw error;
        }
    }
    setSolidAuthority(authority) {
        if (!authority || authority.authoritative !== true || typeof authority.openMesh !== 'function' || typeof authority.box !== 'function') {
            throw new KJValidationError('An authoritative KJCore solid provider is required');
        }
        this.solidAuthority = authority;
        this.events.emit('solid:authority-ready', {
            authority
        });
        return authority;
    }
    setActiveDocument(inputId) {
        const id = String(inputId);
        const document = this.documents.get(id);
        if (!document) throw new KJValidationError(`Document is not attached: ${id}`);
        this.activeDocumentId = id;
        this.events.emit('document:active-changed', {
            documentId: id
        });
        return document;
    }
    executeCommand(idOrEnvelope, argsOrOptions = {}, options = {}) {
        if (typeof idOrEnvelope !== 'string') {
            return this.executeCommandEnvelope(idOrEnvelope, argsOrOptions);
        }
        const args = argsOrOptions;
        const document = options.document ?? this.activeDocument;
        const context = {
            sdk: this,
            events: this.events,
            extensions: this.extensions,
            ...optionalProperty('document', document ?? undefined),
            ...optionalProperty('author', options.author),
            ...optionalProperty('expectedRevision', options.expectedRevision),
            ...optionalProperty('commandEnvelope', options.commandEnvelope)
        };
        return this.commands.execute(idOrEnvelope, context, args);
    }
    createCommandEnvelope(command, args = {}, options = {}) {
        const { document: optionDocument, ...envelopeOptions } = options;
        const document = optionDocument ?? this.activeDocument;
        const documentId = options.documentId ?? document?.id;
        return createProtocolCommandEnvelope(command, args, {
            ...envelopeOptions,
            ...optionalProperty('documentId', documentId)
        });
    }
    async executeCommandEnvelope(input, options = {}) {
        const envelope = validateCommandEnvelope(input);
        const document = options.document ?? this.documents.get(envelope.documentId);
        if (!document) throw new KJValidationError(`Command document is not attached: ${envelope.documentId}`);
        if (document.id !== envelope.documentId) throw new KJValidationError(`Command document mismatch: ${envelope.documentId}`);
        const beforeRevision = document.revision;
        if (envelope.mode === 'plan') {
            const plan = envelope.origin.kind === 'ai' ? await this.agentPlans.register(envelope, document, options.agentPlanOptions) : null;
            const receipt = createCommandReceipt(envelope, {
                status: 'planned',
                beforeRevision,
                afterRevision: beforeRevision,
                result: plan
            });
            this.events.emit('command:planned', {
                envelope,
                receipt,
                document,
                plan
            });
            return receipt;
        }
        const agentPlan = envelope.origin.kind === 'ai' ? await this.agentPlans.consume(envelope, document) : null;
        this.events.emit('command:before-execute', {
            envelope,
            document,
            beforeRevision,
            agentPlan
        });
        try {
            const result = await this.executeCommand(envelope.command, envelope.arguments, {
                ...options,
                document,
                ...optionalProperty('expectedRevision', envelope.expectedRevision ?? undefined),
                commandEnvelope: envelope
            });
            const receipt = createCommandReceipt(envelope, {
                status: 'committed',
                beforeRevision,
                afterRevision: document.revision,
                result
            });
            this.events.emit('command:committed', {
                envelope,
                receipt,
                document
            });
            return receipt;
        } catch (error) {
            this.events.emit('command:failed', {
                envelope,
                document,
                beforeRevision,
                afterRevision: document.revision,
                error
            });
            throw error;
        }
    }
    snap(cursor, options = {}) {
        const document = options.document ?? this.activeDocument;
        if (!document) throw new KJValidationError('Snap requires an active KJDocument');
        const { document: _document, ...snapOptions } = options;
        return findSnapCandidates(document, cursor, snapOptions);
    }
    async readDocument(source, options = {}) {
        const result = await this.fileAdapters.read(source, options);
        if (result instanceof KJDocument) return this.attachDocument(result);
        if (!isOpenDocumentInput(result)) throw new KJValidationError('File adapter did not return a KJDocument-compatible value');
        return this.attachDocument(KJDocument.open(result, options));
    }
    writeDocument(document = this.activeDocument, options = {}) {
        if (!(document instanceof KJDocument)) throw new KJValidationError('Expected a KJDocument');
        return this.fileAdapters.write(document, options);
    }
    capabilities() {
        return buildSDKCapabilityManifest(this);
    }
    createPluginScope(manifestInput, { grantedPermissions = [] } = {}) {
        const manifest = assertPluginCompatibility(manifestInput, {
            sdkVersion: this.version
        });
        const grant = createPluginGrant(manifest, grantedPermissions);
        const owner = manifest.id;
        const disposers = [];
        const track = (dispose)=>{
            disposers.push(dispose);
            return dispose;
        };
        const authorize = (permission, kind, id)=>{
            assertPluginPermission(grant, permission);
            assertPluginContribution(manifest, kind, id);
        };
        const scope = {
            owner,
            manifest,
            registerCommand: (definition)=>{
                authorize('commands.register', 'commands', definition.id);
                return track(this.commands.register(definition, {
                    owner
                }));
            },
            registerExtension: (point, definition)=>{
                authorize('extensions.register', 'extensions', `${point}/${String(definition.id ?? '')}`);
                return track(this.extensions.register(point, definition, {
                    owner
                }));
            },
            registerFileAdapter: (definition)=>{
                authorize('file-adapters.register', 'fileAdapters', definition.id);
                return track(this.fileAdapters.register(definition));
            },
            executeCommand: (id, args = {}, commandOptions = {})=>{
                assertPluginPermission(grant, 'commands.execute');
                return this.executeCommand(id, args, commandOptions);
            },
            dispose: ()=>{
                for (const dispose of disposers.splice(0).reverse())dispose();
                this.commands.removeOwner(owner);
                this.extensions.removeOwner(owner);
            }
        };
        return Object.freeze(scope);
    }
}
export function createKJDrawSDK(options = {}) {
    return new KJDrawSDK(options);
}
