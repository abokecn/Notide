[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$WorkerUrl,

  [string]$SessionToken = $env:NOTIDE_SESSION_TOKEN,

  [string]$OwnerId,

  [string]$OwnerUsername,

  [switch]$DryRun,

  [string]$AccountId = $env:CLOUDFLARE_ACCOUNT_ID,

  [string]$Bucket = 'notide-notes',

  [string]$LegacyPrefix = 'notes/'
)

$ErrorActionPreference = 'Stop'
$baseUrl = $WorkerUrl.Trim().TrimEnd('/')
if (-not [Uri]::IsWellFormedUriString($baseUrl, [UriKind]::Absolute)) {
  throw 'WorkerUrl must be an absolute Worker base URL.'
}
$workerUri = [Uri]$baseUrl
if ($workerUri.Scheme -ne 'https' -and $workerUri.Host -notin @('localhost', '127.0.0.1')) {
  throw 'WorkerUrl must use HTTPS unless it points to localhost.'
}
if ([string]::IsNullOrWhiteSpace($SessionToken)) {
  throw 'Set NOTIDE_SESSION_TOKEN or pass SessionToken from a signed-in super-admin session.'
}
if ([string]::IsNullOrWhiteSpace($OwnerId) -eq [string]::IsNullOrWhiteSpace($OwnerUsername)) {
  throw 'Specify exactly one of OwnerId or OwnerUsername. There is no implicit migration owner.'
}

$headers = @{ Authorization = "Bearer $SessionToken" }
$directory = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/admin/users" -Headers $headers
$users = @($directory.users)
if ($OwnerUsername) {
  $target = @($users | Where-Object { [string]$_.username -ieq $OwnerUsername })
} else {
  $target = @($users | Where-Object { [string]$_.id -eq $OwnerId })
}
if ($target.Count -ne 1) {
  throw 'The requested migration owner was not found or was not unique.'
}
$resolvedOwnerId = [string]$target[0].id
$resolvedOwnerName = [string]$target[0].username
Write-Host "Target owner: $resolvedOwnerName ($resolvedOwnerId)"

if ($DryRun) {
  if ([string]::IsNullOrWhiteSpace($AccountId)) {
    throw 'DryRun requires AccountId or CLOUDFLARE_ACCOUNT_ID so it can list the legacy R2 objects.'
  }
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'DryRun requires AWS CLI v2 to list R2 without mutating it.'
  }
  if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
    throw 'DryRun requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for a read-only R2 listing.'
  }
  $prefix = $LegacyPrefix.TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($prefix)) {
    throw 'LegacyPrefix cannot be empty.'
  }
  $endpoint = "https://$AccountId.r2.cloudflarestorage.com"
  $listingOutput = & aws s3api list-objects-v2 `
    --bucket $Bucket `
    --prefix $prefix `
    --endpoint-url $endpoint `
    --output json
  if ($LASTEXITCODE -ne 0) {
    throw "Could not list legacy R2 objects (AWS CLI exit code $LASTEXITCODE)."
  }
  $listing = ($listingOutput -join [Environment]::NewLine) | ConvertFrom-Json
  $keys = @($listing.Contents | ForEach-Object { [string]$_.Key })
  Write-Host "DRY RUN: $($keys.Count) object(s) under s3://$Bucket/$prefix would be considered for owner $resolvedOwnerName."
  $keys | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
  if ($keys.Count -gt 20) {
    Write-Host "  ... and $($keys.Count - 20) more object(s)."
  }
  Write-Host 'No migration API was called and no R2 or D1 data was changed.'
  return
}

$cursor = $null
$totalMigrated = 0
$totalSkipped = 0

do {
  $query = "ownerId=$([Uri]::EscapeDataString($resolvedOwnerId))"
  if ($cursor) {
    $query += "&cursor=$([Uri]::EscapeDataString($cursor))"
  }
  $result = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/api/admin/migrations/legacy-r2?$query" `
    -Headers $headers

  $totalMigrated += [int]$result.migrated
  $totalSkipped += [int]$result.skipped
  Write-Host "Migrated $($result.migrated), skipped $($result.skipped), failed $($result.failed)."
  if ([int]$result.failed -gt 0) {
    throw 'Migration returned failed objects. Fix the reported Worker/R2 issue and rerun; completed objects are idempotently skipped.'
  }
  $cursor = if ($result.truncated) { [string]$result.cursor } else { $null }
} while ($cursor)

Write-Host "Legacy migration complete for $resolvedOwnerName. Migrated $totalMigrated and skipped $totalSkipped objects. Source objects were not deleted."
