import { sendJson, readRequestBody, isSelectionState, isViewState, isCanvasSnapshot } from './protocol.mjs'
import { canvasEventClients, broadcastCanvasChanged } from './events.mjs'
import { canvasDir, selectionFile, viewStateFile, writeJsonAtomic, readJsonFile, loadCanvasSnapshot, saveCanvasSnapshot, sanitizeCanvasSnapshotForServer, serveCanvasAsset, updateHtmlDraftSnapshot } from './storage.mjs'
export function canvasStoragePlugin() {
  return { name: 'hicanvas-storage', configureServer, configurePreviewServer: configureServer }
}

function configureServer(server) {
      server.middlewares.use(serveCanvasAsset)

      server.middlewares.use('/api/html-draft', async (req, res) => {
        try {
          if (req.method !== 'PUT') {
            res.statusCode = 405
            res.setHeader('allow', 'PUT')
            res.end()
            return
          }

          const body = JSON.parse(await readRequestBody(req))
          const loaded = await loadCanvasSnapshot()
          if (!loaded.snapshot) {
            sendJson(res, 404, { error: 'No Cowart canvas snapshot exists.' })
            return
          }

          const updatedDraft = await updateHtmlDraftSnapshot(loaded.snapshot, body)
          const result = await saveCanvasSnapshot(loaded.snapshot)
          broadcastCanvasChanged(result)
          sendJson(res, 200, { ok: true, ...updatedDraft, ...result })
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/canvas-events', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream')
        res.setHeader('cache-control', 'no-cache, no-transform')
        res.setHeader('connection', 'keep-alive')
        res.setHeader('x-accel-buffering', 'no')
        res.write(`: connected\n\n`)

        canvasEventClients.add(res)
        const heartbeat = setInterval(() => {
          res.write(`: heartbeat ${Date.now()}\n\n`)
        }, 25000)

        req.on('close', () => {
          clearInterval(heartbeat)
          canvasEventClients.delete(res)
        })
      })

      server.middlewares.use('/api/selection', async (req, res) => {
        try {
          if (req.method === 'GET') {
            try {
              sendJson(res, 200, {
                selection: await readJsonFile(selectionFile),
                path: selectionFile
              })
            } catch (error) {
              if (error.code === 'ENOENT') {
                sendJson(res, 200, {
                  selection: { selectedShapes: [], updatedAt: null },
                  path: selectionFile
                })
                return
              }
              throw error
            }
            return
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req)
            const selection = JSON.parse(body)
            if (!isSelectionState(selection)) {
              sendJson(res, 400, { error: 'Expected a Cowart selection state.' })
              return
            }

            await writeJsonAtomic(selectionFile, selection)
            sendJson(res, 200, { ok: true, path: selectionFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/view-state', async (req, res) => {
        try {
          if (req.method === 'GET') {
            try {
              sendJson(res, 200, {
                viewState: await readJsonFile(viewStateFile),
                path: viewStateFile
              })
            } catch (error) {
              if (error.code === 'ENOENT') {
                sendJson(res, 200, {
                  viewState: {
                    version: 1,
                    currentPageId: null,
                    camera: { x: 0, y: 0, z: 1 },
                    updatedAt: null
                  },
                  path: viewStateFile
                })
                return
              }
              throw error
            }
            return
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req)
            const viewState = JSON.parse(body)
            if (!isViewState(viewState)) {
              sendJson(res, 400, { error: 'Expected a Cowart view state.' })
              return
            }

            await writeJsonAtomic(viewStateFile, viewState)
            sendJson(res, 200, { ok: true, path: viewStateFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/canvas', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const result = await loadCanvasSnapshot()
            if (result.snapshot !== null) {
              const checked = await sanitizeCanvasSnapshotForServer(result.snapshot)
              if (!checked.snapshot || checked.skippedRecords.length) throw new Error('画板含无法完整读取的记录，请先备份资料夹；已停止加载以保护原文件。')
            }
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req)
            const snapshot = JSON.parse(body)
            if (!isCanvasSnapshot(snapshot)) {
              sendJson(res, 400, { error: 'Expected a tldraw store snapshot.' })
              return
            }

            const sanitized = await sanitizeCanvasSnapshotForServer(snapshot)
            if (!sanitized.snapshot || sanitized.skippedRecords.length) {
              sendJson(res, 400, {
                error: 'Invalid tldraw store snapshot.',
                skippedRecords: sanitized.skippedRecords
              })
              return
            }

            const result = await saveCanvasSnapshot(sanitized.snapshot)
            sendJson(res, 200, { ok: true, ...result, skippedRecords: sanitized.skippedRecords })
            broadcastCanvasChanged(result)
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

}
