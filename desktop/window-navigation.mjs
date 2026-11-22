export async function saveBeforeLeaving(contents) {
  if (!contents.getURL() || contents.getURL() === 'about:blank') return
  await contents.executeJavaScript("typeof window.hiCanvasPrepareNavigation === 'function' ? window.hiCanvasPrepareNavigation() : undefined")
}
export async function navigateCanvas(contents, url) {
  if (contents.getURL() === url) return
  await saveBeforeLeaving(contents)
  await contents.loadURL(url)
}
