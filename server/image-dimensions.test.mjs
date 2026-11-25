import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { imageDimensions } from './image-dimensions.mjs'

// 浏览器 Canvas 编码的合成 13×7 图片，覆盖实际 PNG、JPEG 和 WebP 文件。
const fixtures = [
  "iVBORw0KGgoAAAANSUhEUgAAAA0AAAAHCAYAAADTcMcaAAAAH0lEQVR4AezQoREAAACCQM/9h7Y4ARk65RuQ09EQxAAAAP//SeMtfAAAAAZJREFUAwANCwAP2OJBwwAAAABJRU5ErkJggg==",
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAHAA0DASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z",
  "UklGRk4AAABXRUJQVlA4WAoAAAAQAAAADAAABgAAQUxQSA8AAAABBxAREQAIwv+4hYj+pwAAVlA4IBgAAAAwAQCdASoNAAcAAUAmJaQAA3AA/v02aAA="
]

test('常见生图格式按真实像素尺寸插入，坏文件拒绝插入并保留已保存结果', () => {
  for (const data of fixtures) assert.deepEqual(imageDimensions(Buffer.from(data, 'base64')), { w: 13, h: 7 })
  assert.throws(() => imageDimensions(Buffer.from('invalid image')), /图片已保存/)
})
