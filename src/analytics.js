// 独立画板只处理本地作品，不启用上游的遥测。
export function trackCanvasOpened() {}
export function trackAnnotationCreated() {}
export function trackFilmFrameCreated() {}
export function trackFilmPlaybackAction() {}
export function trackFilmExport() {}

export async function sendTrackedWidgetMessage(sendMessage, message) {
  if (typeof sendMessage !== 'function') {
    throw new Error('此版本已支持本地画板；自定义生图模型与外部 Agent 接入将在后续版本开放。')
  }
  return sendMessage(message)
}
