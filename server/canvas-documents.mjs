import { createTLSchema } from '@tldraw/tlschema'
export const documentRecordTypes = new Set(Object.entries(createTLSchema().types).filter(([, type]) => type.scope === 'document').map(([name]) => name))
