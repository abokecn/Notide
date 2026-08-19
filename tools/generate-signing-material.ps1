[CmdletBinding()]
param(
  [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Documents\Notide Signing Keys'),
  [string]$OpenSslPath = 'C:\Program Files\OpenSSL-Win64\bin\openssl.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-RandomPassword {
  $bytes = [byte[]]::new(32)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Protect-ForCurrentUser([string]$Value) {
  $secure = ConvertTo-SecureString -String $Value -AsPlainText -Force
  return ConvertFrom-SecureString -SecureString $secure
}

if (-not (Test-Path -LiteralPath $OpenSslPath -PathType Leaf)) {
  throw "OpenSSL was not found at $OpenSslPath"
}
if (Test-Path -LiteralPath $OutputDirectory) {
  throw "Refusing to overwrite the existing signing directory: $OutputDirectory"
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$npx = Get-Command npx.cmd -ErrorAction Stop
$output = [IO.Path]::GetFullPath($OutputDirectory)
$tauriPrivate = Join-Path $output 'notide.key'
$tauriPublic = "$tauriPrivate.pub"
$androidKeystore = Join-Path $output 'notide-release.p12'
$androidPrivatePem = Join-Path $output '.android-private.pem'
$androidCertificatePem = Join-Path $output '.android-certificate.pem'
$vaultPath = Join-Path $output 'notide-secrets.dpapi.json'
$fingerprintPath = Join-Path $output 'android-certificate-sha256.txt'
$readmePath = Join-Path $output 'README.txt'
$androidAlias = 'notide'
$tauriPassword = New-RandomPassword
$androidPassword = New-RandomPassword

New-Item -ItemType Directory -Path $output | Out-Null
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $output /inheritance:r /grant:r "${identity}:(OI)(CI)F" /grant:r '*S-1-5-18:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the signing directory ACL.' }

  Push-Location $repositoryRoot
  try {
    & $npx.Source tauri signer generate --password $tauriPassword --write-keys $tauriPrivate --ci
    if ($LASTEXITCODE -ne 0) { throw 'Tauri updater key generation failed.' }
  } finally {
    Pop-Location
  }
  if (-not (Test-Path -LiteralPath $tauriPrivate -PathType Leaf) -or
      -not (Test-Path -LiteralPath $tauriPublic -PathType Leaf)) {
    throw 'Tauri updater key files were not created.'
  }

  try {
    & $OpenSslPath req -x509 -newkey rsa:4096 -sha256 -days 10000 `
      -keyout $androidPrivatePem -out $androidCertificatePem `
      -subj '/CN=Notide Android Release/OU=Release/O=Notide/C=CN' `
      -passout "pass:$androidPassword"
    if ($LASTEXITCODE -ne 0) { throw 'Android certificate generation failed.' }

    & $OpenSslPath pkcs12 -export -out $androidKeystore `
      -inkey $androidPrivatePem -passin "pass:$androidPassword" `
      -in $androidCertificatePem -name $androidAlias `
      -passout "pass:$androidPassword" -macalg SHA256
    if ($LASTEXITCODE -ne 0) { throw 'Android PKCS#12 export failed.' }

    & $OpenSslPath pkcs12 -in $androidKeystore -info -noout -passin "pass:$androidPassword" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Android PKCS#12 verification failed.' }

    $fingerprintLine = & $OpenSslPath x509 -in $androidCertificatePem -noout -fingerprint -sha256
    if ($LASTEXITCODE -ne 0) { throw 'Android certificate fingerprint generation failed.' }
    $fingerprint = ($fingerprintLine -replace '^sha256 Fingerprint=', '' -replace ':', '').Trim().ToLowerInvariant()
    if ($fingerprint -notmatch '^[a-f0-9]{64}$') { throw 'Android certificate fingerprint is invalid.' }
    Set-Content -LiteralPath $fingerprintPath -Value $fingerprint -Encoding utf8NoBOM -NoNewline
  } finally {
    Remove-Item -LiteralPath $androidPrivatePem, $androidCertificatePem -Force -ErrorAction SilentlyContinue
  }

  $vault = [ordered]@{
    schemaVersion = 1
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    protection = 'Windows DPAPI current user'
    tauriPassword = Protect-ForCurrentUser $tauriPassword
    androidPassword = Protect-ForCurrentUser $androidPassword
    androidAlias = $androidAlias
  }
  $vault | ConvertTo-Json | Set-Content -LiteralPath $vaultPath -Encoding utf8NoBOM

  @"
Notide signing material

This directory contains the permanent Tauri updater key and Android release
keystore. Passwords are protected with Windows DPAPI for the current account.

Never commit, email, or publicly share this directory. Back it up to a secure,
encrypted location. Losing or replacing these keys breaks future updates.

Copy one GitHub Actions Secret without printing it:

  npm run signing:copy -- SECRET_NAME

Supported names:
  TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  TAURI_UPDATER_PUBLIC_KEY
  ANDROID_KEY_BASE64
  ANDROID_KEYSTORE_PASSWORD
  ANDROID_KEY_ALIAS
  ANDROID_KEY_PASSWORD
"@ | Set-Content -LiteralPath $readmePath -Encoding utf8NoBOM

  Write-Host "Generated Notide signing material in $output"
  Write-Host 'Seven GitHub Actions Secrets are ready. No secret values were printed.'
} catch {
  if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force -ErrorAction SilentlyContinue
  }
  throw
} finally {
  $tauriPassword = $null
  $androidPassword = $null
}
