$ErrorActionPreference = 'Stop'

$statsFilePath = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\runtime\stats.json')
)
$statsLockPath = "$statsFilePath.lock"
$validStatuses = @('NotStarted', 'InProgress', 'Done', 'Blocked')
$maxHistoryEntries = 480
$statsLockTimeoutMilliseconds = 10000
$staleStatsLockMilliseconds = 120000

function Enter-StatsFileLock {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($statsLockTimeoutMilliseconds)

    while ($true) {
        try {
            $lockStream = [System.IO.File]::Open(
                $statsLockPath,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None
            )
            $lockStream.Dispose()
            return
        }
        catch [System.IO.IOException] {
            if (Test-Path -LiteralPath $statsLockPath) {
                $lockFile = Get-Item -LiteralPath $statsLockPath
                $lockAge = ([DateTime]::UtcNow - $lockFile.LastWriteTimeUtc).TotalSeconds

                if ($lockAge * 1000 -gt $staleStatsLockMilliseconds) {
                    try {
                        Remove-Item -LiteralPath $statsLockPath -Force
                    }
                    catch [System.Management.Automation.ItemNotFoundException] {
                        if (Test-Path -LiteralPath $statsLockPath) {
                            throw
                        }
                    }

                    continue
                }
            }

            if ([DateTime]::UtcNow -ge $deadline) {
                throw "Timed out waiting for stats file lock: $statsLockPath"
            }

            Start-Sleep -Milliseconds 50
        }
    }
}

function Exit-StatsFileLock {
    if (Test-Path -LiteralPath $statsLockPath) {
        Remove-Item -LiteralPath $statsLockPath -Force
    }
}

function Save-StatsFile {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string]$JsonContent
    )

    $statsDirectory = Split-Path -Path $FilePath -Parent
    $temporaryFileId = [guid]::NewGuid().ToString('N')
    $temporaryPath = Join-Path $statsDirectory "stats.$temporaryFileId.tmp"
    $backupPath = Join-Path $statsDirectory "stats.$temporaryFileId.bak"

    try {
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($temporaryPath, $JsonContent, $utf8WithoutBom)
        [System.IO.File]::Replace($temporaryPath, $FilePath, $backupPath)
    }
    finally {
        foreach ($temporaryFile in @($temporaryPath, $backupPath)) {
            if (Test-Path -LiteralPath $temporaryFile) {
                Remove-Item -LiteralPath $temporaryFile
            }
        }
    }
}

function Update-StatsFile {
    if (-not (Test-Path -LiteralPath $statsFilePath)) {
        throw "Cannot find stats file: $statsFilePath"
    }

    $statsData = Get-Content -LiteralPath $statsFilePath -Raw | ConvertFrom-Json

    if (
        $null -eq $statsData -or
        $statsData.tasks -isnot [System.Array] -or
        $statsData.History -isnot [System.Array]
    ) {
        throw 'stats.json must contain tasks and History'
    }

    $invalidTasks = @(
        $statsData.tasks | Where-Object { $_.Status -notin $validStatuses }
    )

    if ($invalidTasks.Count -gt 0) {
        $invalidTask = $invalidTasks[0]
        throw "Task $($invalidTask.ID) '$($invalidTask.Name)' has unsupported status '$($invalidTask.Status)'."
    }

    $timestamp = [DateTime]::UtcNow.ToString('o')
    $inProgressTasks = @($statsData.tasks | Where-Object { $_.Status -eq 'InProgress' })
    $tasksToFinish = @()

    if ($inProgressTasks.Count -gt 0) {
        $finishCount = [Math]::Min(
            (Get-Random -Minimum 2 -Maximum 3),
            $inProgressTasks.Count
        )
        $tasksToFinish = @(Get-Random -InputObject $inProgressTasks -Count $finishCount)
    }

    foreach ($taskToFinish in $tasksToFinish) {
        if ((Get-Random -Minimum 1 -Maximum 11) -eq 10) {
            $taskToFinish.Status = 'Blocked'
            $taskToFinish.FinishedAt = $null
        }
        else {
            $taskToFinish.Status = 'Done'
            $taskToFinish.FinishedAt = $timestamp
        }

        Write-Output "Finished task $($taskToFinish.ID) - $($taskToFinish.Name): $($taskToFinish.Status)"
    }

    $startCount = Get-Random -Minimum 2 -Maximum 4
    $tasksToStart = @(
        $statsData.tasks |
            Where-Object { $_.Status -eq 'NotStarted' } |
            Select-Object -First $startCount
    )

    foreach ($taskToStart in $tasksToStart) {
        $taskToStart.Status = 'InProgress'
        $taskToStart.StartedAt = $timestamp
        $taskToStart.FinishedAt = $null
        Write-Output "Starting task $($taskToStart.ID) - $($taskToStart.Name)"
    }

    if ($tasksToStart.Count -eq 0) {
        Write-Output 'There are no NotStarted tasks.'
    }

    $doneCount = @($statsData.tasks | Where-Object { $_.Status -eq 'Done' }).Count
    $blockedCount = @($statsData.tasks | Where-Object { $_.Status -eq 'Blocked' }).Count
    $statsData.History = @($statsData.History) + [pscustomobject]@{
        Time = $timestamp
        Done = $doneCount
        Blocked = $blockedCount
    }

    if ($statsData.History.Count -gt $maxHistoryEntries) {
        $statsData.History = @($statsData.History | Select-Object -Last $maxHistoryEntries)
    }

    $statsData.updatedAt = $timestamp
    $jsonContent = ConvertTo-Json -InputObject $statsData -Depth 100
    Save-StatsFile -FilePath $statsFilePath -JsonContent $jsonContent

    Write-Output 'Saved stats.json'
    $statsData.History | Select-Object -Last 2 | Format-Table Time, Done, Blocked
    $statsData.tasks |
        Group-Object -Property Status |
        Sort-Object -Property Name |
        Format-Table Name, Count
}

function Invoke-WorkerCycle {
    Enter-StatsFileLock

    try {
        Update-StatsFile
    }
    finally {
        Exit-StatsFileLock
    }
}

while ($true) {
    Invoke-WorkerCycle
    Start-Sleep -Seconds 60
}
