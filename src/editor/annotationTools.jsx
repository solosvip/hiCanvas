// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { StateNode, createShapeId, toRichText } from "tldraw"
import { trackAnnotationCreated } from "../analytics.js"
import { ANNOTATION_TOOL_ID, ANNOTATION_MIN_LENGTH, ANNOTATION_LABEL_POSITION } from './configuration.jsx'
import { unlockGlobalToolLock, startEditingAnnotationArrowLabel, getDefaultAnnotationArrowBend, getAnnotationColor } from './annotationEditing.jsx'
class CowartAnnotationTool extends StateNode {
  static id = ANNOTATION_TOOL_ID
  static initial = 'idle'
  static children() {
    return [CowartAnnotationIdle, CowartAnnotationPointing]
  }
  onEnter() {
    unlockGlobalToolLock(this.editor)
  }
}
class CowartAnnotationIdle extends StateNode {
  static id = 'idle'
  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }
  onPointerDown(info) {
    this.parent.transition('pointing', info)
  }
  onCancel() {
    this.editor.setCurrentTool('select')
  }
}
class CowartAnnotationPointing extends StateNode {
  static id = 'pointing'
  arrowId = null
  markId = ''
  origin = null
  onEnter() {
    const origin = this.editor.inputs.getOriginPagePoint()
    const scale = this.editor.getResizeScaleFactor()
    const color = getAnnotationColor(this.editor)
    const arrowId = createShapeId()
    this.arrowId = arrowId
    this.origin = { x: origin.x, y: origin.y }
    this.markId = this.editor.markHistoryStoppingPoint(`creating_annotation:${arrowId}`)
    this.editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: origin.x,
      y: origin.y,
      meta: {
        cowartAnnotationArrow: true
      },
      props: {
        kind: 'arc',
        dash: 'draw',
        size: 'm',
        fill: 'none',
        color,
        labelColor: color,
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        richText: toRichText(''),
        labelPosition: ANNOTATION_LABEL_POSITION,
        font: 'draw',
        scale
      }
    })
  }
  onPointerMove() {
    this.updateArrowEnd()
  }
  onPointerUp() {
    this.complete()
  }
  onCancel() {
    this.cancel()
  }
  onInterrupt() {
    this.cancel()
  }
  updateArrowEnd() {
    if (!this.arrowId || !this.origin) return
    const point = this.editor.inputs.getCurrentPagePoint()
    this.editor.updateShapes([
      {
        id: this.arrowId,
        type: 'arrow',
        props: {
          end: {
            x: point.x - this.origin.x,
            y: point.y - this.origin.y
          }
        }
      }
    ])
  }
  complete() {
    if (!this.arrowId || !this.origin) {
      this.editor.setCurrentTool(ANNOTATION_TOOL_ID)
      return
    }
    this.updateArrowEnd()
    const point = this.editor.inputs.getCurrentPagePoint()
    const dx = point.x - this.origin.x
    const dy = point.y - this.origin.y
    const length = Math.hypot(dx, dy)
    if (length < ANNOTATION_MIN_LENGTH / this.editor.getZoomLevel()) {
      this.editor.bailToMark(this.markId)
      this.parent.transition('idle')
      return
    }
    this.editor.updateShapes([
      {
        id: this.arrowId,
        type: 'arrow',
        props: {
          bend: getDefaultAnnotationArrowBend(dx, dy, this.editor.getResizeScaleFactor())
        }
      }
    ])
    trackAnnotationCreated()
    startEditingAnnotationArrowLabel(this.editor, this.arrowId)
  }
  cancel() {
    if (this.arrowId) {
      this.editor.bailToMark(this.markId)
    }
    this.parent.transition('idle')
  }
}
export { CowartAnnotationTool, CowartAnnotationIdle, CowartAnnotationPointing }
