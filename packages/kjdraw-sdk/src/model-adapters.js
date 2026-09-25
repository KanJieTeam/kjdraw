// Generated from model-adapters.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJDrawError } from './errors.js';
import { deepFreeze } from './utils.js';
import { extractKJModelUsage } from './model-usage.js';
export class KJModelError extends KJDrawError {
    constructor(code, message){
        super(message, {
            code
        });
    }
}
function invalid(message) {
    throw new KJModelError('KJMODEL_PROTOCOL', message);
}
const CHAT_EXTENSION_KEYS = new Set([
    'thinking',
    'reasoning_effort',
    'enable_thinking',
    'tool_choice',
    'parallel_tool_calls',
    'prompt_cache_key',
    'safety_identifier'
]);
function chatExtensions(value) {
    if (value === undefined) return Object.freeze({});
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Chat request extensions must be an object');
    const input = value;
    if (Object.keys(input).some((key)=>!CHAT_EXTENSION_KEYS.has(key))) invalid('Unsupported or reserved Chat request extension');
    if (input.thinking !== undefined) {
        if (!input.thinking || typeof input.thinking !== 'object' || Array.isArray(input.thinking)) invalid('Invalid Chat thinking configuration');
        const thinking = input.thinking;
        if (Object.keys(thinking).some((key)=>![
                'type',
                'keep'
            ].includes(key)) || ![
            'enabled',
            'disabled'
        ].includes(String(thinking.type)) || thinking.keep !== undefined && thinking.keep !== null && thinking.keep !== 'all') invalid('Invalid Chat thinking configuration');
    }
    if (input.reasoning_effort !== undefined && ![
        'low',
        'high',
        'max'
    ].includes(String(input.reasoning_effort))) invalid('Invalid Chat reasoning effort');
    for (const key of [
        'enable_thinking',
        'parallel_tool_calls'
    ])if (input[key] !== undefined && typeof input[key] !== 'boolean') invalid(`Invalid Chat ${key} option`);
    if (input.tool_choice !== undefined && ![
        'auto',
        'none',
        'required'
    ].includes(String(input.tool_choice))) invalid('Invalid Chat tool choice');
    for (const key of [
        'prompt_cache_key',
        'safety_identifier'
    ])if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 256)) invalid(`Invalid Chat ${key} option`);
    return deepFreeze(jsonCopy(input, 8192));
}
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a JSON object from the model transport');
    return value;
}
function array(value) {
    if (!Array.isArray(value)) invalid('Expected a complete model response array');
    return value;
}
function identifier(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 256) invalid('Missing or invalid tool identifier');
    return value;
}
function jsonArguments(value) {
    if (typeof value !== 'string') invalid('Tool arguments must be a JSON string');
    try {
        return JSON.parse(value);
    } catch  {
        return null;
    }
}
function jsonCopy(value, budget) {
    const serialized = JSON.stringify(value);
    if (!serialized || new TextEncoder().encode(serialized).length > budget) throw new KJModelError('KJMODEL_SIZE_LIMIT', 'Model response or conversation exceeds its configured JSON byte limit');
    return JSON.parse(serialized);
}
const IMAGE_BYTES = 1048576;
function imageDimensions(width, height) {
    if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 16777216) invalid('Image dimensions exceed the supported 16-megapixel limit');
}
function imageContainer(bytes, mimeType) {
    const u16 = (offset)=>bytes[offset] * 256 + bytes[offset + 1];
    const u32 = (offset)=>bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
    if (mimeType === 'image/png') {
        if (bytes.length < 57 || ![
            137,
            80,
            78,
            71,
            13,
            10,
            26,
            10
        ].every((value, index)=>bytes[index] === value)) invalid('Image bytes do not match PNG media type');
        let offset = 8, header = false, data = false, palette = false, indexed = false;
        while(offset + 12 <= bytes.length){
            const length = u32(offset), end = offset + 12 + length;
            if (end > bytes.length) invalid('Truncated PNG image chunk');
            const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
            let crc = 0xffffffff;
            for(let i = offset + 4; i < end - 4; i++){
                crc ^= bytes[i];
                for(let bit = 0; bit < 8; bit++)crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
            }
            if ((crc ^ 0xffffffff) >>> 0 !== u32(end - 4)) invalid('PNG image checksum mismatch');
            if (!header && kind !== 'IHDR') invalid('PNG image requires an initial header');
            if (kind === 'IHDR') {
                if (header || length !== 13) invalid('Invalid PNG image header');
                imageDimensions(u32(offset + 8), u32(offset + 12));
                const depth = bytes[offset + 16], color = bytes[offset + 17], allowed = {
                    0: [
                        1,
                        2,
                        4,
                        8,
                        16
                    ],
                    2: [
                        8,
                        16
                    ],
                    3: [
                        1,
                        2,
                        4,
                        8
                    ],
                    4: [
                        8,
                        16
                    ],
                    6: [
                        8,
                        16
                    ]
                };
                if (!allowed[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) invalid('Unsupported PNG image header');
                header = true;
                indexed = color === 3;
            } else if (kind === 'PLTE') {
                if (data || !length || length % 3 || length > 768) invalid('Invalid PNG palette');
                palette = true;
            } else if (kind === 'IDAT') {
                if (indexed && !palette) invalid('Indexed PNG requires a palette');
                data ||= length > 0;
            } else if (kind === 'IEND') {
                if (length !== 0 || !data || end !== bytes.length) invalid('Invalid PNG image end');
                return;
            }
            offset = end;
        }
        invalid('PNG image is incomplete');
    }
    if (bytes.length < 16 || bytes[0] !== 255 || bytes[1] !== 216) invalid('Image bytes do not match JPEG media type');
    let offset = 2, frame = false, scan = false;
    while(offset < bytes.length){
        if (bytes[offset++] !== 255) invalid('Invalid JPEG marker');
        while(bytes[offset] === 255)offset++;
        const marker = bytes[offset++];
        if (marker === 217) {
            if (!frame || !scan || offset !== bytes.length) invalid('Invalid JPEG image end');
            return;
        }
        if (marker === undefined || marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) invalid('Invalid JPEG image structure');
        const length = u16(offset), end = offset + length;
        if (length < 2 || end > bytes.length) invalid('Truncated JPEG image segment');
        if ([
            192,
            193,
            194
        ].includes(marker)) {
            if (frame || length < 8) invalid('Invalid JPEG frame');
            imageDimensions(u16(offset + 5), u16(offset + 3));
            frame = true;
            if (length !== 8 + 3 * bytes[offset + 7]) invalid('Invalid JPEG frame components');
        }
        offset = end;
        if (marker === 218) {
            if (!frame || length < 6) invalid('JPEG scan requires a valid frame');
            scan = true;
            while(offset < bytes.length){
                if (bytes[offset] !== 255) {
                    offset++;
                    continue;
                }
                const next = bytes[offset + 1];
                if (next === 0 || next !== undefined && next >= 208 && next <= 215) {
                    offset += 2;
                    continue;
                }
                break;
            }
        }
    }
    invalid('JPEG image is incomplete');
}
function imagesForPrompt(input) {
    const descriptor = Object.getOwnPropertyDescriptor(input, 'images');
    if (!descriptor) {
        if ('images' in input) invalid('Image attachments must be explicit own properties');
        return [];
    }
    if (!('value' in descriptor) || !descriptor.enumerable) invalid('Image attachments must not use accessors or hidden fields');
    const images = descriptor.value;
    if (images === undefined) return [];
    if (!Array.isArray(images) || Object.getPrototypeOf(images) !== Array.prototype || images.length > 2 || Reflect.ownKeys(images).length !== images.length + 1) invalid('Supply at most two explicit image attachments');
    const output = [];
    for(let index = 0; index < images.length; index++){
        const entry = Object.getOwnPropertyDescriptor(images, String(index));
        if (!entry || !entry.enumerable || !('value' in entry)) invalid('Image attachment arrays must contain plain indexed values');
        const image = entry.value;
        if (!image || typeof image !== 'object' || Array.isArray(image) || ![
            Object.prototype,
            null
        ].includes(Object.getPrototypeOf(image))) invalid('Image attachment must be a plain object');
        const values = Object.create(null);
        for (const key of Reflect.ownKeys(image)){
            if (typeof key !== 'string' || ![
                'dataUrl',
                'mimeType',
                'base64'
            ].includes(key)) invalid('Unsupported image attachment field');
            const field = Object.getOwnPropertyDescriptor(image, key);
            if (!field.enumerable || !('value' in field)) invalid('Image attachment fields must not use accessors');
            values[key] = field.value;
        }
        let mimeType, base64;
        if ('dataUrl' in values) {
            if (Object.keys(values).length !== 1 || typeof values.dataUrl !== 'string' || values.dataUrl.length > 1398130) invalid('Provide one bounded PNG/JPEG data URL');
            const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(values.dataUrl);
            if (!match) invalid('Only inline base64 PNG/JPEG data URLs are allowed; external URLs are not fetched');
            mimeType = match[1];
            base64 = match[2];
        } else {
            if (Object.keys(values).length !== 2) invalid('Image attachment requires mimeType and base64');
            mimeType = values.mimeType;
            base64 = values.base64;
        }
        if (![
            'image/png',
            'image/jpeg'
        ].includes(mimeType) || typeof base64 !== 'string' || !base64.length || base64.length > 1398104 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) invalid('Invalid PNG/JPEG base64 attachment');
        let binary;
        try {
            binary = atob(base64);
        } catch  {
            return invalid('Invalid image base64 encoding');
        }
        if (binary.length > IMAGE_BYTES) throw new KJModelError('KJMODEL_SIZE_LIMIT', 'Each image attachment is limited to 1 MiB of decoded bytes');
        if (btoa(binary) !== base64) invalid('Image attachment requires canonical base64 encoding');
        imageContainer(Uint8Array.from(binary, (char)=>char.charCodeAt(0)), mimeType);
        output.push({
            mimeType: mimeType,
            base64,
            dataUrl: `data:${mimeType};base64,${base64}`
        });
    }
    return output;
}
function limit(value, fallback, maximum) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) invalid('Invalid model adapter limit');
    return resolved;
}
function notifyUsage(observer, usage) {
    try {
        void Promise.resolve(observer?.(usage)).catch(()=>{});
    } catch  {}
}
function notifyText(observer, delta) {
    if (!delta) return;
    try {
        void Promise.resolve(observer?.(delta)).catch(()=>{});
    } catch  {}
}
function isAsyncIterable(value) {
    return !!value && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';
}
function streamIndex(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) invalid(`Streaming ${label} must be a non-negative integer`);
    return value;
}
function streamRecord(value, label, budget) {
    if (++budget.events > budget.maximumEvents) throw new KJModelError('KJMODEL_SIZE_LIMIT', `Streaming ${label} exceeds its configured event limit`);
    const serialized = JSON.stringify(value);
    if (!serialized) invalid(`Streaming ${label} must be JSON serializable`);
    budget.bytes += new TextEncoder().encode(serialized).length;
    if (budget.bytes > budget.maximumBytes) throw new KJModelError('KJMODEL_SIZE_LIMIT', 'Model response or conversation exceeds its configured JSON byte limit');
    return record(JSON.parse(serialized));
}
async function* streamValues(source, signal) {
    const iterator = source[Symbol.asyncIterator]();
    let complete = false;
    try {
        while(true){
            signal.throwIfAborted();
            let rejectAbort;
            const abort = new Promise((_, reject)=>{
                rejectAbort = reject;
            });
            const onAbort = ()=>{
                try {
                    signal.throwIfAborted();
                } catch (error) {
                    rejectAbort?.(error);
                }
            };
            signal.addEventListener('abort', onAbort, {
                once: true
            });
            let result;
            try {
                result = await Promise.race([
                    Promise.resolve().then(()=>iterator.next()),
                    abort
                ]);
            } finally{
                signal.removeEventListener('abort', onAbort);
            }
            if (result.done) {
                complete = true;
                return;
            }
            yield result.value;
        }
    } finally{
        if (!complete && typeof iterator.return === 'function') {
            try {
                void Promise.resolve(iterator.return()).catch(()=>{});
            } catch  {}
        }
    }
}
async function assembleResponsesStream(source, maximumBytes, maximumEvents, signal, onTextDelta) {
    if (!isAsyncIterable(source)) invalid('Streaming Responses transport must return an async iterable of parsed JSON events');
    const texts = new Map();
    const calls = new Map();
    const budget = {
        bytes: 0,
        events: 0,
        maximumBytes,
        maximumEvents
    };
    let sequence = -1, terminal;
    for await (const rawEvent of streamValues(source, signal)){
        signal.throwIfAborted();
        const event = streamRecord(rawEvent, 'Responses event', budget), type = event.type;
        if (typeof type !== 'string') invalid('Streaming Responses event requires a type');
        const nextSequence = streamIndex(event.sequence_number, 'sequence number');
        if (nextSequence <= sequence) invalid('Streaming Responses sequence numbers must increase');
        sequence = nextSequence;
        if (terminal) invalid('Streaming Responses terminal event must be last');
        if (type === 'response.output_text.delta') {
            const itemId = identifier(event.item_id), outputIndex = streamIndex(event.output_index, 'output index'), contentIndex = streamIndex(event.content_index, 'content index');
            if (typeof event.delta !== 'string') invalid('Streaming Responses text delta must be a string');
            const key = `${itemId}:${contentIndex}`, current = texts.get(key) ?? {
                itemId,
                outputIndex,
                contentIndex,
                text: '',
                done: false
            };
            if (current.outputIndex !== outputIndex || current.done) invalid('Streaming Responses text delta changed identity or followed done');
            current.text += event.delta;
            texts.set(key, current);
            notifyText(onTextDelta, event.delta);
        } else if (type === 'response.output_text.done') {
            const itemId = identifier(event.item_id), outputIndex = streamIndex(event.output_index, 'output index'), contentIndex = streamIndex(event.content_index, 'content index');
            if (typeof event.text !== 'string') invalid('Streaming Responses final text must be a string');
            const key = `${itemId}:${contentIndex}`, current = texts.get(key) ?? {
                itemId,
                outputIndex,
                contentIndex,
                text: '',
                done: false
            };
            if (current.outputIndex !== outputIndex || current.done || current.text !== event.text) invalid('Streaming Responses final text does not match its deltas');
            current.done = true;
            texts.set(key, current);
        } else if (type === 'response.function_call_arguments.delta') {
            const itemId = identifier(event.item_id), outputIndex = streamIndex(event.output_index, 'output index');
            if (typeof event.delta !== 'string') invalid('Streaming Responses function arguments delta must be a string');
            const current = calls.get(itemId) ?? {
                itemId,
                outputIndex,
                arguments: '',
                done: false
            };
            if (current.outputIndex !== outputIndex || current.done) invalid('Streaming Responses function delta changed identity or followed done');
            current.arguments += event.delta;
            calls.set(itemId, current);
        } else if (type === 'response.function_call_arguments.done') {
            const itemId = identifier(event.item_id), outputIndex = streamIndex(event.output_index, 'output index'), name = identifier(event.name);
            if (typeof event.arguments !== 'string') invalid('Streaming Responses final function arguments must be a string');
            const current = calls.get(itemId) ?? {
                itemId,
                outputIndex,
                arguments: '',
                done: false
            };
            if (current.outputIndex !== outputIndex || current.done || current.arguments !== event.arguments) invalid('Streaming Responses final function arguments do not match their deltas');
            current.name = name;
            current.done = true;
            calls.set(itemId, current);
        } else if ([
            'response.completed',
            'response.incomplete',
            'response.failed'
        ].includes(type)) {
            terminal = record(event.response);
            const expected = type.slice('response.'.length);
            if (terminal.status !== expected) invalid('Streaming Responses terminal type and status disagree');
        } else if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
            throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request');
        } else if (type === 'error') {
            throw new KJModelError('KJMODEL_INCOMPLETE', 'Responses stream failed; no tool calls were dispatched');
        } else if (![
            'response.created',
            'response.in_progress',
            'response.output_item.added',
            'response.content_part.added',
            'response.content_part.done',
            'response.output_item.done'
        ].includes(type) && !type.startsWith('response.reasoning_')) invalid('Unsupported Responses streaming event');
    }
    if (!budget.events || !terminal) invalid('Streaming Responses response ended without a terminal event');
    const output = array(terminal.output);
    for (const current of texts.values()){
        if (!current.done) invalid('Streaming Responses text ended before done');
        const item = record(output[current.outputIndex]);
        if (item.id !== current.itemId || item.type !== 'message') invalid('Streaming Responses final text item changed identity');
        const part = record(array(item.content)[current.contentIndex]);
        if (part.type !== 'output_text' || part.text !== current.text) invalid('Streaming Responses final response text does not match deltas');
    }
    for (const current of calls.values()){
        if (!current.done) invalid('Streaming Responses function arguments ended before done');
        const item = record(output[current.outputIndex]);
        if (item.id !== current.itemId || item.type !== 'function_call' || item.name !== current.name || item.arguments !== current.arguments) invalid('Streaming Responses final function call does not match deltas');
    }
    return terminal;
}
async function assembleChatStream(source, maximumBytes, maximumEvents, signal, onTextDelta) {
    if (!isAsyncIterable(source)) invalid('Streaming Chat transport must return an async iterable of parsed JSON chunks');
    const tools = new Map();
    const budget = {
        bytes: 0,
        events: 0,
        maximumBytes,
        maximumEvents
    };
    let text = '', reasoning = '', encryptedContent, finishReason = null, usage;
    for await (const rawChunk of streamValues(source, signal)){
        signal.throwIfAborted();
        const chunk = streamRecord(rawChunk, 'Chat chunk', budget);
        if (Object.prototype.hasOwnProperty.call(chunk, 'usage') && chunk.usage !== null) {
            if (usage !== undefined) invalid('Streaming Chat response contains duplicate usage chunks');
            usage = chunk.usage;
        }
        const choices = array(chunk.choices);
        if (!choices.length) {
            if (chunk.usage === undefined || chunk.usage === null) invalid('Empty Streaming Chat choices require a usage observation');
            continue;
        }
        if (choices.length !== 1) invalid('Expected exactly one streaming model choice');
        if (finishReason !== null) invalid('Streaming Chat emitted model deltas after its finish reason');
        const choice = record(choices[0]);
        if (choice.index !== 0) invalid('Streaming Chat choice index must be zero');
        const delta = record(choice.delta);
        if (delta.role !== undefined && delta.role !== null && delta.role !== 'assistant') invalid('Expected streaming assistant deltas');
        if (delta.refusal !== undefined && delta.refusal !== null) {
            if (typeof delta.refusal !== 'string') invalid('Invalid streaming refusal');
            if (delta.refusal) throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request');
        }
        if (delta.content !== undefined && delta.content !== null) {
            if (typeof delta.content !== 'string') invalid('Only streaming text and function-call deltas are supported');
            text += delta.content;
            notifyText(onTextDelta, delta.content);
        }
        if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
            if (typeof delta.reasoning_content !== 'string') invalid('Invalid streaming reasoning content');
            reasoning += delta.reasoning_content;
        }
        if (delta.encrypted_content !== undefined && delta.encrypted_content !== null) {
            if (typeof delta.encrypted_content !== 'string' || !delta.encrypted_content || encryptedContent !== undefined) invalid('Invalid or repeated streaming encrypted reasoning content');
            encryptedContent = delta.encrypted_content;
        }
        if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
            for (const rawTool of array(delta.tool_calls)){
                const tool = record(rawTool);
                if (!Number.isSafeInteger(tool.index) || tool.index < 0 || tool.index > 15) invalid('Invalid streaming tool-call index');
                const index = tool.index;
                const current = tools.get(index) ?? {
                    name: '',
                    arguments: ''
                };
                if (tool.id !== undefined && tool.id !== null) {
                    const id = identifier(tool.id);
                    if (current.id !== undefined && current.id !== id) invalid('Streaming tool-call ID changed between chunks');
                    current.id = id;
                }
                if (tool.type !== undefined && tool.type !== null) {
                    if (tool.type !== 'function' || current.type !== undefined && current.type !== tool.type) invalid('Unsupported streaming chat tool type');
                    current.type = tool.type;
                }
                if (tool.function !== undefined && tool.function !== null) {
                    const fn = record(tool.function);
                    if (fn.name !== undefined && fn.name !== null) {
                        if (typeof fn.name !== 'string') invalid('Invalid streaming tool name fragment');
                        current.name += fn.name;
                    }
                    if (fn.arguments !== undefined && fn.arguments !== null) {
                        if (typeof fn.arguments !== 'string') invalid('Invalid streaming tool arguments fragment');
                        current.arguments += fn.arguments;
                    }
                }
                tools.set(index, current);
            }
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
    }
    signal.throwIfAborted();
    if (!budget.events || typeof finishReason !== 'string' || !finishReason) throw new KJModelError('KJMODEL_INCOMPLETE', 'Streaming Chat response ended without a finish reason');
    const indexes = [
        ...tools.keys()
    ].sort((left, right)=>left - right);
    if (indexes.some((value, index)=>value !== index)) invalid('Streaming tool-call indexes must be contiguous');
    const toolCalls = indexes.map((index)=>{
        const tool = tools.get(index);
        if (!tool.id || !tool.name) invalid('Streaming tool call is missing its ID or name');
        return {
            id: tool.id,
            type: tool.type ?? 'function',
            function: {
                name: identifier(tool.name),
                arguments: tool.arguments
            }
        };
    });
    if (finishReason === 'tool_calls' && !toolCalls.length) invalid('Chat finish reason requires tool calls');
    const message = {
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls
    };
    if (reasoning) message.reasoning_content = reasoning;
    if (encryptedContent !== undefined) message.encrypted_content = encryptedContent;
    return {
        choices: [
            {
                index: 0,
                finish_reason: finishReason,
                message
            }
        ],
        ...usage === undefined ? {} : {
            usage
        }
    };
}
async function assembleAnthropicStream(source, maximumBytes, maximumEvents, signal, onTextDelta) {
    if (!isAsyncIterable(source)) invalid('Streaming Anthropic transport must return an async iterable of parsed JSON events');
    const budget = {
        bytes: 0,
        events: 0,
        maximumBytes,
        maximumEvents
    }, blocks = new Map();
    let message, stopReason, stopSequence = null, finalUsage;
    let messageDeltas = 0, stopped = false;
    for await (const rawEvent of streamValues(source, signal)){
        signal.throwIfAborted();
        const event = streamRecord(rawEvent, 'Anthropic event', budget), type = event.type;
        if (typeof type !== 'string') invalid('Streaming Anthropic event requires a type');
        if (stopped) invalid('Streaming Anthropic message_stop must be last');
        if (type === 'ping') continue;
        if (type === 'error') throw new KJModelError('KJMODEL_INCOMPLETE', 'Anthropic stream failed; no tool calls were dispatched');
        if (type === 'message_start') {
            if (message || blocks.size || messageDeltas) invalid('Streaming Anthropic response contains duplicate or late message_start');
            message = record(event.message);
            if (message.role !== 'assistant' || array(message.content).length || message.stop_reason !== null && message.stop_reason !== undefined) invalid('Streaming Anthropic message_start is invalid');
        } else if (type === 'content_block_start') {
            if (!message || messageDeltas) invalid('Streaming Anthropic content block started outside a message');
            const index = streamIndex(event.index, 'content block index');
            if (index > 31 || blocks.has(index)) invalid('Streaming Anthropic content block index is duplicate or too large');
            const block = record(event.content_block);
            if (block.type === 'text') {
                if (typeof block.text !== 'string') invalid('Streaming Anthropic text block requires initial text');
                blocks.set(index, {
                    type: 'text',
                    text: block.text,
                    done: false
                });
                notifyText(onTextDelta, block.text);
            } else if (block.type === 'tool_use') {
                const input = record(block.input);
                blocks.set(index, {
                    type: 'tool_use',
                    id: identifier(block.id),
                    name: identifier(block.name),
                    initialInput: input,
                    arguments: '',
                    done: false
                });
            } else if (block.type === 'thinking') {
                if (typeof block.thinking !== 'string') invalid('Streaming Anthropic thinking block requires initial text');
                blocks.set(index, {
                    type: 'thinking',
                    thinking: block.thinking,
                    ...typeof block.signature === 'string' ? {
                        signature: block.signature
                    } : {},
                    done: false
                });
            } else if (block.type === 'redacted_thinking') {
                if (typeof block.data !== 'string') invalid('Streaming Anthropic redacted thinking block requires data');
                blocks.set(index, {
                    type: 'redacted_thinking',
                    data: block.data,
                    done: false
                });
            } else invalid('Unsupported streaming Anthropic content block');
        } else if (type === 'content_block_delta') {
            if (!message || messageDeltas) invalid('Streaming Anthropic content delta occurred outside content');
            const index = streamIndex(event.index, 'content block index'), block = blocks.get(index), delta = record(event.delta);
            if (!block || block.done) invalid('Streaming Anthropic content delta requires an open block');
            if (delta.type === 'text_delta' && block.type === 'text') {
                if (typeof delta.text !== 'string') invalid('Streaming Anthropic text delta must be a string');
                block.text += delta.text;
                notifyText(onTextDelta, delta.text);
            } else if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
                if (typeof delta.partial_json !== 'string') invalid('Streaming Anthropic tool arguments delta must be a string');
                block.arguments += delta.partial_json;
            } else if (delta.type === 'thinking_delta' && block.type === 'thinking') {
                if (typeof delta.thinking !== 'string') invalid('Streaming Anthropic thinking delta must be a string');
                block.thinking += delta.thinking;
            } else if (delta.type === 'signature_delta' && block.type === 'thinking') {
                if (typeof delta.signature !== 'string' || block.signature !== undefined) invalid('Streaming Anthropic signature delta is invalid or duplicate');
                block.signature = delta.signature;
            } else invalid('Streaming Anthropic delta does not match its content block');
        } else if (type === 'content_block_stop') {
            if (!message || messageDeltas) invalid('Streaming Anthropic content block stopped outside content');
            const index = streamIndex(event.index, 'content block index'), block = blocks.get(index);
            if (!block || block.done) invalid('Streaming Anthropic content block stop requires an open block');
            block.done = true;
        } else if (type === 'message_delta') {
            if (!message || [
                ...blocks.values()
            ].some((block)=>!block.done)) invalid('Streaming Anthropic message_delta requires completed content blocks');
            const delta = record(event.delta);
            if (delta.stop_reason !== undefined && delta.stop_reason !== null) stopReason = delta.stop_reason;
            if (delta.stop_sequence !== undefined) stopSequence = delta.stop_sequence;
            finalUsage = {
                ...finalUsage ?? {},
                ...record(event.usage)
            };
            messageDeltas++;
        } else if (type === 'message_stop') {
            if (!message || !messageDeltas || typeof stopReason !== 'string' || !stopReason) throw new KJModelError('KJMODEL_INCOMPLETE', 'Streaming Anthropic response ended without a stop reason');
            stopped = true;
        } else invalid('Unsupported Anthropic streaming event');
    }
    signal.throwIfAborted();
    if (!stopped || !message || !messageDeltas) invalid('Streaming Anthropic response ended without message_stop');
    const indexes = [
        ...blocks.keys()
    ].sort((left, right)=>left - right);
    if (indexes.some((value, index)=>value !== index)) invalid('Streaming Anthropic content block indexes must be contiguous');
    const content = indexes.map((index)=>{
        const block = blocks.get(index);
        if (!block.done) invalid('Streaming Anthropic content block ended before stop');
        if (block.type === 'tool_use') {
            let input = block.initialInput;
            if (block.arguments) {
                try {
                    input = JSON.parse(block.arguments);
                } catch  {
                    invalid('Streaming Anthropic tool arguments are not complete JSON');
                }
            }
            if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Streaming Anthropic tool arguments must be a JSON object');
            return {
                type: block.type,
                id: block.id,
                name: block.name,
                input
            };
        }
        if (block.type === 'thinking') {
            if (block.signature === undefined) invalid('Streaming Anthropic thinking block is missing its signature');
            return {
                type: block.type,
                thinking: block.thinking,
                signature: block.signature
            };
        }
        if (block.type === 'redacted_thinking') return {
            type: block.type,
            data: block.data
        };
        return {
            type: block.type,
            text: block.text
        };
    });
    const startUsage = message.usage === undefined ? {} : record(message.usage);
    return {
        ...message,
        role: 'assistant',
        content,
        stop_reason: stopReason,
        stop_sequence: stopSequence,
        usage: {
            ...startUsage,
            ...finalUsage
        }
    };
}
async function assembleGeminiStream(source, maximumBytes, maximumEvents, signal, onTextDelta) {
    if (!isAsyncIterable(source)) invalid('Streaming Gemini transport must return an async iterable of parsed JSON responses');
    const budget = {
        bytes: 0,
        events: 0,
        maximumBytes,
        maximumEvents
    }, parts = [];
    let finishReason, usageMetadata, modelVersion, responseId;
    for await (const rawChunk of streamValues(source, signal)){
        signal.throwIfAborted();
        const chunk = streamRecord(rawChunk, 'Gemini chunk', budget);
        if (finishReason !== undefined) invalid('Streaming Gemini emitted chunks after its finish reason');
        if (chunk.usageMetadata !== undefined) usageMetadata = record(chunk.usageMetadata);
        if (chunk.modelVersion !== undefined) {
            if (typeof chunk.modelVersion !== 'string') invalid('Streaming Gemini modelVersion must be a string');
            modelVersion = chunk.modelVersion;
        }
        if (chunk.responseId !== undefined) {
            if (typeof chunk.responseId !== 'string') invalid('Streaming Gemini responseId must be a string');
            responseId = chunk.responseId;
        }
        const candidates = array(chunk.candidates ?? []);
        if (!candidates.length) continue;
        if (candidates.length !== 1) invalid('Expected exactly one streaming Gemini candidate');
        const candidate = record(candidates[0]);
        if (candidate.index !== undefined && candidate.index !== 0) invalid('Streaming Gemini candidate index must be zero');
        if (candidate.content !== undefined) {
            const content = record(candidate.content);
            if (content.role !== undefined && content.role !== 'model') invalid('Expected streaming Gemini model content');
            for (const rawPart of array(content.parts)){
                const part = record(rawPart);
                if (part.functionCall !== undefined) {
                    const call = record(part.functionCall);
                    identifier(call.name);
                    const args = call.args ?? {};
                    if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('Streaming Gemini function arguments must be a JSON object');
                    if (call.id !== undefined) identifier(call.id);
                    parts.push(part);
                } else if (typeof part.text === 'string') {
                    if (part.thought !== undefined && part.thought !== true && part.thought !== false) invalid('Streaming Gemini thought marker must be boolean');
                    if (part.thoughtSignature !== undefined && typeof part.thoughtSignature !== 'string') invalid('Streaming Gemini thought signature must be a string');
                    parts.push(part);
                    if (part.thought !== true) notifyText(onTextDelta, part.text);
                } else invalid('Unsupported streaming Gemini part');
            }
        }
        if (candidate.finishReason !== undefined) finishReason = candidate.finishReason;
    }
    signal.throwIfAborted();
    if (!budget.events || typeof finishReason !== 'string' || !finishReason) throw new KJModelError('KJMODEL_INCOMPLETE', 'Streaming Gemini response ended without a finish reason');
    if (!parts.length) invalid('Streaming Gemini response returned no content');
    return {
        candidates: [
            {
                index: 0,
                finishReason,
                content: {
                    role: 'model',
                    parts
                }
            }
        ],
        ...usageMetadata === undefined ? {} : {
            usageMetadata
        },
        ...modelVersion === undefined ? {} : {
            modelVersion
        },
        ...responseId === undefined ? {} : {
            responseId
        }
    };
}
export function createKJModelAdapter(options) {
    const { protocol, request, onTextDelta: adapterText, onUsage: adapterUsage } = options;
    if (![
        'responses',
        'chat-completions',
        'anthropic-messages',
        'gemini-generate-content'
    ].includes(protocol) || typeof request !== 'function') invalid('Choose an explicit protocol and host transport');
    if (adapterText !== undefined && typeof adapterText !== 'function') invalid('onTextDelta must be a function');
    if (adapterUsage !== undefined && typeof adapterUsage !== 'function') invalid('onUsage must be a function');
    const model = identifier(options.model);
    const outputTokens = limit(options.maxOutputTokens, 4096, 131072);
    const chatTokenParameter = options.chatTokenParameter ?? 'max_tokens';
    if (![
        'max_tokens',
        'max_completion_tokens'
    ].includes(chatTokenParameter)) invalid('Unsupported chat token-limit field');
    const requestExtensions = chatExtensions(options.chatRequestExtensions);
    if (Object.keys(requestExtensions).length && protocol !== 'chat-completions') invalid('Chat request extensions require the Chat Completions protocol');
    const chatStreaming = options.chatStreaming ?? false;
    const responsesStreaming = options.responsesStreaming ?? false;
    const anthropicStreaming = options.anthropicStreaming ?? false;
    const geminiStreaming = options.geminiStreaming ?? false;
    const chatStreamIncludeUsage = options.chatStreamIncludeUsage ?? false;
    const chatStreamToolCalls = options.chatStreamToolCalls ?? false;
    if (typeof chatStreaming !== 'boolean' || typeof responsesStreaming !== 'boolean' || typeof anthropicStreaming !== 'boolean' || typeof geminiStreaming !== 'boolean' || typeof chatStreamIncludeUsage !== 'boolean' || typeof chatStreamToolCalls !== 'boolean' || (chatStreaming || chatStreamIncludeUsage || chatStreamToolCalls) && protocol !== 'chat-completions' || responsesStreaming && protocol !== 'responses' || anthropicStreaming && protocol !== 'anthropic-messages' || geminiStreaming && protocol !== 'gemini-generate-content' || (chatStreamIncludeUsage || chatStreamToolCalls) && !chatStreaming) invalid('Streaming options require their matching model protocol');
    const responseBytes = limit(options.maxResponseBytes, 1048576, 16777216);
    const streamEvents = limit(options.maxStreamEvents, 16384, 131072);
    const historyBytes = limit(options.maxHistoryBytes, 2097152, 16777216);
    const streaming = chatStreaming || responsesStreaming || anthropicStreaming || geminiStreaming;
    return Object.freeze({
        createConversation ({ instructions, tools, onTextDelta, onUsage }) {
            if (onTextDelta !== undefined && typeof onTextDelta !== 'function') invalid('onTextDelta must be a function');
            if (onUsage !== undefined && typeof onUsage !== 'function') invalid('onUsage must be a function');
            const definitions = tools.map((tool)=>({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema
                }));
            const schema = jsonCopy(definitions, historyBytes);
            const history = [];
            let pending = [];
            let started = false, busy = false, ended = false, turnNumber = 0;
            const geminiIds = new Map();
            return {
                async next (input, signal) {
                    if (busy || ended) invalid('Conversation is busy or has ended; start a fresh conversation');
                    busy = true;
                    try {
                        signal.throwIfAborted();
                        if (!started) {
                            if (input.kind !== 'prompt' || typeof input.text !== 'string') invalid('A conversation starts with a prompt');
                            const images = imagesForPrompt(input);
                            started = true;
                            if (protocol === 'gemini-generate-content') history.push({
                                role: 'user',
                                parts: [
                                    {
                                        text: input.text
                                    },
                                    ...images.map((image)=>({
                                            inlineData: {
                                                mimeType: image.mimeType,
                                                data: image.base64
                                            }
                                        }))
                                ]
                            });
                            else if (!images.length) history.push({
                                role: 'user',
                                content: input.text
                            });
                            else if (protocol === 'responses') history.push({
                                role: 'user',
                                content: [
                                    {
                                        type: 'input_text',
                                        text: input.text
                                    },
                                    ...images.map((image)=>({
                                            type: 'input_image',
                                            image_url: image.dataUrl
                                        }))
                                ]
                            });
                            else if (protocol === 'chat-completions') history.push({
                                role: 'user',
                                content: [
                                    {
                                        type: 'text',
                                        text: input.text
                                    },
                                    ...images.map((image)=>({
                                            type: 'image_url',
                                            image_url: {
                                                url: image.dataUrl
                                            }
                                        }))
                                ]
                            });
                            else history.push({
                                role: 'user',
                                content: [
                                    ...images.map((image)=>({
                                            type: 'image',
                                            source: {
                                                type: 'base64',
                                                media_type: image.mimeType,
                                                data: image.base64
                                            }
                                        })),
                                    {
                                        type: 'text',
                                        text: input.text
                                    }
                                ]
                            });
                        } else {
                            if (input.kind !== 'tool-results' || input.results.length !== pending.length || !pending.length) invalid('Every pending tool call needs exactly one result');
                            const results = input.results;
                            for(let index = 0; index < pending.length; index++){
                                if (results[index]?.id !== pending[index].id || results[index]?.name !== pending[index].name) invalid('Tool results must preserve the original call IDs, names and order');
                            }
                            if (protocol === 'responses') history.push(...results.map((item)=>({
                                    type: 'function_call_output',
                                    call_id: item.id,
                                    output: JSON.stringify(item.result)
                                })));
                            else if (protocol === 'chat-completions') history.push(...results.map((item)=>({
                                    role: 'tool',
                                    tool_call_id: item.id,
                                    content: JSON.stringify(item.result)
                                })));
                            else if (protocol === 'anthropic-messages') history.push({
                                role: 'user',
                                content: results.map((item)=>({
                                        type: 'tool_result',
                                        tool_use_id: item.id,
                                        content: JSON.stringify(item.result),
                                        is_error: !item.result.ok
                                    }))
                            });
                            else history.push({
                                role: 'function',
                                parts: results.map((item)=>({
                                        functionResponse: {
                                            ...geminiIds.has(item.id) ? {
                                                id: geminiIds.get(item.id)
                                            } : {},
                                            name: item.name,
                                            response: item.result
                                        }
                                    }))
                            });
                        }
                        let body;
                        if (protocol === 'responses') body = {
                            model,
                            instructions,
                            input: history,
                            tools: schema.map((tool)=>({
                                    type: 'function',
                                    ...tool,
                                    strict: false
                                })),
                            max_output_tokens: outputTokens,
                            store: false,
                            stream: responsesStreaming,
                            include: [
                                'reasoning.encrypted_content'
                            ]
                        };
                        else if (protocol === 'chat-completions') body = {
                            model,
                            messages: [
                                {
                                    role: 'system',
                                    content: instructions
                                },
                                ...history
                            ],
                            tools: schema.map((tool)=>({
                                    type: 'function',
                                    function: tool
                                })),
                            [chatTokenParameter]: outputTokens,
                            stream: chatStreaming,
                            ...chatStreamIncludeUsage ? {
                                stream_options: {
                                    include_usage: true
                                }
                            } : {},
                            ...chatStreamToolCalls ? {
                                tool_stream: true
                            } : {},
                            ...requestExtensions
                        };
                        else if (protocol === 'anthropic-messages') body = {
                            model,
                            system: instructions,
                            messages: history,
                            tools: schema.map((tool)=>({
                                    name: tool.name,
                                    description: tool.description,
                                    input_schema: tool.parameters
                                })),
                            max_tokens: outputTokens,
                            stream: anthropicStreaming
                        };
                        else body = {
                            systemInstruction: {
                                parts: [
                                    {
                                        text: instructions
                                    }
                                ]
                            },
                            contents: history,
                            tools: [
                                {
                                    functionDeclarations: schema.map((tool)=>({
                                            name: tool.name,
                                            description: tool.description,
                                            parametersJsonSchema: tool.parameters
                                        }))
                                }
                            ],
                            generationConfig: {
                                maxOutputTokens: outputTokens,
                                candidateCount: 1
                            }
                        };
                        const outgoing = deepFreeze(jsonCopy(body, historyBytes));
                        const startedAt = performance.now();
                        const responseSource = await request({
                            protocol,
                            model,
                            body: outgoing,
                            streaming,
                            signal
                        });
                        const streamedResponse = isAsyncIterable(responseSource);
                        const delta = (text)=>{
                            notifyText(onTextDelta, text);
                            notifyText(adapterText, text);
                        };
                        const rawResponse = chatStreaming && streamedResponse ? await assembleChatStream(responseSource, responseBytes, streamEvents, signal, delta) : responsesStreaming && streamedResponse ? await assembleResponsesStream(responseSource, responseBytes, streamEvents, signal, delta) : anthropicStreaming && streamedResponse ? await assembleAnthropicStream(responseSource, responseBytes, streamEvents, signal, delta) : geminiStreaming && streamedResponse ? await assembleGeminiStream(responseSource, responseBytes, streamEvents, signal, delta) : responseSource;
                        if (!streaming && streamedResponse) invalid('Non-streaming model transport returned an async iterable');
                        const usage = extractKJModelUsage(protocol, rawResponse, {
                            latencyMs: Math.max(0, performance.now() - startedAt)
                        });
                        notifyUsage(onUsage, usage);
                        notifyUsage(adapterUsage, usage);
                        const response = record(jsonCopy(rawResponse, responseBytes));
                        signal.throwIfAborted();
                        turnNumber++;
                        let text = '';
                        const calls = [];
                        const addCall = (id, name, args)=>calls.push({
                                id: identifier(id),
                                name: identifier(name),
                                arguments: args
                            });
                        if (protocol === 'responses') {
                            if (response.status !== 'completed') throw new KJModelError('KJMODEL_INCOMPLETE', 'Response is incomplete or failed; no tool calls were dispatched');
                            const output = array(response.output);
                            for (const raw of output){
                                const item = record(raw);
                                if (item.type === 'function_call') addCall(item.call_id, item.name, jsonArguments(item.arguments));
                                else if (item.type === 'message') {
                                    if (item.role !== 'assistant') invalid('Expected an assistant response');
                                    for (const rawPart of array(item.content)){
                                        const part = record(rawPart);
                                        if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
                                        else if (part.type === 'refusal') throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request');
                                        else invalid('Unsupported Responses message content');
                                    }
                                } else if (item.type !== 'reasoning') invalid('Unsupported Responses output item; use a custom adapter for additional tools');
                            }
                            history.push(...output);
                        } else if (protocol === 'chat-completions') {
                            const choices = array(response.choices);
                            if (choices.length !== 1) invalid('Expected exactly one model choice');
                            const choice = record(choices[0]), message = record(choice.message);
                            if (![
                                'stop',
                                'tool_calls'
                            ].includes(String(choice.finish_reason))) throw new KJModelError('KJMODEL_INCOMPLETE', 'Chat response is truncated, blocked or incomplete');
                            if (message.role !== 'assistant') invalid('Expected an assistant message');
                            if (message.refusal) throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request');
                            if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') invalid('Only text and function-call chat messages are supported');
                            text = typeof message.content === 'string' ? message.content : '';
                            for (const raw of array(message.tool_calls ?? [])){
                                const item = record(raw), fn = record(item.function);
                                if (item.type !== 'function') invalid('Unsupported chat tool type');
                                addCall(item.id, fn.name, jsonArguments(fn.arguments));
                            }
                            if (choice.finish_reason === 'tool_calls' && !calls.length) invalid('Chat finish reason requires tool calls');
                            history.push(message);
                        } else if (protocol === 'anthropic-messages') {
                            if (response.role !== 'assistant') invalid('Expected an assistant message');
                            if (![
                                'end_turn',
                                'tool_use',
                                'stop_sequence'
                            ].includes(String(response.stop_reason))) throw new KJModelError('KJMODEL_INCOMPLETE', 'Claude response is truncated, paused or incomplete');
                            const content = array(response.content);
                            for (const raw of content){
                                const item = record(raw);
                                if (item.type === 'tool_use') addCall(item.id, item.name, item.input);
                                else if (item.type === 'text' && typeof item.text === 'string') text += item.text;
                                else if (![
                                    'thinking',
                                    'redacted_thinking'
                                ].includes(String(item.type))) invalid('Unsupported Claude content block');
                            }
                            if (response.stop_reason === 'tool_use' !== calls.length > 0) invalid('Claude stop reason does not match its tool calls');
                            history.push({
                                role: 'assistant',
                                content
                            });
                        } else {
                            const candidates = array(response.candidates);
                            if (candidates.length !== 1) invalid('Expected exactly one Gemini candidate');
                            const candidate = record(candidates[0]);
                            if (candidate.finishReason !== 'STOP') throw new KJModelError('KJMODEL_INCOMPLETE', 'Gemini response is blocked, truncated or incomplete');
                            const content = record(candidate.content);
                            if (content.role !== 'model') invalid('Expected a Gemini model turn');
                            const parts = array(content.parts);
                            for (const [index, raw] of parts.entries()){
                                const part = record(raw);
                                if (part.functionCall) {
                                    const call = record(part.functionCall);
                                    const id = call.id === undefined ? `kj-gemini-${turnNumber}-${index}` : identifier(call.id);
                                    if (call.id !== undefined) geminiIds.set(id, identifier(call.id));
                                    addCall(id, call.name, call.args ?? {});
                                } else if (typeof part.text === 'string') {
                                    if (part.thought !== true) text += part.text;
                                } else invalid('Unsupported Gemini part');
                            }
                            history.push(content);
                        }
                        if (calls.length > 16 || new Set(calls.map((call)=>call.id)).size !== calls.length) invalid('Too many calls or duplicate call IDs in one model turn');
                        if (!calls.length && !text.trim()) invalid('Model returned neither tool calls nor user-visible text');
                        if (streaming && !streamedResponse) delta(text);
                        pending = calls;
                        ended = !calls.length;
                        return deepFreeze({
                            text,
                            calls,
                            usage
                        });
                    } catch (error) {
                        ended = true;
                        throw error;
                    } finally{
                        busy = false;
                    }
                }
            };
        }
    });
}
