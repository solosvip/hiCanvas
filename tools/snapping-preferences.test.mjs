import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture, rectangle, commands, moving } from './snapping-test-fixture.mjs'

test('宿主改偏好重算时遇远端冲突，同样取消预览并清理提示线',async()=>{
 const f=await creationFixture({snapping:{enabled:true},commands:commands()})
 try{
  f.pointer('down',460,345);f.pointer('move',333,345)
  await f.remote([{type:'update',id:'shape:moving',changes:{x:800}}])
  assert.throws(()=>f.interaction.setSnappingPreferences({enabled:false}),/取消|冲突/)
  assert.equal(moving(f).x,800);assert.equal(f.commits.length,0)
  assert.equal(f.interaction.state.get().overlays.some(o=>o.kind==='snap-guides'),false)
 }finally{f.close()}
})

test('吸附偏好是宿主会话状态，复制输入、校验原子性、不写画板或撤销', async () => {
  const options = {
      enabled: false
    },
    f = await creationFixture({
      snapping: options,
      commands: commands()
    });
  try {
    const before = JSON.stringify(f.current());
    options.enabled = true;
    assert.deepEqual(f.interaction.getSnappingPreferences(), {
      enabled: false,
      controlPoints: false
    });
    f.interaction.setSnappingPreferences({
      enabled: true,
      controlPoints: true
    });
    assert.deepEqual(f.interaction.state.get().snappingPreferences, {
      enabled: true,
      controlPoints: true
    });
    assert.ok(Object.isFrozen(f.interaction.getSnappingPreferences()));
    assert.throws(() => f.interaction.setSnappingPreferences({
      enabled: false,
      grid: true
    }), /吸附/);
    assert.equal(f.interaction.getSnappingPreferences().enabled, true);
    assert.throws(() => f.interaction.setSnappingPreferences({
      enabled: 1
    }), /吸附/);
    assert.equal(JSON.stringify(f.current()), before);
    assert.equal(f.commits.length, 0);
  } finally {
    f.close();
  }
});

test('Meta按下/释放和宿主改偏好在静止拖动中实时反转，取消不提交', async () => {
  const f = await creationFixture({
    commands: commands()
  });
  try {
    f.pointer('down', 460, 345);
    f.pointer('move', 333, 345);
    assert.equal(moving(f).x, 303);
    await f.key('Meta', {
      metaKey: true
    });
    assert.equal(moving(f).x, 300);
    await f.key('Meta', {}, 'key_up');
    assert.equal(moving(f).x, 303);
    f.interaction.setSnappingPreferences({
      enabled: true
    });
    assert.equal(moving(f).x, 300);
    f.interaction.setSnappingPreferences({
      enabled: false
    });
    assert.equal(moving(f).x, 303);
    await f.key('Escape');
    assert.equal(moving(f).x, 430);
    assert.equal(f.commits.length, 0);
  } finally {
    f.close();
  }
});

test('宿主可显式选Control为主修饰键，默认Mac的Control不反转对象偏好', async () => {
  for (const snapModifier of ['meta', 'control']) {
    const f = await creationFixture({
      snapModifier,
      commands: commands()
    });
    try {
      f.pointer('down', 460, 345);
      f.pointer('move', 333, 345, {
        ctrlKey: true
      });
      assert.equal(moving(f).x, snapModifier === 'control' ? 300 : 303);
    } finally {
      f.close();
    }
  }
});

test('统一入口动态控制既有控制点偏好，Ctrl反转与取消继续沿用原行为', async () => {
  const f = await creationFixture({
    commands: [rectangle('shape:fixed', 600, 200, 150, 150), {
      type: 'create_shape',
      id: 'shape:arrow',
      shapeType: 'arrow',
      x: 200,
      y: 450,
      props: {
        end: {
          x: 400,
          y: 0
        }
      }
    }]
  });
  try {
    f.interaction.setSnappingPreferences({
      controlPoints: true
    });
    await f.click(350, 450);
    f.pointer('down', 600, 450);
    f.pointer('move', 597, 270);
    assert.equal(f.session.store.get('shape:arrow').props.end.x, 400);
    assert.ok(f.interaction.state.get().overlays.some(o => o.kind === 'snap'));
    f.interaction.setSnappingPreferences({
      controlPoints: false
    });
    assert.equal(f.session.store.get('shape:arrow').props.end.x, 397);
    await f.key('Control', {
      ctrlKey: true
    });
    assert.equal(f.session.store.get('shape:arrow').props.end.x, 400);
    await f.key('Escape');
    assert.equal(f.commits.length, 0);
    assert.equal(f.interaction.state.get().overlays.some(o => ['snap', 'snap-guides'].includes(o.kind)), false);
  } finally {
    f.close();
  }
});
