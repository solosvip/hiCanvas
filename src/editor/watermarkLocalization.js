const UNLICENSED_WATERMARK_BUTTON = '[data-testid="tl-watermark-unlicensed"] > button'
const LICENSED_WATERMARK_BUTTON = '[data-testid="tl-watermark-licensed"] > button'

const WATERMARK_COPY = {
  unlicensed: {
    text: '获取生产许可',
    title: 'tldraw SDK 生产环境需要许可证，可在 tldraw.dev/pricing 获取免费的 100 天试用许可。'
  },
  licensed: {
    title: '使用 tldraw SDK 构建无限画布应用。了解更多：tldraw.dev。'
  }
}

function updateWatermark(document) {
  const unlicensed = document.querySelector(UNLICENSED_WATERMARK_BUTTON)
  if (unlicensed) {
    if (unlicensed.textContent !== WATERMARK_COPY.unlicensed.text) {
      unlicensed.textContent = WATERMARK_COPY.unlicensed.text
    }
    unlicensed.title = WATERMARK_COPY.unlicensed.title
  }
  const licensed = document.querySelector(LICENSED_WATERMARK_BUTTON)
  if (licensed) licensed.title = WATERMARK_COPY.licensed.title
}

function startWatermarkLocalization(document) {
  if (!document?.body || typeof MutationObserver === 'undefined') return () => {}
  updateWatermark(document)
  const observer = new MutationObserver(() => updateWatermark(document))
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}

export { startWatermarkLocalization }
