import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (condition, message) => { if (!condition) throw new Error(message) }
const close = (actual, expected) => Math.abs(actual - expected) < .1
const richText = paragraphs => ({ type: 'doc', content: paragraphs.map(text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })) })

// Exercise mounted output and record updates, not a particular text element type.
export async function runTextProbe() {
  const fixture = await (await fetch('/__renderer_fixture?count=500')).json()
  const store = createCanvasStore()
  store.loadStoreSnapshot(fixture.snapshot)
  const source = store.get('shape:perf-2'), frameSource = store.get('shape:perf-0')
  store.remove(Object.values(fixture.snapshot.store).filter(record => record.typeName === 'shape').map(record => record.id))
  const frame = { ...frameSource, id: 'shape:text-frame', type: 'frame', x: 20, y: 50, props: { w: 240, h: 240, name: '中文 Frame', color: 'blue' } }
  const text = { ...source, parentId: frame.id, x: 10, y: 20, props: { ...source.props, w: 96, size: 'm', scale: 1.5, richText: richText(['AB中', '', '<b>']) } }
  store.put([frame, text])
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px'
  document.body.append(host)
  const view = mountCanvasRenderer(host, { store })
  try {
    await settle()
    const node = host.querySelector(`[data-shape-id="${text.id}"]`), body = node.firstElementChild
    let bounds = body.getBoundingClientRect()
    check(close(bounds.width, 144) && close(bounds.height, 112.5), '中文、多行及空行的既有文字边界改变')
    check(body.textContent === 'AB中<b>' && !body.querySelector('b'), '文字内容缺失或被解析为标记')
    const boundsOfText = (root, value) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) if (walker.currentNode.textContent === value) {
        const range = document.createRange(); range.selectNodeContents(walker.currentNode)
        return range.getBoundingClientRect()
      }
      throw new Error(`没有画出文字：${value}`)
    }
    const widthOfText = value => boundsOfText(body, value).width
    check(close(widthOfText('AB中'), 72), '中英文混排没有保留既有估算行宽')
    const firstLine = boundsOfText(body, 'AB中'), lastLine = boundsOfText(body, '<b>')
    check(firstLine.top >= bounds.top && firstLine.bottom <= bounds.top + 37.6, '文字基线超出第一行')
    check(close(lastLine.top - firstLine.top, 75), '跨过空行后的文字纵向间距改变')
    const frameNode = host.querySelector('[data-shape-type="frame"]')
    check(boundsOfText(frameNode, '中文 Frame').bottom <= frameNode.firstElementChild.getBoundingClientRect().top, '框标题没有位于框体上方')
    view.setCamera({ x: 5, y: 7, z: 2 }); await settle()
    bounds = body.getBoundingClientRect()
    check(close(bounds.width, 288) && close(bounds.height, 225), '相机缩放改变了文字局部布局')
    check(close(bounds.left, 70) && close(bounds.top, 154), '画面变换与公开相机坐标约定不一致')
    store.put([{ ...text, props: { ...text.props, scale: 2, color: 'red', richText: richText(['更新']) } }])
    await settle()
    const updated = node.firstElementChild.getBoundingClientRect()
    check(close(updated.width, 384) && close(updated.height, 100) && node.textContent === '更新', '记录变更未更新内容、缩放或边界')
    view.setCamera({ x: 0, y: 0, z: 1 })
    store.put([{ ...text, props: { ...text.props, scale: 1, richText: richText(['é😀中']) } }])
    await settle()
    check(close(widthOfText('é😀中'), 84), '组合字符或 emoji 没有保留估算行宽')
    const tabbed = { ...text, props: { ...text.props, scale: 1, richText: richText(['A\tB']) } }
    store.put([tabbed]); await settle()
    check(close(widthOfText(body.textContent), 36), '制表符超出既有估算行宽')
    check(JSON.stringify(store.get(text.id).props.richText) === JSON.stringify(tabbed.props.richText), '显示规范化不应修改原始文字记录')
    return { mixedTextAndEmptyLines: true, estimatedLineWidths: true, scaledBounds: true, textRecordUpdates: true, frameTitle: true }
  } finally { view.unmount(); host.remove() }
}
