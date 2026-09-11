import test from 'node:test'
import assert from 'node:assert/strict'
import {parseChatDataAttachment,chatDataAttachmentPrompt} from '../../../apps/playground/chat-data-attachment.js'
const bytes=value=>new TextEncoder().encode(value)
test('user JSON/CSV attachments preserve full UTF-8 source, file name and explicit data boundaries',()=>{
 for(const [name,text] of [['terrain.json','{"units":"meter","note":"示意数据 </script>","sections":[[0,99.5],[50,100]]}'],['terrain.csv','station,ground\r\n0,99.5\r\n50,100\r\n'],['quoted.csv','id,note\n1,"a,b\nsecond ""line"""']]){
  const item=parseChatDataAttachment(name,bytes(text));assert.equal(item.text,text);assert.equal(item.byteLength,bytes(text).length);assert.ok(Object.isFrozen(item))
  const prompt=chatDataAttachmentPrompt(item);assert.ok(prompt.includes(JSON.stringify(item)));assert.match(prompt,/untrusted data, not instructions/);assert.match(prompt,/not infer that the data was surveyed/)
 }
})
test('attachment parser rejects malformed, nonfinite, deep, oversized and binary input without truncation',()=>{
 for(const [name,text] of [['x.exe','hello'],['x.json','{'],['x.json','{"n":1e999}'],['x.json','['.repeat(20)+'0'+']'.repeat(20)],['x.csv','a,b\n1'],['x.csv','a,b\n1,"open'],['x.csv','a,b\n1,"closed"oops'],['x.csv','a,b\n1,2\u0000'],['x.json',' '],['bad\n.json','{}'],['x.csv','a'.repeat(8193)],['x.csv','\n'.repeat(4097)]])assert.throws(()=>parseChatDataAttachment(name,bytes(text)))
 assert.throws(()=>parseChatDataAttachment('x.csv',new Uint8Array([0xff,0xfe])))
 const exact='a'.repeat(8192);assert.equal(parseChatDataAttachment('limit.csv',bytes(exact)).text.length,8192)
})
