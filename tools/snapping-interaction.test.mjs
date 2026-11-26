import './test-sandbox.mjs';
import './renderer-test-fonts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { creationFixture, rectangle, commands, moving } from './snapping-test-fixture.mjs';
test('原生旧版8 CSS px边界：移动对齐对象边缘、只提交一次并整次撤销', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: commands()
  });
  try {
    f.pointer('down', 460, 345);
    f.pointer('move', 338, 345);
    assert.equal(moving(f).x, 300);
    assert.equal(f.commits.length, 0);
    const guide = f.interaction.state.get().overlays.find(o => o.kind === 'snap-guides');
    assert.ok(guide?.lines.length);
    await f.pointer('up', 338, 345);
    assert.equal(f.shapes().find(s => s.id === 'shape:moving').x, 300);
    assert.equal(f.commits.length, 1);
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'snap-guides'), false);
    await f.session.undo();
    assert.equal(f.shapes().find(s => s.id === 'shape:moving').x, 430);
  } finally {
    f.close();
  }
});
for (const zoom of [.5, 1, 2]) for (const offset of [7.99, 8, 8.01]) test(`边界${offset} CSS px，视角${zoom}不改变吸附半径`, async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    camera: {
      x: 0,
      y: 0,
      z: zoom
    },
    commands: commands()
  });
  try {
    f.pointer('down', 460 * zoom, 345 * zoom);
    f.pointer('move', 330 * zoom + offset, 345 * zoom);
    assert.ok(Math.abs(moving(f).x - (offset <= 8 ? 300 : 300 + offset / zoom)) < 1e-7);
    await f.key('Escape');
    assert.equal(f.commits.length, 0);
    assert.equal(moving(f).x, 430);
  } finally {
    f.close();
  }
});
test('等间距延续：移动到第三个等宽对象的邻位，同时对齐行', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:a', 200, 240, 80, 80), rectangle('shape:b', 380, 240, 80, 80), rectangle('shape:moving', 700, 350, 80, 80)]
  });
  try {
    f.pointer('down', 740, 390);
    f.pointer('move', 603, 280);
    assert.deepEqual([moving(f).x, moving(f).y], [560, 240]);
    assert.ok(f.interaction.state.get().overlays.find(o => o.kind === 'snap-guides').lines.some(line => line.gap));
    await f.pointer('up', 603, 280);
    assert.equal(f.commits.length, 1);
  } finally {
    f.close();
  }
});
test('等间距参照只需在另一轴相交，不要求细参照穿过所选对象的三条锚线', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:a', 200, 300, 80, 10), rectangle('shape:b', 380, 300, 80, 10), rectangle('shape:moving', 700, 250, 80, 200)]
  });
  try {
    f.pointer('down', 740, 350);
    f.pointer('move', 603, 350);
    assert.deepEqual([moving(f).x, moving(f).y], [560, 250]);
  } finally {
    f.close();
  }
});


test('Shift轴锁不能被另一轴的吸附位置破坏', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:fixed', 200, 325, 100, 50), rectangle('shape:moving', 430, 320, 60, 50)]
  });
  try {
    f.pointer('down', 460, 345);
    f.pointer('move', 333, 347, {
      shiftKey: true
    });
    assert.deepEqual([moving(f).x, moving(f).y], [300, 320]);
  } finally {
    f.close();
  }
});

test('缩放边缘沿用8px边界，保存吸附尺寸且整次撤销', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:moving', 100, 180, 150, 100), rectangle('shape:fixed', 380, 180, 90, 100)]
  });
  try {
    await f.click(175, 230);
    f.pointer('down', 250, 230);
    f.pointer('move', 388, 230);
    assert.equal(moving(f).props.w, 280);
    assert.ok(f.interaction.state.get().overlays.some(o => o.kind === 'snap-guides'));
    await f.pointer('up', 388, 230);
    assert.equal(f.commits.length, 1);
    await f.session.undo();
    assert.equal(moving(f).props.w, 150);
  } finally {
    f.close();
  }
});
test('缩放中间对象使两侧间距相等，固定对边保持原位', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:a', 100, 100, 80, 80), rectangle('shape:b', 500, 100, 80, 80), rectangle('shape:moving', 280, 100, 100, 80)]
  });
  try {
    await f.click(330, 140);
    f.pointer('down', 380, 140);
    f.pointer('move', 403, 140);
    assert.deepEqual([moving(f).x, moving(f).props.w], [280, 120]);
    assert.ok(f.interaction.state.get().overlays.find(o => o.kind === 'snap-guides').lines.some(l => l.gap));
    await f.pointer('up', 403, 140);
    assert.equal(f.commits.length, 1);
  } finally {
    f.close();
  }
});
for (const vertical of [false, true]) for (const [name, a, b, source, raw, expected] of [['before', 380, 560, 100, 203, 200], ['between', 100, 500, 700, 303, 300]]) test(`${vertical ? '竖向' : '横向'}${name}等间距`, async () => {
  const rect = (id, p, q) => rectangle(id, vertical ? q : p, vertical ? p : q, 80, 80);
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rect('shape:a', a, 240), rect('shape:b', b, 240), rect('shape:moving', source, 350)]
  });
  try {
    f.pointer('down', vertical ? 390 : source + 40, vertical ? source + 40 : 390);
    f.pointer('move', vertical ? 280 : raw + 40, vertical ? raw + 40 : 280);
    assert.deepEqual([moving(f).x, moving(f).y], vertical ? [240, expected] : [expected, 240]);
  } finally {
    f.close();
  }
});
test('中心对齐与同时对齐两轴，覆盖层纯数据不能被宿主篡改', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: commands()
  });
  try {
    f.pointer('down', 460, 345);
    f.pointer('move', 253, 242);
    assert.deepEqual([moving(f).x, moving(f).y], [220, 215]);
    const guide = f.interaction.state.get().overlays.find(o => o.kind === 'snap-guides');
    assert.throws(() => guide.lines[0].points[0].x = 900, TypeError);
    assert.throws(() => guide.lines.push({}), TypeError);
    assert.equal(JSON.stringify(guide).includes('function'), false);
  } finally {
    f.close();
  }
});
test('选中多对象以共同外框吸附，不把组内互相吸附；锁定目标仍可作对齐参照', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:fixed', 200, 200, 100, 80), {
      type: 'update',
      id: 'shape:fixed',
      changes: {
        isLocked: true
      }
    }, rectangle('shape:moving', 500, 320, 60, 50), rectangle('shape:second', 580, 320, 60, 50)]
  });
  try {
    f.interaction.select('all');
    f.pointer('down', 530, 345);
    f.pointer('move', 333, 345);
    assert.equal(moving(f).x, 300);
    assert.equal(f.session.store.get('shape:second').x, 380);
    await f.pointer('up', 333, 345);
    assert.equal(f.commits.length, 1);
  } finally {
    f.close();
  }
});
test('远端参照变化实时生效；吸附不新增整板读取或复制快照', async () => {
  const scans = [];
  for (const enabled of [false, true]) {
    const f = await creationFixture({
      snapping: {
        enabled
      },
      commands: commands()
    });
    try {
      f.pointer('down', 460, 345);
      f.pointer('move', 333, 345);
      await f.remote([{
        type: 'update',
        id: 'shape:fixed',
        changes: {
          x: 205
        }
      }]);
      const all = f.session.store.allRecords,
        snapshot = f.session.store.getStoreSnapshot;
      let reads = 0;
      // The command runtime still validates relationships once per frame. Compare
      // against that existing cost: the new snapping calculator must not add scans.
      f.session.store.allRecords = (...args) => {
        reads++;
        return all.apply(f.session.store, args);
      };
      f.session.store.getStoreSnapshot = () => {
        throw Error('pointer read snapshot');
      };
      try {
        f.pointer('move', 333, 345);
        assert.equal(f.session.store.get('shape:moving').x, enabled ? 305 : 303);
        scans.push(reads);
      } finally {
        f.session.store.allRecords = all;
        f.session.store.getStoreSnapshot = snapshot;
      }
    } finally {
      f.close();
    }
  }
  assert.equal(scans[1], scans[0]);
});
for (const [label, mods, expected] of [['Alt', {
  altKey: true
}, [-30, 410, 100]], ['Shift', {
  shiftKey: true
}, [100, 280, 280 / 1.5]]]) test(`${label}缩放保留中心/比例并吸附，Mod静止反转后取消恢复`, async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:moving', 100, 180, 150, 100), rectangle('shape:fixed', 380, 180, 90, 100)]
  });
  try {
    await f.click(175, 230);
    f.pointer('down', 250, 280);
    f.pointer('move', 383, 280, mods);
    for (const [actual, wanted] of [[moving(f).x, expected[0]], [moving(f).props.w, expected[1]], [moving(f).props.h, expected[2]]]) assert.ok(Math.abs(actual - wanted) < 1e-7);
    await f.key('Meta', {
      ...mods,
      metaKey: true
    });
    assert.notEqual(moving(f).props.w, expected[1]);
    await f.key('Meta', mods, 'key_up');
    assert.ok(Math.abs(moving(f).props.w - expected[1]) < 1e-7);
    await f.key('Escape');
    assert.equal(moving(f).props.w, 150);
    assert.equal(f.commits.length, 0);
  } finally {
    f.close();
  }
});
for (const zoom of [.5, 1, 2]) for (const offset of [8, 8.01]) test(`缩放${zoom}倍下${offset} CSS px包含边界`, async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    camera: {
      x: 0,
      y: 0,
      z: zoom
    },
    commands: [rectangle('shape:moving', 100, 180, 150, 100), rectangle('shape:fixed', 380, 180, 90, 100)]
  });
  try {
    await f.click(175 * zoom, 230 * zoom);
    f.pointer('down', 250 * zoom, 230 * zoom);
    f.pointer('move', 380 * zoom + offset, 230 * zoom);
    assert.ok(Math.abs(moving(f).props.w - (offset === 8 ? 280 : 280 + offset / zoom)) < 1e-7);
  } finally {
    f.close();
  }
});
for (const reason of ['pointer_cancel', 'tool']) test(`${reason}结束移动会清理吸附和预览而不保存`, async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: commands()
  });
  try {
    f.pointer('down', 460, 345);
    f.pointer('move', 333, 345);
    assert.equal(moving(f).x, 300);
    if (reason === 'tool') f.interaction.setTool('hand');else f.interaction.dispatch({
      type: reason,
      time: 100,
      pointerId: 1
    });
    assert.equal(moving(f).x, 430);
    assert.equal(f.commits.length, 0);
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'snap-guides'), false);
  } finally {
    f.close();
  }
});
test('隐藏与完全裁掉的对象不作参照；远端删除参照后不保留旧吸附', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [...commands(), rectangle('shape:hidden', 205, 200, 100, 80), {
      type: 'update',
      id: 'shape:hidden',
      changes: {
        opacity: 0
      }
    }, {
      type: 'create_shape',
      id: 'shape:frame',
      shapeType: 'frame',
      x: 600,
      y: 50,
      props: {
        w: 100,
        h: 100
      }
    }, rectangle('shape:clipped', -395, 150, 100, 80, {
      parentId: 'shape:frame'
    })]
  });
  try {
    f.pointer('down', 460, 345);
    f.pointer('move', 337, 345);
    assert.equal(moving(f).x, 300);
    await f.remote([{
      type: 'delete',
      ids: ['shape:fixed']
    }]);
    f.pointer('move', 337, 345);
    assert.equal(moving(f).x, 307);
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'snap-guides'), false);
  } finally {
    f.close();
  }
});
test('组按共同外框移动，组内子对象不参与互吸', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: [rectangle('shape:fixed', 200, 200, 100, 80), rectangle('shape:moving', 500, 320, 60, 50), rectangle('shape:second', 580, 320, 60, 50), {
      type: 'group_shapes',
      ids: ['shape:moving', 'shape:second'],
      groupId: 'shape:g'
    }]
  });
  try {
    f.pointer('down', 530, 345);
    f.pointer('move', 333, 345);
    assert.equal(f.session.store.get('shape:g').x, 300);
    await f.pointer('up', 333, 345);
    assert.equal(f.commits.length, 1);
    await f.session.undo();
    assert.equal(f.session.store.get('shape:g').x, 500);
  } finally {
    f.close();
  }
});
test('远端改动拖动对象时冲突取消，本地提示线清理且远端值保留', async () => {
  const f = await creationFixture({
    snapping: {
      enabled: true
    },
    commands: commands()
  });
  try {
    f.pointer('down', 460, 345);
    f.pointer('move', 333, 345);
    await f.remote([{
      type: 'update',
      id: 'shape:moving',
      changes: {
        x: 800
      }
    }]);
    assert.throws(() => f.pointer('move', 334, 345), /取消|冲突/);
    assert.equal(moving(f).x, 800);
    assert.equal(f.commits.length, 0);
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'snap-guides'), false);
  } finally {
    f.close();
  }
});

test('四分之一旋转的边柄按页面轴吸附，保持旋转与固定边',async()=>{
 const f=await creationFixture({snapping:{enabled:true},commands:[rectangle('shape:moving',400,200,150,100,{rotation:Math.PI/2}),rectangle('shape:fixed',500,380,100,80)]})
 try{
  await f.click(350,275);f.pointer('down',350,350);f.pointer('move',350,383)
  assert.ok(Math.abs(moving(f).props.w-180)<1e-6)
  assert.ok(Math.abs(moving(f).rotation-Math.PI/2)<1e-6)
  assert.deepEqual([moving(f).x,moving(f).y],[400,200])
 }finally{f.close()}
})

test('等比角柄恰好位于两轴主导切换处仍能吸附',async()=>{
 const f=await creationFixture({snapping:{enabled:true},commands:[rectangle('shape:moving',100,100,100,100),rectangle('shape:fixed',303,450,100,100)]})
 try{
  await f.click(150,150);f.pointer('down',200,200);f.pointer('move',300,300,{shiftKey:true})
  assert.ok(Math.abs(moving(f).props.w-203)<1e-6)
  assert.ok(Math.abs(moving(f).props.h-203)<1e-6)
 }finally{f.close()}
})

test('另一行的窄对象不能打断当前行的等间距参照',async()=>{
 const f=await creationFixture({snapping:{enabled:true},commands:[rectangle('shape:a',200,300,80,10),rectangle('shape:b',380,300,80,10),rectangle('shape:other-row',300,400,10,10),rectangle('shape:moving',700,250,80,200)]})
 try{f.pointer('down',740,350);f.pointer('move',603,350);assert.equal(moving(f).x,560)}finally{f.close()}
})

test('反射后的等比缩放在负倍率切换处仍按活动角吸附',async()=>{
 const f=await creationFixture({snapping:{enabled:true},commands:[rectangle('shape:moving',100,100,100,100),rectangle('shape:fixed',47,400,100,100)]})
 try{
  await f.click(150,150);f.pointer('down',200,200);f.pointer('move',50,50,{shiftKey:true})
  assert.deepEqual([moving(f).x,moving(f).y,moving(f).props.w,moving(f).props.h],[47,47,53,53])
 }finally{f.close()}
})

test('两张上下贴合的中间对象不会在接缝处制造虚假等间距',async()=>{
 const f=await creationFixture({snapping:{enabled:true},commands:[rectangle('shape:a',200,300,80,100),rectangle('shape:b',380,300,80,100),rectangle('shape:c',300,300,20,50),rectangle('shape:d',300,350,20,50),rectangle('shape:moving',700,300,80,100)]})
 try{f.pointer('down',740,350);f.pointer('move',603,350);assert.equal(moving(f).x,563)}finally{f.close()}
})

test('画框裁掉的隐藏边不参与吸附，保留未吸附指针位置',async()=>{
 const f=await creationFixture({snapping:{enabled:true},commands:[{type:'create_shape',id:'shape:frame',shapeType:'frame',x:250,y:190,props:{w:100,h:100}},rectangle('shape:child',-45,10,100,80,{parentId:'shape:frame'}),rectangle('shape:moving',430,350,60,50)]})
 try{f.pointer('down',460,375);f.pointer('move',238,275);assert.equal(moving(f).x,208)}finally{f.close()}
})
