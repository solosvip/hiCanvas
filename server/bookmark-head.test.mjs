import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBookmarkHead } from './bookmark-head.mjs'
import { normalizeBookmarkMetadata } from '../model/index.js'

function read(html, type = 'text/html; charset=utf-8', url = 'https://site.example.net/dir/final') {
  const head = createBookmarkHead(type, url)
  head.write(Buffer.isBuffer(html) ? html : Buffer.from(html))
  return head.finish()
}

test('head fields use independent nonempty priorities and decode entities once', () => {
  assert.deepEqual(read('<!doctype html><html><head><title>fallback</title><meta name=description content="fallback desc"><meta property="OG:TITLE" content=" &nbsp; "><meta property=og:title content="A &amp;lt;b&amp;gt; &copy;"><meta property=og:description content="  hello&#10; world  "><link rel=canonical href="../page#top"></head><body>'), {
    title:'A &lt;b&gt; ©', description:'hello world', url:'https://site.example.net/page',
  })
})

test('comments, scripts, style and body cannot forge head metadata', () => {
  assert.deepEqual(read('<head><!-- <meta property=og:title content=BAD> --><script>"</head><meta property=og:title content=BAD>"</script><style>fake</style><title>actual</title></head><body><meta property=og:description content=BAD>'), {
    title:'actual',description:'',url:'https://site.example.net/dir/final',
  })
  assert.equal(read('<head><title>&lt;img src=x onerror=alert(1)&gt;</title></head>').title, '<img src=x onerror=alert(1)>')
  assert.equal(read('<title>implicit head</title><body>').title, 'implicit head')
})

test('implicit body text and clean EOF preserve fields already in the head',()=>{
  assert.equal(read('<title>X</title>正文<meta property=og:title content=BAD>').title,'X')
  assert.equal(read('<head><title>clean EOF</title>').title,'clean EOF')
  assert.equal(read('<head><title>title at EOF').title,'title at EOF')
})

test('head noscript and nested templates are inert and later metadata still counts',()=>{
  assert.equal(read('<head><noscript><meta property=og:title content=BAD></noscript><template><template></template><meta property=og:title content=BAD><script>"</template>"</script></template><meta property=og:title content=GOOD></head>').title,'GOOD')
  for(const tag of ['textarea','iframe','xmp','noembed','noframes']) {
    assert.equal(read(`<head><template><${tag}></template><meta property=og:title content=BAD></${tag}></template><title>REAL</title></head>`).title,'REAL',tag)
  }
  assert.equal(read('<head><title>BEFORE</title><template><plaintext></template><meta property=og:title content=BAD>').title,'BEFORE')
  assert.equal(read('<head><template><svg><![CDATA[</template><meta property=og:title content=BAD>]]></svg></template><title>REAL</title></head>').title,'REAL')
})

test('XML-like and bogus comments are skipped without dropping later metadata',()=>{
  for(const bogus of ['<?xml version="1.0"?>','<!unknown " >','<1 " >','</? >','<< >']) {
    assert.equal(read(`<head>${bogus}<title>kept</title></head>`).title,'kept',bogus)
  }
})

test('canonical may only name a strict HTTP URL on the final origin', () => {
  for (const href of ['https://other.net/x','javascript:alert(1)','https://x@site.example.net/x','https://site.example.net:444/x']) {
    assert.equal(read(`<head><base href="https://evil.net"><link rel=canonical href="${href}"></head>`).url, 'https://site.example.net/dir/final')
  }
})

test('streaming handles split UTF8, BOM, quotes and head terminators', () => {
  const head = createBookmarkHead('text/html', 'https://site.example.net/')
  const bytes = Buffer.from('\ufeff<head><meta property="og:title" content="你>好"><title>x</title></head>')
  for (const byte of bytes) head.write(Buffer.from([byte]))
  assert.equal(head.finish().title, '你>好')
  assert.equal(head.done, true)
  assert.equal(read(Buffer.from('<head><title>caf\xe9</title></head>','latin1'), 'text/html; charset=windows-1252').title, 'café')
  assert.equal(read(Buffer.from('<meta charset=windows-1252><title>caf\xe9</title><body>','latin1'), 'text/html').title, 'café')
})

test('a short completed head stops a persistent response without waiting for EOF',()=>{
  const head=createBookmarkHead('text/html','https://site.example.net/')
  head.write(Buffer.from('<head><title>short</title></head>'))
  assert.equal(head.done,true)
  assert.equal(head.finish().title,'short')
})

test('unknown entities remain literal and numeric invalid entities cannot add controls',()=>{
  assert.equal(read('<title>&unknown; &#0; &#xD800; &NotEqualTilde;</title></head>').title,'&unknown; � � ≂̸')
})

test('BOM outranks HTTP, HTTP outranks meta; unsupported and malformed encoding fails', () => {
  assert.equal(read(Buffer.from('\ufeff<title>好</title></head>'), 'text/html; charset=unknown').title, '好')
  assert.equal(read('<meta charset=unknown><title>ok</title></head>').title, 'ok')
  const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('<title>你好</title></head>','utf16le')])
  assert.equal(read(utf16,'text/html; charset=unknown').title,'你好')
  const gbk=Buffer.concat([Buffer.from('<title>'),Buffer.from([0xc4,0xe3,0xba,0xc3]),Buffer.from('</title></head>')])
  assert.equal(read(gbk,'text/html; charset=gbk').title,'你好')
  for (const [html,type] of [['<title>x</title></head>','text/html; charset=unknown'],
    ['<title>x</title></head>','text/html; charset=utf-8; charset=gbk'],
    [Buffer.from([0x3c,0x68,0x65,0x61,0x64,0x3e,0xff]),'text/html; charset=utf-8']]) {
    assert.throws(() => read(html,type), { code:'invalid_html' })
  }
})

test('WHATWG decoder labels cover additional languages and meta UTF16 means UTF8',()=>{
  const cases=[['euc-kr',[0xb0,0xa1],'가'],['windows-1251',[0xdf],'Я'],['iso-8859-2',[0xa1],'Ą']]
  for(const [label,bytes,expected] of cases){
    const html=Buffer.concat([Buffer.from('<title>'),Buffer.from(bytes),Buffer.from('</title></head>')])
    assert.equal(read(html,`text/html; charset=${label}`).title,expected,label)
  }
  for(const label of ['utf-16','utf-16le','utf-16be']) assert.equal(read(`<meta charset=${label}><title>你好</title></head>`,'text/html').title,'你好')
  assert.throws(()=>read('<title>x</title>','text/html; charset=replacement'),{code:'invalid_html'})
})

test('charset prescan ignores fake meta inside style, comments, attributes and body',()=>{
  for(const html of [
    '<head><style>/* <meta charset=windows-1252> */</style><title>你好</title></head>',
    '<head><meta content="<meta charset=windows-1252>"><title>你好</title></head>',
    '<head><!-- <meta charset=windows-1252> --><title>你好</title></head><meta charset=gbk>',
  ]) assert.equal(read(html,'text/html').title,'你好')
})

test('parser refuses entity declarations and bounded scanner exhaustion', () => {
  for (const html of ['<!DOCTYPE x [<!ENTITY x "boom">]><head></head>',
    '<title>'+'汉'.repeat(6000)+'</title></head>',
    `<head><meta content="${'x'.repeat(17000)}"></head>`, '<head>'+ '<meta name=x>'.repeat(2049)+'</head>',
    '<head><meta '+ Array.from({length:33},(_,n)=>`x${n}=y`).join(' ')+'></head>',
    '<head><!--'+ 'x'.repeat(128*1024)+'--></head>']) assert.throws(() => read(html), { code:'invalid_html' })
})

test('shared DTO enforces three strings and bounds by Unicode code points', () => {
  assert.deepEqual(normalizeBookmarkMetadata({title:'\u202e A\u0000 B \u2069',description:'😀'.repeat(1001),url:'https://site.example.net/#x'}), {
    title:'A B',description:'😀'.repeat(1000),url:'https://site.example.net/',
  })
  for (const value of [{title:1,description:'',url:'https://site.example.net'},
    {title:'',description:'',url:'javascript:x'}, {title:'',description:'',url:'https://site.example.net',html:'x'}]) {
    assert.throws(() => normalizeBookmarkMetadata(value))
  }
})
