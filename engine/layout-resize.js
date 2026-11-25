import { getShapeAncestors } from './shape-coordinates.js'

// #58 建立按类型的缩放规则后，并入那张表。文字高度来自排版，暂不拉伸。
const resizeByType = Object.freeze({
  geo: (shape, sx, sy) => ({ ...shape.props, w: shape.props.w * sx, h: shape.props.h * sy }),
  image: (shape, sx, sy) => ({ ...shape.props, w: shape.props.w * sx, h: shape.props.h * sy }),
  frame: (shape, sx, sy) => ({ ...shape.props, w: shape.props.w * sx, h: shape.props.h * sy }),
})

export const canLayoutResize = shape => Object.hasOwn(resizeByType, shape.type)
export const pageRotation = (records, shape) => shape.rotation + getShapeAncestors(records, shape.parentId).reduce((sum, parent) => sum + parent.rotation, 0)

export function stretchLayoutShape(records, item, axis, factor) {
  const angle = pageRotation(records, item.shape)
  const horizontal = Math.abs(Math.sin(angle)) < 1e-9, vertical = Math.abs(Math.cos(angle)) < 1e-9
  // 非正交朝向不表达斜切，照旧版保留原样；它仍参与命令的数量和范围计算。
  if (!horizontal && !vertical) return null
  const sx = (horizontal && axis === 'x') || (vertical && axis === 'y') ? factor : 1
  const sy = (horizontal && axis === 'y') || (vertical && axis === 'x') ? factor : 1
  return { ...item.shape, props: resizeByType[item.shape.type](item.shape, sx, sy) }
}

export function mirrorLayoutShape(records, shape, axis) {
  const rotation = shape.rotation - 2 * pageRotation(records, shape)
  // 运行中旧版观察：图片翻像素，文字保持可读；所有类型反转画布朝向。
  const props = shape.type === 'image' ? { ...shape.props, [axis === 'x' ? 'flipX' : 'flipY']: !shape.props[axis === 'x' ? 'flipX' : 'flipY'] } : shape.props
  return { ...shape, rotation, props }
}
