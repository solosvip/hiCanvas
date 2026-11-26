import { setTimeout as delay } from 'node:timers/promises';

// Native menu input only; public legacy preferences and preview state are read.
// This runs before timed phases. Its menu time is excluded from openMs too.
export async function enableStrokeSnapping(contents) {
  const evaluate = source => contents.executeJavaScript(source);
  const read = () => evaluate('window.__cowartEditor ? Boolean(window.__cowartEditor.user.getUserPreferences().isSnapMode) : Boolean(window.__HICANVAS_STROKE_PREVIEW__.getState().snappingPreferences.enabled)');
  if (await read()) return true;
  if (!(await evaluate('Boolean(window.__cowartEditor)'))) throw new Error('新版性能夹具没有开启吸附。');
  async function click(selector, text) {
    const point = await evaluate(`(()=>{const n=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(n=>{const b=n.getBoundingClientRect();return b.width&&b.height&&(${JSON.stringify(text)}===undefined||n.textContent.trim()===${JSON.stringify(text)})});if(!n)throw Error('缺少吸附原生菜单');const b=n.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) contents.sendInputEvent({
      type,
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: 'left',
      clickCount: 1
    });
    await delay(100);
  }
  await click('[data-testid="main-menu.button"]');
  await click('[data-testid="main-menu-sub.preferences-button"]');
  await delay(200);
  await click('[role="menuitemcheckbox"],button,label,span', '始终吸附');
  for (let i = 0; i < 2; i++) for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({
    type,
    keyCode: 'Escape'
  });
  await delay(100);
  if (!(await read())) throw new Error('旧版原生菜单未开启吸附。');
  return true;
}
