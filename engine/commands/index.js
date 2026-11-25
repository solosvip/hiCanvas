import { createShape } from './create-shape.js'
import { putRecord } from './put.js'
import { updateRecord } from './update.js'
import { deleteRecords } from './delete.js'
import { insertImage } from './insert-image.js'
import { insertHtml } from './insert-html.js'
import { duplicateShapes } from './duplicate-shapes.js'
import { removeFrames } from './remove-frames.js'

// 新命令只增加处理函数并在此登记，不修改已有命令。
export const commandHandlers = Object.freeze({ create_shape: createShape, put: putRecord, update: updateRecord, delete: deleteRecords, insert_image: insertImage, insert_html: insertHtml, duplicate_shapes: duplicateShapes, remove_frames: removeFrames })
