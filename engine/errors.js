export class CanvasEditError extends Error {
  // 输入错误与记录冲突由宿主分别翻译，编辑层不携带 HTTP 状态。
  constructor(message, code = 'invalid-input', options) {
    super(message, options)
    this.name = 'CanvasEditError'
    this.code = code
  }
}
