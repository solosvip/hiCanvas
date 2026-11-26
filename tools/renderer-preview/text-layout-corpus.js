// Synthetic regression corpus from the #103 second-round experiment.
export const widthSamples=[
 {kind:'ascii',text:'AV To Wa ffi office 0123456789 !?.,'},
 {kind:'latin-marks',text:'Café e\u0301 Ångström naïve'},
 {kind:'zh',text:'中文汉字，画板测试。「引号」'},
 {kind:'ja-ko',text:'日本語かな 한글 테스트'},
 {kind:'mixed',text:'ASCII 中文 0123 AV 日本語 한글'},
 {kind:'emoji',text:'家👨‍👩‍👧‍👦 😀 e\u0301\uFE0F'},
 {kind:'long',text:('AV To office 中英文混排 日本語かな 한글 0123456789 ').repeat(5)},
]
export const wrapSamples=[
 {kind:'zh-prose',text:'今天在画板上整理设计稿。请把这些文字按顺序排好，再检查：标题、正文、图片和说明是否对齐？这是一段没有空格的中文段落。'},
 {kind:'mixed-prose',text:'设计稿Canvas2026已经更新，第3页有12张图。Please review the latest canvas before saving，确认中文与English words混合时换行合理。'},
 {kind:'punctuation',text:'「第一段（含括号）」。『第二段』，接着是“引号”、数字123和字母ABC；请保留标点。最后一句结束。'},
 {kind:'long-word',text:'Start Supercalifragilisticexpialidocious0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ end 中文结束。'},
 {kind:'kana-prose',text:'今日はキャンバスの文字を確認します。小さいゃゅょっ、句読点「かな」とカタカナを混ぜて表示します。'},
 {kind:'hangul-prose',text:'이것은 캔버스의 한글 줄바꿈 테스트입니다. 가나다라마 한글과 中文 ABC 2026 내용을 함께 표시합니다.'},
 {kind:'emoji-prose',text:'家庭👨‍👩‍👧‍👦和开发者👩‍💻正在检查画板，😀👍🏽❤️一起显示。请不要把一个表情拆成两行。'},
 {kind:'white-space',text:'开头  空格\tAB CD  中文   空格结尾     English repeatedword repeatedword  结束'},
 {kind:'hard-lines',text:'第一行\n\n第二行 ABC 中文\n'},
 {kind:'soft-hyphen',text:'soft\u00adhyphen and averylong\u00adbreakableword 中文文本'},
]

export const textFaces = ['draw', 'sans', 'serif', 'mono'].flatMap(font => [400, 700].flatMap(weight => ['normal', 'italic'].map(style => ({ font, weight, style }))))
export function textLayoutCorpus(measureText, layoutText) {
  const widths = [], wraps = []
  for (const face of textFaces) {
    for (const sample of widthSamples) for (const size of [18, 24, 44]) widths.push({ ...face, kind: sample.kind, size, ...measureText(sample.text, { ...face, size }) })
    const cases = [...[18, 24, 44].map(size => ({ ...widthSamples.find(s => s.kind === 'long'), size })), ...wrapSamples.map(s => ({ ...s, size: 24 }))]
    for (const sample of cases) {
      const layout = layoutText(sample.text, { ...face, size: sample.size, width: 240 })
      wraps.push({ ...face, kind: sample.kind, size: sample.size, lines: layout.lines.map(({ text, width }) => ({ text, width })), unknown: layout.unknown })
    }
  }
  const uncalibrated = textFaces.map(face => ({ ...face,
    measured: measureText('中𞸀中𞸀', { ...face, size: 24 }),
    laidOut: layoutText('中𞸀中𞸀', { ...face, size: 24, width: 240 }).unknown,
  }))
  return { widths, wraps, uncalibrated }
}
