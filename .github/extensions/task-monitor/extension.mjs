import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension'
import declaration from './extension.json' with { type: 'json' }
import { startDashboardServer } from './server.mjs'

const dashboardServersByInstance = new Map()
let copilotSession

async function getDashboardServer(instanceId) {
  let serverPromise = dashboardServersByInstance.get(instanceId)

  if (!serverPromise) {
    serverPromise = startDashboardServer({
      sendHelpPrompt: prompt => copilotSession.send({ prompt })
    })
    dashboardServersByInstance.set(instanceId, serverPromise)
  }

  try {
    return await serverPromise
  } catch (error) {
    dashboardServersByInstance.delete(instanceId)
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error'
    throw new CanvasError('SERVER_START_FAILED', errorMessage)
  }
}

async function closeDashboardServer(instanceId) {
  const serverPromise = dashboardServersByInstance.get(instanceId)
  if (!serverPromise) return

  try {
    const dashboardServer = await serverPromise
    await dashboardServer.close()
    dashboardServersByInstance.delete(instanceId)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error'
    throw new CanvasError('SERVER_CLOSE_FAILED', errorMessage)
  }
}

const canvases = declaration.canvases.map(canvas =>
  createCanvas({
    ...canvas,
    open: async ({ instanceId }) => {
      const dashboardServer = await getDashboardServer(instanceId)
      return {
        title: canvas.displayName,
        url: dashboardServer.url
      }
    },
    onClose: async ({ instanceId }) => closeDashboardServer(instanceId)
  })
)

copilotSession = await joinSession({ canvases })