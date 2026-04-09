param(
  [Parameter(Position = 0)]
  [ValidateSet("init", "sync-live", "start-live", "sync-release", "zip-release", "status")]
  [string]$Command = "status"
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ParentRoot = Split-Path $RepoRoot -Parent
$LiveRoot = Join-Path $ParentRoot "littlecoder-live-test"
$ReleaseRoot = Join-Path $ParentRoot "littlecoder-github-push"
$RuntimeRoot = Join-Path $RepoRoot "factory\projects"
$GitkeepSource = Join-Path $RuntimeRoot ".gitkeep"
$OriginUrl = (& git -C $RepoRoot config --get remote.origin.url).Trim()

function Write-Section($Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Ensure-Directory($Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Reset-Target($TargetRoot, $PreserveNames) {
  Ensure-Directory $TargetRoot

  Get-ChildItem -LiteralPath $TargetRoot -Force | ForEach-Object {
    if ($PreserveNames -contains $_.Name) {
      return
    }

    Remove-Item -LiteralPath $_.FullName -Force -Recurse
  }
}

function Should-SkipRelativePath($RelativePath) {
  $normalized = $RelativePath -replace "\\", "/"

  if (
    $normalized -eq ".git" -or
    $normalized.StartsWith(".git/") -or
    $normalized -eq "node_modules" -or
    $normalized.StartsWith("node_modules/") -or
    $normalized -eq "logs" -or
    $normalized.StartsWith("logs/") -or
    $normalized -eq "pids" -or
    $normalized.StartsWith("pids/") -or
    $normalized -eq "workspace" -or
    $normalized.StartsWith("workspace/") -or
    $normalized -eq "factory" -or
    $normalized.StartsWith("factory/") -or
    $normalized -eq "config.json" -or
    $normalized -eq ".env"
  ) {
    return $true
  }

  if ($normalized -like "littlecoder-v*.zip") {
    return $true
  }

  if ($normalized -like "tmp-*.png") {
    return $true
  }

  if ($normalized -like "*.log") {
    return $true
  }

  return $false
}

function Copy-DirectoryFiltered($SourceRoot, $TargetRoot) {
  Get-ChildItem -LiteralPath $SourceRoot -Force | ForEach-Object {
    $relativePath = $_.Name
    Copy-ItemFiltered -SourcePath $_.FullName -TargetPath (Join-Path $TargetRoot $_.Name) -RelativePath $relativePath
  }
}

function Copy-ItemFiltered($SourcePath, $TargetPath, $RelativePath) {
  if (Should-SkipRelativePath $RelativePath) {
    return
  }

  $item = Get-Item -LiteralPath $SourcePath -Force

  if ($item.PSIsContainer) {
    Ensure-Directory $TargetPath
    Get-ChildItem -LiteralPath $SourcePath -Force | ForEach-Object {
      $childRelative = Join-Path $RelativePath $_.Name
      Copy-ItemFiltered -SourcePath $_.FullName -TargetPath (Join-Path $TargetPath $_.Name) -RelativePath $childRelative
    }
    return
  }

  Ensure-Directory (Split-Path $TargetPath -Parent)
  Copy-Item -LiteralPath $SourcePath -Destination $TargetPath -Force
}

function Ensure-FactorySkeleton($TargetRoot) {
  $projectsRoot = Join-Path $TargetRoot "factory\projects"
  Ensure-Directory $projectsRoot

  if (Test-Path $GitkeepSource) {
    Copy-Item -LiteralPath $GitkeepSource -Destination (Join-Path $projectsRoot ".gitkeep") -Force
  } else {
    if (-not (Test-Path (Join-Path $projectsRoot ".gitkeep"))) {
      New-Item -ItemType File -Path (Join-Path $projectsRoot ".gitkeep") | Out-Null
    }
  }
}

function Sync-LiveWorkspace {
  Write-Section "Syncing live test workspace"
  Reset-Target -TargetRoot $LiveRoot -PreserveNames @("config.json", "node_modules", "logs", "pids", "workspace", "factory")
  Copy-DirectoryFiltered -SourceRoot $RepoRoot -TargetRoot $LiveRoot
  Ensure-FactorySkeleton -TargetRoot $LiveRoot
  Write-Host "Live test workspace ready: $LiveRoot" -ForegroundColor Green
}

function Ensure-ReleaseClone {
  if (Test-Path (Join-Path $ReleaseRoot ".git")) {
    return
  }

  Write-Section "Creating github push workspace"
  if (-not $OriginUrl) {
    throw "Remote origin URL is missing. Cannot create github push workspace."
  }

  if (Test-Path $ReleaseRoot) {
    Remove-Item -LiteralPath $ReleaseRoot -Force -Recurse
  }

  & git clone $OriginUrl $ReleaseRoot | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "git clone failed."
  }
}

function Sync-ReleaseWorkspace {
  Ensure-ReleaseClone
  Write-Section "Syncing github push workspace"
  Reset-Target -TargetRoot $ReleaseRoot -PreserveNames @(".git")
  Copy-DirectoryFiltered -SourceRoot $RepoRoot -TargetRoot $ReleaseRoot
  Ensure-FactorySkeleton -TargetRoot $ReleaseRoot
  Write-Host "Github push workspace ready: $ReleaseRoot" -ForegroundColor Green
}

function Get-ReleaseVersion($Root) {
  $versionFile = Join-Path $Root "VERSION"
  if (Test-Path $versionFile) {
    return (Get-Content $versionFile -Raw).Trim()
  }

  $packageFile = Join-Path $Root "package.json"
  if (Test-Path $packageFile) {
    return ((Get-Content $packageFile -Raw | ConvertFrom-Json).version).Trim()
  }

  throw "Could not resolve release version."
}

function Build-ReleaseZip {
  Sync-ReleaseWorkspace
  $version = Get-ReleaseVersion -Root $ReleaseRoot
  $zipName = "littlecoder-v$version.zip"
  $zipPath = Join-Path $ReleaseRoot $zipName

  Write-Section "Building release zip"
  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  $items = Get-ChildItem -LiteralPath $ReleaseRoot -Force | Where-Object {
    $_.Name -notin @(".git", "config.json", "node_modules", "logs", "pids", "workspace")
  }

  Compress-Archive -Path ($items | ForEach-Object { $_.FullName }) -DestinationPath $zipPath -Force
  Write-Host "Release zip created: $zipPath" -ForegroundColor Green
}

function Start-LiveWorkspace {
  Sync-LiveWorkspace
  $nodeModulesRoot = Join-Path $LiveRoot "node_modules"

  if (-not (Test-Path $nodeModulesRoot)) {
    Write-Section "Installing dependencies in live test workspace"
    Push-Location $LiveRoot
    try {
      & npm.cmd install
    } finally {
      Pop-Location
    }
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed in live test workspace."
    }
  }

  $scriptName = if (Test-Path (Join-Path $LiveRoot "config.json")) { "start.js" } else { "setup.js" }
  $nodePath = (Get-Command node).Source
  Write-Section "Launching live test workspace"
  Write-Host "Running 'node $scriptName' in $LiveRoot" -ForegroundColor Yellow

  Start-Process -FilePath $nodePath -WorkingDirectory $LiveRoot -ArgumentList @($scriptName) | Out-Null
}

function Show-Status {
  Write-Section "Workspace status"
  Write-Host "Main build   : $RepoRoot"
  Write-Host "Live test    : $LiveRoot"
  Write-Host "Github push  : $ReleaseRoot"
}

switch ($Command) {
  "init" {
    Show-Status
    Sync-LiveWorkspace
    Sync-ReleaseWorkspace
  }
  "sync-live" {
    Sync-LiveWorkspace
  }
  "start-live" {
    Start-LiveWorkspace
  }
  "sync-release" {
    Sync-ReleaseWorkspace
  }
  "zip-release" {
    Build-ReleaseZip
  }
  "status" {
    Show-Status
  }
}
