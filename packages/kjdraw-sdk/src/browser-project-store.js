// Generated from browser-project-store.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJFileConflictError, KJValidationError } from './errors.js';
import { openKjpPackage } from './project-package.js';
const RECOVERY_DIRECTORY = 'kjdraw-recovery-v1';
function requireKjpName(name) {
    const normalized = String(name ?? '').trim();
    if (!normalized.toLowerCase().endsWith('.kjp')) throw new KJValidationError('本地工程文件必须使用 .kjp 扩展名');
    return normalized;
}
function fileBytes(file) {
    return file.arrayBuffer().then((value)=>new Uint8Array(value));
}
function sourceBytes(source) {
    if (typeof source === 'string') return new TextEncoder().encode(source);
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}
async function sha256(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new KJValidationError('当前运行时缺少 SHA-256，不能安全检测本地文件冲突');
    const input = new Uint8Array(bytes.byteLength);
    input.set(bytes);
    const digest = new Uint8Array(await subtle.digest('SHA-256', input.buffer));
    return [
        ...digest
    ].map((value)=>value.toString(16).padStart(2, '0')).join('');
}
async function verifyHandle(handle) {
    if (!handle || handle.kind !== 'file') throw new KJValidationError('没有有效的本地工程文件句柄');
    requireKjpName(handle.name);
    return handle;
}
async function permission(handle, mode = 'readwrite') {
    const options = {
        mode
    };
    if (await handle.queryPermission?.(options) === 'granted') return true;
    return await handle.requestPermission?.(options) === 'granted';
}
async function recoveryRoot() {
    const navigatorWithDirectory = globalThis.navigator;
    const getDirectory = navigatorWithDirectory?.storage?.getDirectory;
    if (!getDirectory) throw new KJValidationError('当前运行时不支持本地崩溃恢复存储');
    const root = await getDirectory.call(navigatorWithDirectory.storage);
    return root.getDirectoryHandle(RECOVERY_DIRECTORY, {
        create: true
    });
}
function recoveryName(projectId) {
    const safe = String(projectId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    if (!safe) throw new KJValidationError('恢复副本需要工程 id');
    return `${safe}.kjp`;
}
function errorName(error) {
    return error instanceof Error ? error.name : null;
}
export class BrowserKjpFileBinding {
    #baselineSha256 = null;
    handle;
    constructor(handle = null){
        this.handle = handle;
    }
    static supported() {
        const browser = globalThis;
        return typeof browser.showOpenFilePicker === 'function' && typeof browser.showSaveFilePicker === 'function';
    }
    static async chooseOpen(options = {}) {
        const picker = globalThis.showOpenFilePicker;
        if (!this.supported() || !picker) throw new KJValidationError('当前浏览器不能绑定本地工程文件，请使用 KJDraw 桌面版或 Chromium 内核');
        const [handle] = await picker({
            multiple: false,
            types: [
                {
                    description: 'KJDraw 本地工程',
                    accept: {
                        'application/vnd.kanjie.kjdraw-project+zip': [
                            '.kjp'
                        ]
                    }
                }
            ],
            ...options
        });
        const binding = new BrowserKjpFileBinding(await verifyHandle(handle));
        const opened = await binding.read();
        return {
            binding,
            ...opened
        };
    }
    static async chooseSave(suggestedName = '未命名工程.kjp', options = {}) {
        const picker = globalThis.showSaveFilePicker;
        if (!this.supported() || !picker) throw new KJValidationError('当前浏览器不能绑定本地工程文件，请使用 KJDraw 桌面版或 Chromium 内核');
        const handle = await picker({
            suggestedName: requireKjpName(suggestedName),
            types: [
                {
                    description: 'KJDraw 本地工程',
                    accept: {
                        'application/vnd.kanjie.kjdraw-project+zip': [
                            '.kjp'
                        ]
                    }
                }
            ],
            ...options
        });
        return new BrowserKjpFileBinding(await verifyHandle(handle));
    }
    get bound() {
        return Boolean(this.handle);
    }
    get name() {
        return this.handle?.name ?? '';
    }
    async read() {
        const handle = await verifyHandle(this.handle);
        if (!await permission(handle, 'read')) throw new KJValidationError('没有读取本地工程文件的权限');
        const data = await fileBytes(await handle.getFile());
        const project = await openKjpPackage(data);
        this.#baselineSha256 = await sha256(data);
        return {
            data,
            project,
            name: handle.name
        };
    }
    async write(data) {
        const handle = await verifyHandle(this.handle);
        if (!await permission(handle, 'readwrite')) throw new KJValidationError('没有写入本地工程文件的权限');
        const expectedProject = await openKjpPackage(data);
        const expectedSha256 = await sha256(sourceBytes(data));
        if (this.#baselineSha256) {
            const current = await fileBytes(await handle.getFile());
            const actualSha256 = await sha256(current);
            if (actualSha256 !== this.#baselineSha256) throw new KJFileConflictError(this.#baselineSha256, actualSha256, {
                name: handle.name,
                phase: 'before-write'
            });
        }
        const writable = await handle.createWritable({
            keepExistingData: false
        });
        try {
            await writable.write(data);
            await writable.close();
        } catch (error) {
            await writable.abort?.().catch(()=>undefined);
            throw error;
        }
        const committed = await fileBytes(await handle.getFile());
        const committedSha256 = await sha256(committed);
        if (committedSha256 !== expectedSha256) throw new KJFileConflictError(expectedSha256, committedSha256, {
            name: handle.name,
            phase: 'after-write'
        });
        const reopened = await openKjpPackage(committed);
        this.#baselineSha256 = committedSha256;
        return {
            name: handle.name,
            bytes: committed.byteLength,
            manifest: reopened.manifest ?? expectedProject.manifest
        };
    }
    async writeRecovery(projectId, data) {
        await openKjpPackage(data);
        const root = await recoveryRoot();
        const handle = await root.getFileHandle(recoveryName(projectId), {
            create: true
        });
        const writable = await handle.createWritable();
        try {
            await writable.write(data);
            await writable.close();
        } catch (error) {
            await writable.abort?.().catch(()=>undefined);
            throw error;
        }
        return {
            projectId: String(projectId),
            bytes: bytesLength(data)
        };
    }
    async inspectRecovery(projectId) {
        try {
            const root = await recoveryRoot();
            const handle = await root.getFileHandle(recoveryName(projectId));
            const data = await fileBytes(await handle.getFile());
            const project = await openKjpPackage(data);
            return {
                available: true,
                data,
                manifest: project.manifest
            };
        } catch (error) {
            if (errorName(error) === 'NotFoundError') return {
                available: false
            };
            throw error;
        }
    }
    async clearRecovery(projectId) {
        try {
            await (await recoveryRoot()).removeEntry(recoveryName(projectId));
            return true;
        } catch (error) {
            if (errorName(error) === 'NotFoundError') return false;
            throw error;
        }
    }
}
function bytesLength(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    return new TextEncoder().encode(JSON.stringify(data)).byteLength;
}
