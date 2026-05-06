$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host "`n==> $Name" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Update-PatchVersion {
    $package = Get-Content "package.json" -Raw | ConvertFrom-Json
    if ($package.version -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "Unsupported package version format: $($package.version)"
    }

    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3] + 1
    $newVersion = "$major.$minor.$patch"

    Invoke-Step "Version bump to $newVersion" {
        npm version $newVersion --no-git-tag-version | Out-Null

        $tauriConfigPath = "src-tauri\tauri.conf.json"
        $tauriConfig = Get-Content $tauriConfigPath -Raw
        $tauriConfig = $tauriConfig -replace '"version"\s*:\s*"[^"]+"', "`"version`": `"$newVersion`""
        Set-Content -Path $tauriConfigPath -Value $tauriConfig -NoNewline

        $cargoTomlPath = "src-tauri\Cargo.toml"
        $cargoToml = Get-Content $cargoTomlPath -Raw
        $cargoToml = $cargoToml -replace '(?m)^version\s*=\s*"[^"]+"', "version = `"$newVersion`""
        Set-Content -Path $cargoTomlPath -Value $cargoToml -NoNewline
    }

    return $newVersion
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot

try {
    $appVersion = Update-PatchVersion
    $tauriConfig = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
    if ($tauriConfig.version -ne $appVersion) {
        throw "Tauri version $($tauriConfig.version) does not match package version $appVersion"
    }
    $buildDate = Get-Date -Format "yyyy-MM-dd"
    $artifactDate = Get-Date -Format "yyyyMMdd"

    $env:VITE_APP_VERSION = $appVersion
    $env:VITE_BUILD_DATE = $buildDate

    Invoke-Step "Frontend tests" { npm test }
    Invoke-Step "Rust tests" {
        Push-Location "src-tauri"
        try {
            cargo test
        } finally {
            Pop-Location
        }
    }
    Invoke-Step "Tauri release build" { npm run tauri build }

    $bundleRoot = Join-Path $repoRoot "src-tauri\target\release\bundle"
    if (Test-Path $bundleRoot) {
        $msiPath = Join-Path $bundleRoot "msi\mailmail_${appVersion}_x64_en-US.msi"
        $datedMsiPath = Join-Path $bundleRoot "msi\mailmail_${appVersion}_${artifactDate}_x64_en-US.msi"
        if (Test-Path $msiPath) {
            Copy-Item $msiPath $datedMsiPath -Force
        }

        $nsisPath = Join-Path $bundleRoot "nsis\mailmail_${appVersion}_x64-setup.exe"
        $datedNsisPath = Join-Path $bundleRoot "nsis\mailmail_${appVersion}_${artifactDate}_x64-setup.exe"
        if (Test-Path $nsisPath) {
            Copy-Item $nsisPath $datedNsisPath -Force
        }

        Write-Host "`nRelease artifacts:" -ForegroundColor Green
        Get-ChildItem $bundleRoot -Recurse -File |
            Where-Object { $_.Extension -in ".exe", ".msi", ".nsis", ".zip" -or $_.Name -like "*.exe" } |
            Sort-Object FullName |
            ForEach-Object { Write-Host "  $($_.FullName)" }
    } else {
        Write-Host "`nNo bundle directory found at $bundleRoot" -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}