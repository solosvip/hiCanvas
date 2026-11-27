import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { bookmarkTarget, publicAddress, selectBookmarkAddress } from './bookmark-address.mjs'

test('normalizes domain, fragment and default port without losing query', () => {
  assert.equal(bookmarkTarget('HTTPS://BÜCHER.de.:443/a?q=1#x').href, 'https://xn--bcher-kva.de/a?q=1')
  assert.equal(bookmarkTarget('http://8.8.8.8/').hostname, '8.8.8.8')
  assert.equal(bookmarkTarget('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]')
})

test('rejects ambiguous addresses and URL capabilities before DNS', () => {
  for (const url of ['http://2130706433', 'http://0177.0.0.1', 'http://0x08080808', 'http://8.8.8',
    'http://127.0.0.1', 'http://[::ffff:8.8.8.8]', 'http://[::ffff:808:808]', 'http://[fe80::1%25en0]',
    'http://a@google.com', 'https://google.com:444', 'ftp://google.com', 'http://google.com\\@8.8.8.8',
    'https://google.com/\nq', 'https://%67oogle.com', 'http://printer', 'http://foo.local.',
    'http://localhost', 'http://x.home.arpa', 'http://x.onion', 'http://x.test', 'http://x.internal']) {
    assert.throws(() => bookmarkTarget(url), { code: /invalid_url|target_not_public/ }, url)
  }
})

test('special IPv4 CIDRs include both edges but public neighbors remain usable', () => {
  const ranges = [
    ['0.0.0.0','0.255.255.255'], ['10.0.0.0','10.255.255.255'], ['100.64.0.0','100.127.255.255'],
    ['127.0.0.0','127.255.255.255'], ['169.254.0.0','169.254.255.255'], ['172.16.0.0','172.31.255.255'],
    ['192.0.0.0','192.0.0.255'], ['192.0.2.0','192.0.2.255'], ['192.31.196.0','192.31.196.255'],
    ['192.52.193.0','192.52.193.255'], ['192.88.99.0','192.88.99.255'], ['192.168.0.0','192.168.255.255'],
    ['192.175.48.0','192.175.48.255'], ['198.18.0.0','198.19.255.255'], ['198.51.100.0','198.51.100.255'],
    ['203.0.113.0','203.0.113.255'], ['224.0.0.0','239.255.255.255'], ['240.0.0.0','255.255.255.255'],
  ]
  for (const ip of ranges.flat()) assert.equal(publicAddress(ip), false, ip)
  for (const ip of ['8.8.8.8','100.63.255.255','100.128.0.0','172.15.255.255','172.32.0.0',
    '198.17.255.255','198.20.0.0','192.0.1.255','223.255.255.255']) assert.equal(publicAddress(ip), true, ip)
})

test('IPv6 rejects special, mapped and transition addresses conservatively', () => {
  for (const ip of ['::','::1','::ffff:808:808','::ffff:8.8.8.8','64:ff9b::808:808','100::1',
    '2001::1','2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff','2001:db8::','2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
    '2002::1','2620:4f:8000::1','3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff','fc00::1','fe80::1','fec0::1','ff02::1']) {
    assert.equal(publicAddress(ip), false, ip)
  }
  for (const ip of ['2001:200::1','2606:4700:4700::1111','3ffe:ffff::1']) assert.equal(publicAddress(ip), true, ip)
})

test('all DNS answers must be public and well formed before one is selected', () => {
  assert.deepEqual(selectBookmarkAddress([{ address:'8.8.8.8', family:4 }, { address:'2606:4700::1111', family:6 }]), { address:'8.8.8.8', family:4 })
  for (const answers of [[], [{ address:'8.8.8.8', family:6 }], [{ address:'garbage', family:4 }],
    [{ address:'8.8.8.8', family:4 }, { address:'10.0.0.1', family:4 }],
    [{ address:'8.8.8.8', family:4 }, { address:'fc00::1', family:6 }],
    Array.from({length:17},()=>({address:'8.8.8.8',family:4}))]) {
    assert.throws(() => selectBookmarkAddress(answers), { code:'target_not_public' })
  }
})
