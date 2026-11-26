import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// All edits use real Electron pointer/key events. Page script only reads the
// public preview state / DOM, focuses the canvas, or sets the public camera.
export async function snappingSmoke(target, output) {
  const contents = target.webContents,
    samples = [];
  const evaluate = code => contents.executeJavaScript(code);
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()');
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  async function until(predicate, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const s = await state();
      if (s.error || s.lastError) throw new Error(JSON.stringify(s.error || s.lastError));
      if (predicate(s)) return s;
      await delay(20);
    }
    throw new Error(`吸附原生回归超时：${label}；${JSON.stringify(await state())}`);
  }
  let held = false;
  const mouse = async (type, x, y, modifiers = []) => {
    if (type === 'mouseDown') held = true;
    contents.sendInputEvent({
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: 1,
      modifiers: [...modifiers, ...(held && type === 'mouseMove' ? ['leftButtonDown'] : [])]
    });
    if (type === 'mouseUp') held = false;
    await delay(45);
  };
  const click = async (x, y) => {
    await mouse('mouseDown', x, y);
    await mouse('mouseUp', x, y);
  };
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({
      type,
      keyCode,
      modifiers
    });
    await delay(45);
  };
  const moving = s => s.selectedShapes.find(r => r.id === 'shape:moving');
  const guides = s => s.overlays.filter(o => o.kind === 'snap-guides');
  const remember = async label => samples.push({
    label,
    ...(await state())
  });
  async function load(mode = 'move', zoom = 1, enabled = true) {
    const url = new URL(contents.getURL());
    url.search = `?gallery=snapping&snapCase=${mode}&snapping=${Number(enabled)}&edgeScrolling=0`;
    await target.loadURL(url.href);
    await until(s => s.ready, '就绪');
    await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:${zoom}});document.querySelector('#canvas').focus();void 0`);
    await delay(60);
    check((await state()).snappingPreferences.enabled === enabled, '吸附偏好没有传到会话');
  }
  const pump = setInterval(() => contents.invalidate(), 30);
  let attached = false;
  try {
    contents.debugger.attach('1.3');
    attached = true;
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    });
    const overlayContract = await evaluate("import('/tools/renderer-preview/snapping-probe.js').then(module=>module.snappingOverlayProbe())");
    for (const zoom of [.5, 1, 2]) for (const offset of [8, 9]) {
      await load('move', zoom);
      await mouse('mouseDown', 460 * zoom, 345 * zoom);
      await mouse('mouseMove', 330 * zoom + offset, 345 * zoom);
      let s = await until(s => s.mode === 'dragging', '开始移动');
      check(Math.abs(moving(s).x - (offset === 8 ? 300 : 300 + offset / zoom)) < 1e-6, `移动阈值错误：${zoom}/${offset}`);
      check(Boolean(guides(s).length) === (offset === 8), '移动提示线与吸附状态不符');
      if (offset === 8) {
        const visual = await evaluate("Array.from(document.querySelectorAll('[data-snap-guide]'),n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);return{thickness:Math.min(b.width,b.height),color:s.backgroundColor,pointer:s.pointerEvents}})");
        check(visual.length > 0 && visual.every(v => Math.abs(v.thickness - 1) < .05 && v.color === 'rgb(194, 65, 12)' && v.pointer === 'none'), `提示线屏幕线宽或令牌色错误：${JSON.stringify(visual)}`);
        check((await evaluate("document.querySelectorAll('[data-snap-marker]').length")) > 0, '缺少叉形锚点');
        await writeFile(join(output, `move-${zoom}.png`), (await contents.capturePage()).toPNG());
      }
      await mouse('mouseUp', 330 * zoom + offset, 345 * zoom);
      s = await until(s => s.revision === '1', '移动保存');
      check(!guides(s).length && (await evaluate("document.querySelectorAll('[data-snap-guide]').length")) === 0, '松手后提示线未清理');
      await key('Z', ['meta']);
      s = await until(s => s.revision === '2', '整次撤销');
      check(moving(s).x === 430, '吸附移动未整次撤销');
      await remember(`move-${zoom}-${offset}-save-undo`);
    }
    await load();
    await mouse('mouseDown', 460, 345);
    await mouse('mouseMove', 333, 345);
    check(moving(await state()).x === 300, '修饰键前没有吸附');
    contents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'Meta',
      modifiers: ['meta']
    });
    await delay(60);
    check(moving(await state()).x === 303, '原生Command按下未临时反转');
    contents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'Meta',
      modifiers: []
    });
    await delay(60);
    check(moving(await state()).x === 300, '原生Command释放未恢复吸附');
    await key('Escape');
    await mouse('mouseUp', 333, 345);
    check(moving(await state()).x === 430 && (await state()).revision === '0' && !guides(await state()).length, '取消未恢复对象或清理提示线');
    await remember('modifier-live-cancel');
    await load('move', 1, false);
    await mouse('mouseDown', 460, 345);
    await mouse('mouseMove', 333, 345);
    check(moving(await state()).x === 303, '关闭偏好仍吸附');
    await mouse('mouseMove', 333, 345, ['meta']);
    check(moving(await state()).x === 300, '关闭偏好时Command未临时启用');
    await key('Escape');
    await mouse('mouseUp', 333, 345);
    await remember('disabled-inversion');
    await load('gap');
    await mouse('mouseDown', 740, 390);
    await mouse('mouseMove', 603, 280);
    let s = await state();
    check(moving(s).x === 560 && moving(s).y === 240, '等间距或行对齐错误');
    check(guides(s).some(g => g.lines.some(l => l.gap)) && (await evaluate("document.querySelectorAll('[data-snap-tick]').length")) >= 2, '缺少等间距测量线或中点刻度');
    await writeFile(join(output, 'equal-gap.png'), (await contents.capturePage()).toPNG());
    await mouse('mouseUp', 603, 280);
    await until(s => s.revision === '1', '等间距保存');
    await remember('equal-gap');
    for (const zoom of [.5, 1, 2]) for (const offset of [8, 9]) {
      await load('resize', zoom);
      await click(175 * zoom, 230 * zoom);
      await mouse('mouseDown', 250 * zoom, 230 * zoom);
      await mouse('mouseMove', 380 * zoom + offset, 230 * zoom);
      s = await state();
      check(Math.abs(moving(s).w - (offset === 8 ? 280 : 280 + offset / zoom)) < 1e-6, `缩放阈值错误：${zoom}/${offset}`);
      await mouse('mouseUp', 380 * zoom + offset, 230 * zoom);
      await until(s => s.revision === '1', '缩放保存');
      check(!guides(await state()).length, '缩放保存残留提示线');
      await key('Z', ['meta']);
      s = await until(s => s.revision === '2', '缩放整次撤销');
      check(moving(s).w === 150, '缩放未整次撤销');
      await remember(`resize-${zoom}-${offset}-save-undo`);
    }
    await writeFile(join(output, 'snapping.json'), JSON.stringify({
      samples,
      nativeInput: true
    }, null, 2));
    return {
      cases: samples.map(s => s.label),
      overlayContract,
      nativeInput: true
    };
  } finally {
    clearInterval(pump);
    if (attached && contents.debugger.isAttached()) contents.debugger.detach();
  }
}
