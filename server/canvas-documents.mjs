import { createTLStore } from 'tldraw'
export const documentRecordTypes = new Set(Object.entries(createTLStore().schema.types).filter(([, type]) => type.scope === 'document').map(([name]) => name))
