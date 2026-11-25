const pendingHelpTaskIds = new Set()
const tabButtons = [...document.querySelectorAll('[role="tab"]')]
const taskStatusDefinitions = [
  { value: 'NotStarted', label: 'Not started', color: '#858585' },
  { value: 'InProgress', label: 'In progress', color: '#3794ff' },
  { value: 'Done', label: 'Done', color: '#4ec9b0' },
  { value: 'Blocked', label: 'Blocked', color: '#f14c4c' }
]
const historySeriesDefinitions = [
  { key: 'Done', color: '#4ec9b0' },
  { key: 'Blocked', color: '#f14c4c' }
]

function activateTab(activeTabButton) {
  for (const tabButton of tabButtons) {
    const isActive = tabButton === activeTabButton
    const tabPanel = document.getElementById(tabButton.getAttribute('aria-controls'))

    tabButton.setAttribute('aria-selected', String(isActive))
    tabButton.tabIndex = isActive ? 0 : -1
    tabPanel.hidden = !isActive
  }
}

function handleTabKeydown(event) {
  const activeTabIndex = tabButtons.indexOf(event.currentTarget)
  let nextTabIndex

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextTabIndex = (activeTabIndex + 1) % tabButtons.length
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextTabIndex = (activeTabIndex - 1 + tabButtons.length) % tabButtons.length
  } else if (event.key === 'Home') {
    nextTabIndex = 0
  } else if (event.key === 'End') {
    nextTabIndex = tabButtons.length - 1
  } else {
    return
  }

  event.preventDefault()
  tabButtons[nextTabIndex].focus()
  activateTab(tabButtons[nextTabIndex])
}

function setupTabs() {
  for (const tabButton of tabButtons) {
    tabButton.addEventListener('click', () => activateTab(tabButton))
    tabButton.addEventListener('keydown', handleTabKeydown)
  }
}

function createPromptCard(prompt) {
  const promptButton = document.createElement('button')
  promptButton.className = 'prompt-card'
  promptButton.type = 'button'

  const promptTitle = document.createElement('span')
  promptTitle.className = 'prompt-card-title'
  promptTitle.textContent = prompt.title

  const promptDescription = document.createElement('span')
  promptDescription.className = 'prompt-card-description'
  promptDescription.textContent = prompt.description

  promptButton.append(promptTitle, promptDescription)
  promptButton.addEventListener('click', () =>
    requestPredefinedPrompt(prompt.id, promptButton)
  )

  return promptButton
}

async function loadPromptCards() {
  const promptList = document.querySelector('#prompt-list')

  try {
    const response = await fetch('/api/prompts')
    const promptCards = await response.json()

    if (!response.ok) {
      throw new Error(promptCards.error || `Request failed (${response.status})`)
    }

    if (!Array.isArray(promptCards) || !promptCards.every(prompt =>
      prompt &&
      typeof prompt.id === 'string' &&
      typeof prompt.title === 'string' &&
      typeof prompt.description === 'string'
    )) {
      throw new Error('Received an invalid prompt list')
    }

    promptList.replaceChildren(...promptCards.map(createPromptCard))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown prompt list error'
    promptList.textContent = `Unable to load prompts: ${errorMessage}`
  }
}

async function requestPredefinedPrompt(promptId, button) {
  const promptStatus = document.querySelector('#prompt-status')
  const promptTitle = button.querySelector('.prompt-card-title')
  const originalTitle = promptTitle.textContent

  button.disabled = true
  button.setAttribute('aria-busy', 'true')
  promptTitle.textContent = 'Sending...'
  promptStatus.textContent = `Sending "${originalTitle}" to Copilot...`

  try {
    const response = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptId })
    })
    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.error || `Request failed (${response.status})`)
    }

    promptStatus.textContent = `"${originalTitle}" sent to Copilot.`
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown prompt request error'
    promptStatus.textContent = `Unable to send prompt: ${errorMessage}`
  } finally {
    button.disabled = false
    button.removeAttribute('aria-busy')
    promptTitle.textContent = originalTitle
  }
}

function countTasksByStatus(tasks) {
  const taskCounts = new Map(
    taskStatusDefinitions.map(({ value }) => [value, 0])
  )

  for (const task of tasks) {
    taskCounts.set(task.Status, taskCounts.get(task.Status) + 1)
  }

  return taskCounts
}

function renderSummary(totalTaskCount, taskCounts) {
  const completedTaskCount = taskCounts.get('Done')
  const blockedTaskCount = taskCounts.get('Blocked')

  document.querySelector('#total-count').textContent = String(totalTaskCount)
  document.querySelector('#done-count').textContent = String(completedTaskCount)
  document.querySelector('#blocked-count').textContent = String(blockedTaskCount)
}

function renderActiveTasks(tasks) {
  const taskList = document.querySelector('#active-task-list')
  const activeTasks = tasks.filter(task =>
    task.Status === 'InProgress' || task.Status === 'Blocked'
  )

  taskList.replaceChildren()

  if (activeTasks.length === 0) {
    const emptyItem = document.createElement('li')
    emptyItem.className = 'empty-state'
    emptyItem.textContent = 'No active or blocked tasks'
    taskList.append(emptyItem)
    return
  }

  for (const task of activeTasks) {
    const taskRow = document.createElement('li')
    taskRow.className = 'task-row'

    const taskDetails = document.createElement('div')
    const taskName = document.createElement('h3')
    taskName.className = 'task-name'
    taskName.textContent = task.Name

    const taskMetadata = document.createElement('p')
    taskMetadata.className = 'task-meta'
    taskMetadata.textContent = `${task.Agent || 'Unassigned'} - ${task.Status}`

    taskDetails.append(taskName, taskMetadata)
    taskRow.append(taskDetails)

    if (task.Status === 'Blocked') {
      const helpButton = document.createElement('button')
      helpButton.className = 'help-button'
      helpButton.type = 'button'
      helpButton.textContent = pendingHelpTaskIds.has(task.ID) ? 'Sending...' : 'Help'
      helpButton.setAttribute('aria-label', `Ask for help with ${task.Name}`)
      helpButton.disabled = pendingHelpTaskIds.has(task.ID)
      helpButton.addEventListener('click', () => requestHelp(task.ID, helpButton))
      taskRow.append(helpButton)
    }

    taskList.append(taskRow)
  }
}

async function requestHelp(taskId, button) {
  const actionStatus = document.querySelector('#action-status')
  pendingHelpTaskIds.add(taskId)
  button.disabled = true
  button.textContent = 'Sending...'
  actionStatus.textContent = 'Sending help request...'

  try {
    const response = await fetch('/api/help', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId })
    })
    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.error || `Request failed (${response.status})`)
    }

    actionStatus.textContent = 'Help request sent. Task moved to In progress.'
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown help request error'
    actionStatus.textContent = `Unable to request help: ${errorMessage}`
  } finally {
    pendingHelpTaskIds.delete(taskId)

    if (button.isConnected) {
      button.disabled = false
      button.textContent = 'Help'
    }
  }
}

function renderStatusChart(totalTaskCount, taskCounts) {
  const statusChart = document.querySelector('#status-chart')
  const legend = document.querySelector('#status-legend')
  const taskStatuses = taskStatusDefinitions.map(statusDefinition => ({
    ...statusDefinition,
    count: taskCounts.get(statusDefinition.value)
  }))

  statusChart.replaceChildren()
  legend.replaceChildren()

  if (totalTaskCount === 0) {
    statusChart.textContent = 'No task data'
    return
  }

  let cumulativePercentage = 0
  const gradientStops = []

  for (const taskStatus of taskStatuses) {
    if (taskStatus.count === 0) continue

    const startPercentage = cumulativePercentage
    cumulativePercentage += taskStatus.count / totalTaskCount * 100
    gradientStops.push(
      `${taskStatus.color} ${startPercentage}% ${cumulativePercentage}%`
    )
  }

  const pie = document.createElement('div')
  pie.className = 'pie-chart'
  pie.style.background = `conic-gradient(${gradientStops.join(', ')})`
  statusChart.append(pie)

  for (const taskStatus of taskStatuses) {
    const legendEntry = document.createElement('li')
    legendEntry.className = 'legend-item'

    const legendMarker = document.createElement('span')
    legendMarker.className = 'legend-marker'
    legendMarker.style.backgroundColor = taskStatus.color

    const legendLabel = document.createElement('span')
    legendLabel.textContent = `${taskStatus.label}: ${taskStatus.count}`

    legendEntry.append(legendMarker, legendLabel)
    legend.append(legendEntry)
  }
}

function createSvgElement(elementName, attributes = {}) {
  const svgElement = document.createElementNS('http://www.w3.org/2000/svg', elementName)

  for (const [key, value] of Object.entries(attributes)) {
    svgElement.setAttribute(key, String(value))
  }

  return svgElement
}

function appendHistoryGridlines(historyChart, layout, yAxisMaximum, yPositionForValue) {
  for (let gridlineIndex = 0; gridlineIndex <= 4; gridlineIndex++) {
    const tickValue = yAxisMaximum * gridlineIndex / 4
    const yPosition = yPositionForValue(tickValue)

    historyChart.append(createSvgElement('line', {
      x1: layout.margins.left,
      y1: yPosition,
      x2: layout.margins.left + layout.plotWidth,
      y2: yPosition,
      stroke: '#3c3c3c'
    }))

    const tickLabel = createSvgElement('text', {
      x: layout.margins.left - 8,
      y: yPosition + 4,
      'text-anchor': 'end',
      fill: '#9da0a6',
      'font-size': 11
    })
    tickLabel.textContent = String(Math.round(tickValue))
    historyChart.append(tickLabel)
  }
}

function appendHistorySeries(historyChart, historyPoints, xPositionForIndex, yPositionForValue) {
  const latestIndex = historyPoints.length - 1
  const latestPoint = historyPoints[latestIndex]

  for (const series of historySeriesDefinitions) {
    const pointCoordinates = historyPoints.map((point, index) =>
      `${xPositionForIndex(index)},${yPositionForValue(point[series.key])}`
    ).join(' ')

    historyChart.append(createSvgElement('polyline', {
      points: pointCoordinates,
      fill: 'none',
      stroke: series.color,
      'stroke-width': 3,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }))

    historyChart.append(createSvgElement('circle', {
      cx: xPositionForIndex(latestIndex),
      cy: yPositionForValue(latestPoint[series.key]),
      r: 4,
      fill: series.color
    }))
  }
}

function appendHistoryTimeLabels(historyChart, layout, historyPoints, xPositionForIndex) {
  const labelCount = Math.min(historyPoints.length, 5)

  for (let labelIndex = 0; labelIndex < labelCount; labelIndex++) {
    const historyIndex = labelCount === 1
      ? 0
      : Math.round((historyPoints.length - 1) * labelIndex / (labelCount - 1))
    const timestamp = new Date(historyPoints[historyIndex].Time)
    const timeLabel = createSvgElement('text', {
      x: xPositionForIndex(historyIndex),
      y: layout.height - 18,
      'text-anchor': 'middle',
      fill: '#9da0a6',
      'font-size': 11
    })

    timeLabel.textContent = Number.isNaN(timestamp.getTime())
      ? ''
      : timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    historyChart.append(timeLabel)
  }
}

function renderHistoryChart(historyPoints) {
  const historyChart = document.querySelector('#history-chart')
  historyChart.replaceChildren()

  if (historyPoints.length === 0) {
    const emptyMessage = createSvgElement('text', {
      x: 320,
      y: 140,
      'text-anchor': 'middle'
    })
    emptyMessage.textContent = 'No history data'
    historyChart.append(emptyMessage)
    return
  }

  const margins = { top: 20, right: 16, bottom: 42, left: 48 }
  const layout = {
    width: 640,
    height: 280,
    margins,
    plotWidth: 640 - margins.left - margins.right,
    plotHeight: 280 - margins.top - margins.bottom
  }

  const largestCount = Math.max(
    0,
    ...historyPoints.flatMap(point => [point.Done, point.Blocked])
  )
  const yAxisMaximum = Math.max(5, Math.ceil(largestCount / 5) * 5)
  const xPositionForIndex = index => historyPoints.length === 1
    ? layout.margins.left + layout.plotWidth / 2
    : layout.margins.left + index / (historyPoints.length - 1) * layout.plotWidth
  const yPositionForValue = value =>
    layout.margins.top + layout.plotHeight - value / yAxisMaximum * layout.plotHeight

  appendHistoryGridlines(historyChart, layout, yAxisMaximum, yPositionForValue)
  appendHistorySeries(historyChart, historyPoints, xPositionForIndex, yPositionForValue)
  appendHistoryTimeLabels(historyChart, layout, historyPoints, xPositionForIndex)
}

function renderDashboard(statsSnapshot) {
  const taskCounts = countTasksByStatus(statsSnapshot.tasks)

  renderSummary(statsSnapshot.tasks.length, taskCounts)
  renderActiveTasks(statsSnapshot.tasks)
  renderStatusChart(statsSnapshot.tasks.length, taskCounts)
  renderHistoryChart(statsSnapshot.History)
}

function connectToUpdates() {
  const connectionStatus = document.querySelector('#connection-status')
  const statsEventSource = new EventSource('/events')

  statsEventSource.onmessage = event => {
    try {
      const statsSnapshot = JSON.parse(event.data)
      renderDashboard(statsSnapshot)

      const lastUpdated = new Date(statsSnapshot.updatedAt)
      const displayTime = Number.isNaN(lastUpdated.getTime())
        ? 'unknown time'
        : lastUpdated.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })

      connectionStatus.textContent = `Connected - Updated ${displayTime}`
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown update error'
      connectionStatus.textContent = `Unable to update dashboard: ${errorMessage}`
    }
  }

  statsEventSource.addEventListener('stats-error', event => {
    try {
      const errorDetails = JSON.parse(event.data)
      connectionStatus.textContent =
        `Stats update error: ${errorDetails.error || 'Unknown error'}`
    } catch {
      connectionStatus.textContent = 'Received an invalid stats error event'
    }
  })

  statsEventSource.onerror = () => {
    connectionStatus.textContent = 'Live updates disconnected - reconnecting...'
  }
}

setupTabs()
void loadPromptCards()
connectToUpdates()