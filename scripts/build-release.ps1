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

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot

try {
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