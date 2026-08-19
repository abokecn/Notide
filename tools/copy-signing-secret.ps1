[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet(
    'TAURI_SIGNING_PRIVATE_KEY',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    'TAURI_UPDATER_PUBLIC_KEY',
    'ANDROID_KEY_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD'
  )]
  [string]$Name,
  [string]$KeyDirectory = (Join-Path $env:USERPROFILE 'Documents\Notide Signing Keys')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Unprotect-ForCurrentUser([string]$Value) {
  $secure = ConvertTo-SecureString -String $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$directory = [IO.Path]::GetFullPath($KeyDirectory)
$vaultPath = Join-Path $directory 'notide-secrets.dpapi.json'
$tauriPrivate = Join-Path $directory 'notide.key'
$tauriPublic = "$tauriPrivate.pub"
$androidKeystore = Join-Path $directory 'notide-release.p12'

foreach ($path in @($vaultPath, $tauriPrivate, $tauriPublic, $androidKeystore)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Signing material is incomplete. Missing: $path"
  }
}

$vault = Get-Content -Raw -LiteralPath $vaultPath | ConvertFrom-Json
if ($vault.schemaVersion -ne 1) { throw 'Unsupported Notide signing vault version.' }

$value = switch ($Name) {
  'TAURI_SIGNING_PRIVATE_KEY' { Get-Content -Raw -LiteralPath $tauriPrivate }
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' { Unprotect-ForCurrentUser $vault.tauriPassword }
  'TAURI_UPDATER_PUBLIC_KEY' { Get-Content -Raw -LiteralPath $tauriPublic }
  'ANDROID_KEY_BASE64' { [Convert]::ToBase64String([IO.File]::ReadAllBytes($androidKeystore)) }
  'ANDROID_KEYSTORE_PASSWORD' { Unprotect-ForCurrentUser $vault.androidPassword }
  'ANDROID_KEY_ALIAS' { [string]$vault.androidAlias }
  'ANDROID_KEY_PASSWORD' { Unprotect-ForCurrentUser $vault.androidPassword }
}

if ([string]::IsNullOrWhiteSpace($value)) { throw "$Name resolved to an empty value." }
Set-Clipboard -Value $value
$value = $null
Write-Host "Copied $Name to the clipboard. Paste it into GitHub, then copy the next value."
