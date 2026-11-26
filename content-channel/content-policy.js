// Public script/network loading retains normal browser/CORS behavior. Offline
// file pages need opaque origins; HTTP publications already have unique hosts.
// Only that origin mechanism varies; script/form/popup grants are shared.
export const CONTENT_CAPABILITIES=Object.freeze(['allow-forms','allow-popups','allow-scripts'])
export function contentSandbox(uniqueHost=false){return [...CONTENT_CAPABILITIES,...uniqueHost?['allow-same-origin']:[]].join(' ')}
