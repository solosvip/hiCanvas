import { DefaultColorStyle } from '@tldraw/tlschema'

// 对照运行中的旧版画面取色（2026-11-25），未参照任何源码。
// Synthetic shapes, sRGB screenshots; pattern strokes sampled at 4x zoom.
// These are observed light-theme document paints, not application UI tokens.
const sampled = {
  'black': { note: '#fce19c', stroke: '#1d1d1d', text: '#1d1d1d', solid: '#e8e8e8', semi: '#fcfffe', fill: '#1d1d1d', lined: '#363636', pattern: '#484848' },
  'grey': { note: '#c0cad3', stroke: '#9fa8b2', text: '#9fa8b2', solid: '#eceef0', semi: '#fcfffe', fill: '#9fa8b2', lined: '#bbc1c9', pattern: '#bcc3c9' },
  'light-violet': { note: '#dfb0f9', stroke: '#e085f4', text: '#e085f4', solid: '#f5eafa', semi: '#fcfffe', fill: '#e085f4', lined: '#e9abf7', pattern: '#e9acf8' },
  'violet': { note: '#db91fd', stroke: '#ae3ec9', text: '#ae3ec9', solid: '#ecdcf2', semi: '#fcfffe', fill: '#ae3ec9', lined: '#be68d4', pattern: '#bd62d3' },
  'blue': { note: '#8aa3ff', stroke: '#4465e9', text: '#4465e9', solid: '#dce1f8', semi: '#fcfffe', fill: '#4465e9', lined: '#6580ec', pattern: '#6681ee' },
  'light-blue': { note: '#9bc4fd', stroke: '#4ba1f1', text: '#4ba1f1', solid: '#ddedfa', semi: '#fcfffe', fill: '#4ba1f1', lined: '#7abaf5', pattern: '#6fbbf8' },
  'yellow': { note: '#fed49a', stroke: '#f1ac4b', text: '#f1ac4b', solid: '#f9f0e6', semi: '#fcfffe', fill: '#f1ac4b', lined: '#f5c27a', pattern: '#fecb92' },
  'orange': { note: '#faa475', stroke: '#e16919', text: '#e16919', solid: '#f8e2d4', semi: '#fcfffe', fill: '#e16919', lined: '#ea8643', pattern: '#f78438' },
  'green': { note: '#6fc896', stroke: '#099268', text: '#099268', solid: '#d3e9e3', semi: '#fcfffe', fill: '#099268', lined: '#0bad7c', pattern: '#39a785' },
  'light-green': { note: '#98d08a', stroke: '#4cb05e', text: '#4cb05e', solid: '#dbf0e0', semi: '#fcfffe', fill: '#4cb05e', lined: '#7ec88c', pattern: '#65cb78' },
  'light-red': { note: '#f7a5a1', stroke: '#f87777', text: '#f87777', solid: '#f4dadb', semi: '#fcfffe', fill: '#f87777', lined: '#f99a9a', pattern: '#fe9e9e' },
  'red': { note: '#fc8282', stroke: '#e03131', text: '#e03131', solid: '#f4dadb', semi: '#fcfffe', fill: '#e03131', lined: '#e75f5f', pattern: '#e55959' },
  'white': { note: '#ffffff', stroke: '#ffffff', text: '#ffffff', solid: '#f5f5f5', semi: '#fcfffe', fill: '#ffffff', lined: '#ffffff', pattern: '#f9f9f9' },
}

export const LIGHT_PALETTE = Object.freeze(Object.fromEntries(DefaultColorStyle.values.map(name => [name, Object.freeze(sampled[name])])))
export const colorPaint = props => Object.hasOwn(LIGHT_PALETTE, props.color) ? LIGHT_PALETTE[props.color] : LIGHT_PALETTE.black

// 2026-11-25 对照运行中的旧版画面测量：便签标签的black为纯黑；
// 标题不随画框颜色改变。阴影为多张合成便签观测的代表值（原画面随ID略变）。
export const NOTE_PAINT = Object.freeze({ text: '#000000', shadowNear: 'rgba(15,23,31,.6)', shadowFar: 'rgba(15,23,31,.4)', shadowInset: 'rgba(15,23,44,.025)' })
export const FRAME_TITLE_PAINT = Object.freeze({ text: '#000000', background: '#f9fafb' })
export const noteLabelPaint = props => props.labelColor === 'black' || !Object.hasOwn(LIGHT_PALETTE, props.labelColor) ? NOTE_PAINT.text : LIGHT_PALETTE[props.labelColor].text
