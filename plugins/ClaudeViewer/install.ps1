# ClaudeViewer - Protocol Handler Installer
# Registers honeyview-stash:// URL protocol to open Stash images in Honeyview
#
# Usage:
#   Right-click install.ps1 → "Run with PowerShell"   (auto-elevates to admin)
#   or:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# To use a non-default Honeyview path:
#   powershell -ExecutionPolicy Bypass -File install.ps1 -HoneyviewPath "D:\Apps\Honeyview\Honeyview.exe"

param (
    [string]$HoneyviewPath = "C:\Program Files\Honeyview\Honeyview.exe"
)

# Auto-elevate to Administrator if not already
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    if ($HoneyviewPath -ne "C:\Program Files\Honeyview\Honeyview.exe") {
        $args += " -HoneyviewPath `"$HoneyviewPath`""
    }
    Start-Process powershell -ArgumentList $args -Verb RunAs
    exit
}

# Resolve plugin directory from script location
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$HandlerPath = Join-Path $ScriptDir "handler.py"

Write-Host ""
Write-Host "ClaudeViewer - Protocol Handler Installer" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Validate handler.py exists
if (-not (Test-Path $HandlerPath)) {
    Write-Host "[ERROR] handler.py not found at: $HandlerPath" -ForegroundColor Red
    Write-Host "        Make sure install.ps1 is in the same directory as handler.py"
    Read-Host "Press Enter to exit"
    exit 1
}

# Validate pythonw is available
$pythonwPath = (Get-Command pythonw -ErrorAction SilentlyContinue)?.Source
if (-not $pythonwPath) {
    Write-Host "[ERROR] pythonw not found in PATH." -ForegroundColor Red
    Write-Host "        Please install Python from https://python.org and add it to PATH."
    Read-Host "Press Enter to exit"
    exit 1
}

# Validate Honeyview exists
if (-not (Test-Path $HoneyviewPath)) {
    Write-Host "[WARNING] Honeyview not found at: $HoneyviewPath" -ForegroundColor Yellow
    Write-Host "          Edit HONEYVIEW in handler.py to set the correct path."
    Write-Host ""
}

$command = "pythonw `"$HandlerPath`" `"%1`""
$regBase = "HKLM:\SOFTWARE\Classes\honeyview-stash"

Write-Host "Registering honeyview-stash:// protocol..." -ForegroundColor White
Write-Host "  Script dir : $ScriptDir"
Write-Host "  Handler    : $HandlerPath"
Write-Host "  Command    : $command"
Write-Host ""

try {
    New-Item -Path $regBase -Force | Out-Null
    Set-ItemProperty -Path $regBase -Name "(Default)" -Value "URL:Honeyview Stash Protocol"
    Set-ItemProperty -Path $regBase -Name "URL Protocol" -Value ""

    New-Item -Path "$regBase\DefaultIcon" -Force | Out-Null
    Set-ItemProperty -Path "$regBase\DefaultIcon" -Name "(Default)" -Value "$HoneyviewPath,0"

    New-Item -Path "$regBase\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path "$regBase\shell\open\command" -Name "(Default)" -Value $command

    Write-Host "[OK] Installation complete!" -ForegroundColor Green
    Write-Host "     honeyview-stash:// protocol is now registered system-wide."
} catch {
    Write-Host "[ERROR] Failed to write registry: $_" -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to exit"
