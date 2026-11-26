import { createCanvasSnapshot } from '../../model/index.js';
import { executeCanvasCommands } from '../../engine/index.js';
export function createSnappingFixture(mode) {
  const rectangle = (id, x, y, w, h) => ({
    type: 'create_shape',
    id,
    shapeType: 'geo',
    x,
    y,
    props: {
      w,
      h,
      fill: 'solid'
    }
  });
  const commands = mode === 'resize' ? [rectangle('shape:moving', 100, 180, 150, 100), rectangle('shape:fixed', 380, 180, 90, 100)] : mode === 'gap' ? [rectangle('shape:a', 200, 240, 80, 80), rectangle('shape:b', 380, 240, 80, 80), rectangle('shape:moving', 700, 350, 80, 80)] : [rectangle('shape:fixed', 200, 200, 100, 80), rectangle('shape:moving', 430, 320, 60, 50)];
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot;
  const currentPageId = Object.values(snapshot.store).find(record => record.typeName === 'page').id;
  return {
    snapshot,
    count: commands.length,
    counts: {
      geo: commands.length
    },
    assetCount: 0,
    viewState: {
      currentPageId,
      camera: {
        x: 0,
        y: 0,
        z: 1
      }
    }
  };
}
