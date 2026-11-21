import assert from 'node:assert/strict'
import { test } from 'node:test'
import { styleLiterals, addedStyleLiterals } from './style-values.mjs'

test('新增 CSS 尺寸、颜色及 JSX 内联样式必须使用令牌', () => {
  assert.deepEqual(styleLiterals('new.css', '.a{width:12px;color:red;padding:var(--spacing-md)}'), ['color:red', 'width:12px'])
  assert.deepEqual(styleLiterals('New.jsx', 'const C=()=> <div style={{padding:12,color:"#fff",width:"var(--size)"}}/>'), ['color:#fff', 'padding:12'])
})

test('既有样式允许逐步令牌化，不能复制既有字面量扩大例外', () => {
  assert.deepEqual(addedStyleLiterals(['width:12px'], ['width:12px', 'height:12px']), [])
  assert.deepEqual(addedStyleLiterals(['width:12px', 'width:12px'], ['width:12px']), ['width:12px'])
  assert.deepEqual(styleLiterals('User.jsx', 'const shape={x:10,color:"#fff"}; const C=()=> <div/>'), [])
})
