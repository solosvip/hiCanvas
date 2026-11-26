import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

// 2026-11-26 isolated synthetic legacy canvas, offscreen Chromium native right
// click → arrange submenu → pack. Public reads captured before/after/undo/redo;
// no legacy implementation or direct call to its packing method was used.
// Each input is [id,x,y,w,h,rotation]; expected lists [x,y] in creation order.
// Equal-size reverse-selection/creation and width 169/170 samples distinguish
// the tie order and row boundary. Zoom and doubled sizes keep a world gap of 10.
const observations = [
  {"name":"issue-three","input":[["shape:a",100,100,100,80,0],["shape:b",330,190,80,120,0],["shape:c",620,360,60,40,0]],"expected":[[340,170],[340,260],[340,120]]},
  {"name":"zoom-half","input":[["shape:a",100,100,100,80,0],["shape:b",330,190,80,120,0],["shape:c",620,360,60,40,0]],"expected":[[340,170],[340,260],[340,120]]},
  {"name":"zoom-double","input":[["shape:a",100,100,100,80,0],["shape:b",330,190,80,120,0],["shape:c",620,360,60,40,0]],"expected":[[340,170],[340,260],[340,120]]},
  {"name":"double-shape-size","input":[["shape:a",100,100,200,160,0],["shape:b",330,190,160,240,0],["shape:c",620,360,120,80,0]],"expected":[[320,110],[320,280],[320,20]]},
  {"name":"current-actions-gallery","input":[["shape:a",100,200,100,80,0],["shape:b",330,250,80,120,0],["shape:c",620,400,60,40,0]],"expected":[[340,240],[340,330],[340,190]]},
  {"name":"equal-two","input":[["shape:a",120,180,100,80,0],["shape:b",510,400,100,80,0]],"expected":[[260,290],[370,290]]},
  {"name":"equal-four-grid","input":[["shape:a",100,150,80,60,0],["shape:b",400,150,80,60,0],["shape:c",100,450,80,60,0],["shape:d",400,450,80,60,0]],"expected":[[115,300],[205,300],[295,300],[385,300]]},
  {"name":"equal-five-rows","input":[["shape:a",100,150,80,60,0],["shape:b",400,150,80,60,0],["shape:c",100,450,80,60,0],["shape:d",400,450,80,60,0],["shape:e",250,300,80,60,0]],"expected":[[115,265],[205,265],[295,265],[385,265],[115,335]]},
  {"name":"mixed-six","input":[["shape:a",100,100,120,40,0],["shape:b",300,100,60,160,0],["shape:c",500,100,160,80,0],["shape:d",100,400,60,60,0],["shape:e",300,400,90,110,0],["shape:f",500,400,20,40,0]],"expected":[[330,60],[300,390],[300,180],[300,110],[300,270],[300,60]]},
  {"name":"overlap-four","input":[["shape:a",200,200,140,100,0],["shape:b",220,220,60,80,0],["shape:c",210,210,100,40,0],["shape:d",190,230,40,120,0]],"expected":[[195,230],[195,140],[195,90],[195,340]]},
  {"name":"rotated-three","input":[["shape:a",100,200,100,80,0.5235987755982988],["shape:b",330,290,80,120,-0.7853981633974483],["shape:c",620,460,60,40,1.5707963267948966]],"expected":[[309.28932188134524,259.6483057299677],[269.28932188134524,445.4988805276466],[309.28932188134524,189.64830572996772]]},
  {"name":"negative-translation","input":[["shape:a",-450,-200,100,80,0],["shape:b",-220,-110,80,120,0],["shape:c",70,60,60,40,0]],"expected":[[-210,-130],[-210,-40],[-210,-180]]},
  {"name":"reversed-positions","input":[["shape:a",620,360,100,80,0],["shape:b",330,190,80,120,0],["shape:c",100,100,60,40,0]],"expected":[[360,190],[360,280],[360,140]]},
  {"name":"reversed-selection","input":[["shape:a",100,150,80,60,0],["shape:b",400,150,80,60,0],["shape:c",100,450,80,60,0],["shape:d",400,450,80,60,0]],"expected":[[385,300],[295,300],[205,300],[115,300]],"selected":["shape:d","shape:c","shape:b","shape:a"]},
  {"name":"reversed-creation","input":[["shape:d",400,450,80,60,0],["shape:c",100,450,80,60,0],["shape:b",400,150,80,60,0],["shape:a",100,150,80,60,0]],"expected":[[385,300],[295,300],[205,300],[115,300]],"selected":["shape:a","shape:b","shape:c","shape:d"]},
  {"name":"same-height-two","input":[["shape:a",100,100,160,80,0],["shape:b",500,300,40,80,0]],"expected":[[265,200],[215,200]]},
  {"name":"cross-aspect-two","input":[["shape:a",100,100,40,160,0],["shape:b",400,400,200,30,0]],"expected":[[250,205],[250,165]]},
  {"name":"wide-three","input":[["shape:a",100,100,240,40,0],["shape:b",450,200,200,30,0],["shape:c",700,400,160,20,0]],"expected":[[360,275],[360,235],[360,205]]},
  {"name":"tall-three","input":[["shape:a",100,100,30,240,0],["shape:b",450,200,40,200,0],["shape:c",700,400,20,160,0]],"expected":[[390,400],[390,190],[390,20]]},
  {"name":"equal-nine-grid","input":[["shape:a",100,100,80,60,0],["shape:b",320,100,80,60,0],["shape:c",540,100,80,60,0],["shape:d",100,280,80,60,0],["shape:e",320,280,80,60,0],["shape:f",540,280,80,60,0],["shape:g",100,460,80,60,0],["shape:h",320,460,80,60,0],["shape:i",540,460,80,60,0]],"expected":[[140,245],[230,245],[320,245],[410,245],[500,245],[140,315],[230,315],[320,315],[410,315]]},
  {"name":"equal-four-overlap","input":[["shape:a",100,100,80,60,0],["shape:b",100,100,80,60,0],["shape:c",100,100,80,60,0],["shape:d",100,100,80,60,0]],"expected":[[100,-5],[100,65],[100,135],[100,205]]},
  {"name":"equal-four-width-169","input":[["shape:a",100,100,80,60,0],["shape:b",189,100,80,60,0],["shape:c",100,300,80,60,0],["shape:d",189,300,80,60,0]],"expected":[[144.5,95],[144.5,165],[144.5,235],[144.5,305]]},
  {"name":"equal-four-width-170","input":[["shape:a",100,100,80,60,0],["shape:b",190,100,80,60,0],["shape:c",100,300,80,60,0],["shape:d",190,300,80,60,0]],"expected":[[100,165],[190,165],[100,235],[190,235]]},
  {"name":"equal-four-width-179","input":[["shape:a",100,100,80,60,0],["shape:b",199,100,80,60,0],["shape:c",100,300,80,60,0],["shape:d",199,300,80,60,0]],"expected":[[104.5,165],[194.5,165],[104.5,235],[194.5,235]]},
  {"name":"equal-four-width-180","input":[["shape:a",100,100,80,60,0],["shape:b",200,100,80,60,0],["shape:c",100,300,80,60,0],["shape:d",200,300,80,60,0]],"expected":[[105,165],[195,165],[105,235],[195,235]]},
  {"name":"equal-four-width-181","input":[["shape:a",100,100,80,60,0],["shape:b",201,100,80,60,0],["shape:c",100,300,80,60,0],["shape:d",201,300,80,60,0]],"expected":[[105.5,165],[195.5,165],[105.5,235],[195.5,235]]},
  {"name":"same-height-two-touching","input":[["shape:a",100,100,160,80,0],["shape:b",260,100,40,80,0]],"expected":[[120,145],[120,55]]},
  {"name":"nearly-equal-heights","input":[["shape:a",100,100,80,60,0],["shape:b",500,100,80,61,0],["shape:c",900,100,80,62,0]],"expected":[[500,29.5],[500,99.5],[500,170.5]]},
]
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`)
const make = input => executeCanvasCommands(createCanvasSnapshot(), input.map(([id, x, y, w, h, rotation = 0]) => ({ type: 'create_shape', id, shapeType: 'geo', x, y, rotation, props: { w, h, fill: 'solid', color: 'blue' } }))).snapshot

for (const { name, input, expected, selected } of observations) test(`紧凑排布旧版原生菜单读数：${name}`, () => {
  const initial = make(input), original = structuredClone(initial)
  const command = { type: 'pack_shapes', ids: selected || input.map(([id]) => id), gap: 10 }
  const result = executeCanvasCommands(initial, [command])
  input.forEach(([id], i) => {
    const record = result.snapshot.store[id]
    close(record.x, expected[i][0]); close(record.y, expected[i][1])
    for (const key of ['props', 'rotation', 'parentId', 'index']) assert.deepEqual(record[key], initial.store[id][key])
  })
  assert.deepEqual(initial, original)
  assert.deepEqual(result.results[0].shapeIds.toSorted(), Object.keys(result.changes.updated).sort())
  assert.deepEqual(result.changes.added, {}); assert.deepEqual(result.changes.removed, {})
  const history = recordCanvasTransaction(undefined, 'pack-observation', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'pack-observation')
  assert.deepEqual(undone.snapshot, initial)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'pack-observation').snapshot, result.snapshot)
  const repeat = executeCanvasCommands(result.snapshot, [command])
  assert.deepEqual(repeat.changes.updated, {}); assert.deepEqual(repeat.results, [{ shapeIds: [] }])
})

test('紧凑排布保留gap默认16及显式0，非法间距不污染输入', () => {
  const initial = make([['shape:a', 0, 0, 100, 80], ['shape:b', 400, 200, 100, 80]]), original = structuredClone(initial)
  const command = { type: 'pack_shapes', ids: ['shape:a', 'shape:b'] }
  const implicit = executeCanvasCommands(initial, [command])
  assert.deepEqual(implicit, executeCanvasCommands(initial, [{ ...command, gap: 16 }]))
  close(implicit.snapshot.store['shape:a'].x, 142); close(implicit.snapshot.store['shape:b'].x, 258)
  close(implicit.snapshot.store['shape:a'].y, 100); close(implicit.snapshot.store['shape:b'].y, 100)
  const touching = executeCanvasCommands(initial, [{ ...command, gap: 0 }]).snapshot
  close(touching.store['shape:b'].x - touching.store['shape:a'].x, 100)
  for (const gap of [-1, Infinity, NaN, '10']) assert.throws(() => executeCanvasCommands(initial, [{ ...command, gap }]))
  assert.deepEqual(initial, original)
})
