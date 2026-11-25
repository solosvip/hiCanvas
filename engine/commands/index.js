import { createShape } from './create-shape.js'
import { putRecord } from './put.js'
import { updateRecord } from './update.js'
import { deleteRecords } from './delete.js'
import { insertImage } from './insert-image.js'
import { insertHtml } from './insert-html.js'
import { duplicateShapes } from './duplicate-shapes.js'
import { removeFrames } from './remove-frames.js'
import { reorderShapes } from './reorder-shapes.js'
import { toggleLock, unlockAll } from './lock-shapes.js'
import { nudgeShapes } from './nudge-shapes.js'
import { reserveImageBatch } from './reserve-image-batch.js'
import { alignShapes, stretchShapes, distributeShapes, stackShapes, packShapes, flipShapes } from './layout-shapes.js'
import { groupShapes } from './group-shapes.js'
import { ungroupShapes } from './ungroup-shapes.js'
import { fitFrames } from './fit-frames.js'

// 新命令只增加处理函数并在此登记，不修改已有命令；一行一个，并行开发时互不冲突。
export const commandHandlers = Object.freeze({
  create_shape: createShape,
  put: putRecord,
  update: updateRecord,
  delete: deleteRecords,
  insert_image: insertImage,
  insert_html: insertHtml,
  duplicate_shapes: duplicateShapes,
  remove_frames: removeFrames,
  reorder_shapes: reorderShapes,
  toggle_lock: toggleLock,
  unlock_all: unlockAll,
  nudge_shapes: nudgeShapes,
  reserve_image_batch: reserveImageBatch,
  align_shapes: alignShapes,
  stretch_shapes: stretchShapes,
  distribute_shapes: distributeShapes,
  stack_shapes: stackShapes,
  pack_shapes: packShapes,
  flip_shapes: flipShapes,
  group_shapes: groupShapes,
  ungroup_shapes: ungroupShapes,
  fit_frame_to_content: fitFrames,
})
