// 普通浏览器没有宿主替用户提示本机服务断开；失败状态持续到真正保存成功。
export function createPersistenceFeedback(container, retry, hasUnsavedChanges) {
  const document = container.ownerDocument
  const failures = new Set()
  let disposed = false
  const names = { canvas: '画板修改', selection: '选择状态', view: '视角' }
  const notice = document.createElement('div')
  notice.className = 'hicanvas-save-feedback'
  notice.setAttribute('role', 'alert')
  notice.setAttribute('data-hicanvas-save-error', '')
  const message = document.createElement('span')
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '重试保存'
  button.addEventListener('click', retry)
  notice.append(message, button)
  function update() {
    if (failures.size === 0) { notice.remove(); return }
    message.textContent = `${[...failures].map(key => names[key]).join('、')}尚未保存。请保持页面打开，检查本机服务后重试。`
    if (!notice.isConnected) container.append(notice)
  }
  function beforeUnload(event) {
    if (hasUnsavedChanges()) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  document.defaultView.addEventListener('beforeunload', beforeUnload)
  return {
    failed(kind) {
      if (disposed) return
      failures.add(kind)
      update()
    },
    saved(kind) {
      if (disposed) return
      failures.delete(kind)
      update()
    },
    dispose() {
      disposed = true
      notice.remove()
      button.removeEventListener('click', retry)
      document.defaultView.removeEventListener('beforeunload', beforeUnload)
    }
  }
}
