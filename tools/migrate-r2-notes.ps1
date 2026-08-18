[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$AccountId,
  [string]$SourceBucket = 'sail-markdown-notes',
  [string]$DestinationBucket = 'notide-notes',
  [string]$Prefix = 'notes/',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw 'AWS CLI v2 is required. Configure it with an R2 API token before running this script.'
}
if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
  throw 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to an R2 API token with access to both buckets.'
}

$endpoint = "https://$AccountId.r2.cloudflarestorage.com"
$source = "s3://$SourceBucket/$Prefix"
$destination = "s3://$DestinationBucket/$Prefix"
$arguments = @('s3', 'sync', $source, $destination, '--endpoint-url', $endpoint, '--only-show-errors')
if ($DryRun) { $arguments += '--dryrun' }

Write-Host "Copying $source to $destination"
& aws @arguments
if ($LASTEXITCODE -ne 0) { throw "R2 migration failed with exit code $LASTEXITCODE." }
Write-Host $(if ($DryRun) { 'Dry run complete. No objects were copied.' } else { 'Migration complete. Source objects were not deleted.' })
