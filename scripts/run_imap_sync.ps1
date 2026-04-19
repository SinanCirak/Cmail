#Requires -Version 5.1
<#
.SYNOPSIS
  Start WorkMail → S3/DynamoDB mail archive sync (uses scripts/imap_to_mail_archive.py).

.EXAMPLE
  .\scripts\run_imap_sync.ps1

.EXAMPLE
  $env:IMAP_PASSWORD = '***'; .\scripts\run_imap_sync.ps1 -SkipPasswordPrompt
#>
param(
  [string] $ImapPassword = $env:IMAP_PASSWORD,
  [switch] $SkipPasswordPrompt
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not $env:IMAP_USER) {
  $env:IMAP_USER = Read-Host 'IMAP user email'
}

if (-not $ImapPassword -and -not $SkipPasswordPrompt) {
  $secure = Read-Host -AsSecureString 'WorkMail IMAP password'
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $ImapPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) | Out-Null
  }
}

if (-not $ImapPassword) {
  Write-Error 'Missing IMAP password. Set $env:IMAP_PASSWORD or run interactively so the prompt can ask for it.'
}

$venvPython = Join-Path $repoRoot '.venv-imap\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  Write-Host 'Creating virtualenv and installing dependencies...'
  python -m venv .venv-imap
  & .\.venv-imap\Scripts\pip.exe install -r scripts\requirements-imap-sync.txt
}

# Override via environment before running if your org differs (see README).
$env:AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ca-central-1' }
if (-not $env:MAIL_ARCHIVE_BUCKET) { $env:MAIL_ARCHIVE_BUCKET = 'data.cmail.cirak.ca' }
if (-not $env:MAIL_METADATA_TABLE) { $env:MAIL_METADATA_TABLE = 'cmail-mail-metadata' }
if (-not $env:IMAP_HOST) { $env:IMAP_HOST = 'imap.mail.us-east-1.awsapps.com' }
$env:IMAP_PASSWORD = $ImapPassword
# WorkMail often hangs on IMAP LIST; the Python script skips LIST by default and tries common folder names.
# For server-side discovery: $env:IMAP_USE_LIST = '1'

& $venvPython scripts\imap_to_mail_archive.py
