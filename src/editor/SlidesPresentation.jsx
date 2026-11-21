// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { useEditor, useValue } from "tldraw"
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { AI_SLIDES_LABEL, COWART_OPEN_SLIDES_EVENT } from './configuration.jsx'
import { isAiSlidesShape } from './holderMeta.jsx'
import { getAiSlidesItems, layoutAiSlides } from './slidesLayout.jsx'
import { stopEditorOverlayEvent } from './generationPrompts.jsx'
import { CowartSlidesScaledMedia } from './slidesMedia.jsx'
function CowartSlidesPresentationOverlay() {
  const editor = useEditor()
  const overlayRef = useRef(null)
  const [slidesShapeId, setSlidesShapeId] = useState(null)
  const [index, setIndex] = useState(0)
  const [isPresenting, setIsPresenting] = useState(false)
  const slidesShape = useValue(
    'cowart active slides presentation frame',
    () => (slidesShapeId ? editor.getShape(slidesShapeId) : null),
    [editor, slidesShapeId]
  )
  const slides = useValue(
    'cowart active slides presentation items',
    () => (slidesShapeId ? getAiSlidesItems(editor, slidesShapeId) : []),
    [editor, slidesShapeId]
  )
  const currentSlide = slides[index] || null
  const total = slides.length
  useEffect(() => {
    function handleOpen(event) {
      const nextSlidesShapeId = event.detail?.slidesShapeId
      if (!nextSlidesShapeId || !isAiSlidesShape(editor.getShape(nextSlidesShapeId))) return
      layoutAiSlides(editor, nextSlidesShapeId)
      setSlidesShapeId(nextSlidesShapeId)
      setIndex(0)
      setIsPresenting(false)
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener(COWART_OPEN_SLIDES_EVENT, handleOpen)
    return () => doc.removeEventListener(COWART_OPEN_SLIDES_EVENT, handleOpen)
  }, [editor])
  useEffect(() => {
    if (index < total) return
    setIndex(Math.max(0, total - 1))
  }, [index, total])
  useEffect(() => {
    function handleFullscreenChange() {
      if (editor.getContainerDocument().fullscreenElement !== overlayRef.current) {
        setIsPresenting(false)
      }
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => doc.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [editor])
  useEffect(() => {
    if (!slidesShapeId) return undefined
    const container = editor.getContainer()
    container.classList.add('cowart-slides-mode')
    return () => container.classList.remove('cowart-slides-mode')
  }, [editor, slidesShapeId])
  const go = useCallback(
    (delta) => setIndex((value) => Math.max(0, Math.min(total - 1, value + delta))),
    [total]
  )
  const handleUnhandledHtmlClick = useCallback(() => go(1), [go])
  useEffect(() => {
    if (!slidesShapeId) return undefined
    function handleKeyDown(event) {
      const target = event.target
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (isPresenting) {
          exitPresentation()
        } else {
          closeViewer()
        }
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        go(-1)
      }
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        go(1)
      }
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => doc.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [editor, go, isPresenting, slidesShapeId])
  async function exitPresentation() {
    setIsPresenting(false)
    const doc = editor.getContainerDocument()
    if (doc.fullscreenElement === overlayRef.current) {
      try {
        await doc.exitFullscreen()
      } catch (_error) {
        // The browser may already be exiting fullscreen.
      }
    }
  }
  function closeViewer() {
    setSlidesShapeId(null)
    void exitPresentation()
  }
  async function playSlides() {
    if (!currentSlide) return
    setIsPresenting(true)
    if (!editor.getContainerDocument().fullscreenElement) {
      try {
        await overlayRef.current?.requestFullscreen({ navigationUI: 'hide' })
      } catch (_error) {
        // Keep the clean in-widget presentation view if fullscreen is unavailable.
      }
    }
  }
  function handlePresentStageClick(event) {
    if (event.target.closest('.cowart-slides-present-controls')) return
    go(1)
  }
  if (!slidesShapeId || !isAiSlidesShape(slidesShape)) return null
  const savedDeckName = slidesShape.props?.name
  const deckName = savedDeckName === 'AI Slides' ? AI_SLIDES_LABEL : (savedDeckName || AI_SLIDES_LABEL)
  return (
    <section
      ref={overlayRef}
      aria-label="AI 幻灯片演示器"
      className={`cowart-slides-viewer${isPresenting ? ' is-presenting' : ''}`}
      onClick={stopEditorOverlayEvent}
      onDoubleClick={stopEditorOverlayEvent}
      onPointerDown={stopEditorOverlayEvent}
    >
      {isPresenting && currentSlide ? (
        <div className="cowart-slides-present-stage" onClick={handlePresentStageClick}>
          <div className="cowart-slides-present-slide">
            <CowartSlidesScaledMedia
              className="cowart-slides-present-media"
              onUnhandledHtmlClick={handleUnhandledHtmlClick}
              shape={currentSlide}
              title={`第 ${index + 1} 页`}
            />
          </div>
          <div className="cowart-slides-present-controls" onClick={stopEditorOverlayEvent}>
            <button aria-label="上一页" disabled={index === 0} onClick={() => go(-1)} type="button">
              <ChevronLeft aria-hidden="true" size={15} strokeWidth={2} />
            </button>
            <span>{index + 1} / {total}</span>
            <button aria-label="下一页" disabled={index >= total - 1} onClick={() => go(1)} type="button">
              <ChevronRight aria-hidden="true" size={15} strokeWidth={2} />
            </button>
            <button aria-label="退出播放" onClick={exitPresentation} type="button">
              <X aria-hidden="true" size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="cowart-slides-viewer-header">
            <div className="cowart-slides-viewer-identity">
              <button
                aria-label="关闭演示页"
                className="cowart-slides-close-button"
                onClick={closeViewer}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={2} />
              </button>
              <span aria-hidden="true" className="cowart-slides-header-divider" />
              <div className="cowart-slides-deck-name">{deckName}</div>
            </div>
            <nav aria-label="翻页控制" className="cowart-slides-page-nav">
              <button aria-label="上一页" disabled={index === 0 || !total} onClick={() => go(-1)} type="button">
                <ChevronLeft aria-hidden="true" size={18} strokeWidth={2} />
              </button>
              <span>{total ? `${index + 1} / ${total}` : '0 / 0'}</span>
              <button aria-label="下一页" disabled={index >= total - 1 || !total} onClick={() => go(1)} type="button">
                <ChevronRight aria-hidden="true" size={18} strokeWidth={2} />
              </button>
            </nav>
            <div className="cowart-slides-viewer-actions">
              <button disabled={!currentSlide} onClick={playSlides} type="button">
                <Play aria-hidden="true" size={15} strokeWidth={2} />
                播放
              </button>
            </div>
          </header>
          <div className="cowart-slides-viewer-body">
            <aside aria-label="幻灯片页面预览" className="cowart-slides-thumbnails">
              {slides.map((slide, slideIndex) => {
                const width = Math.max(1, Number(slide.props?.w) || 16)
                const height = Math.max(1, Number(slide.props?.h) || 9)
                return (
                  <button
                    aria-label={`跳转到第 ${slideIndex + 1} 页`}
                    className={slideIndex === index ? 'is-active' : ''}
                    key={slide.id}
                    onClick={() => setIndex(slideIndex)}
                    type="button"
                  >
                    <span>{slideIndex + 1}</span>
                    <span className="cowart-slides-thumb-shell" style={{ aspectRatio: `${width} / ${height}` }}>
                      <CowartSlidesScaledMedia
                        className="cowart-slides-thumb-viewport"
                        shape={slide}
                        title={`第 ${slideIndex + 1} 页预览`}
                      />
                    </span>
                  </button>
                )
              })}
            </aside>
            <main className="cowart-slides-main-stage">
              {currentSlide ? (
                <div className="cowart-slides-current-slide">
                  <CowartSlidesScaledMedia
                    className="cowart-slides-current-media"
                    shape={currentSlide}
                    title={`第 ${index + 1} 页`}
                  />
                </div>
              ) : (
                <div className="cowart-slides-empty">把图片或网页草稿拖入 AI 幻灯片后即可演示。</div>
              )}
            </main>
          </div>
        </>
      )}
    </section>
  )
}
export { CowartSlidesPresentationOverlay }
