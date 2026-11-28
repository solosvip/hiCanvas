import { createHash } from 'node:crypto'
import { normalizeGistId } from '../model/index.js'
import { httpError } from './file-lock.mjs'

// Immutable local code only. This hash authorizes no caller-provided script.
const bootstrap = `(()=>{let failed=false;const fail=()=>{failed=true;let n=document.getElementById('hicanvas-gist-status');if(!n){n=document.createElement('p');n.id='hicanvas-gist-status';n.setAttribute('role','status');document.body.prepend(n)}n.textContent='Gist 内容加载失败。'};document.addEventListener('error',e=>{if(['SCRIPT','LINK'].includes(e.target?.tagName))fail()},true);addEventListener('securitypolicyviolation',fail);document.addEventListener('load',e=>{if(!failed&&e.target?.hasAttribute?.('data-hicanvas-gist'))document.getElementById('hicanvas-gist-status')?.remove()},true)})();`
const bootstrapHash = createHash('sha256').update(bootstrap).digest('base64')

export function createGistPublication(value) {
  const gistId = normalizeGistId(value)
  if (!gistId) throw httpError('Gist ID 无效。')
  const script = `https://gist.github.com/${gistId}.js`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>GitHub Gist</title><script>${bootstrap}</script></head><body><p id="hicanvas-gist-status" role="status">Gist 内容加载中。</p><script data-hicanvas-gist src="${script}"></script></body></html>`
  return {
    path: '/gist.html',
    files: new Map([['/gist.html', { bytes: Buffer.from(html), type: 'text/html; charset=utf-8' }]]),
    policy: `default-src 'none'; script-src 'sha256-${bootstrapHash}' ${script}; script-src-attr 'none'; style-src 'unsafe-inline' https://github.githubassets.com/assets/; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; font-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`,
  }
}
