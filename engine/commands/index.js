import { createShape } from './create-shape.js'
import { putRecord } from './put.js'
import { updateRecord } from './update.js'
import { deleteRecords } from './delete.js'

// 新命令只增加处理函数并在此登记，不修改已有命令。
export const commandHandlers = Object.freeze({ create_shape: createShape, put: putRecord, update: updateRecord, delete: deleteRecords })
