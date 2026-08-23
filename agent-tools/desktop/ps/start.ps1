param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)
$ErrorActionPreference = 'Stop'
$exe = $Target -replace '/', '\'
if (-not (Test-Path $exe)) { throw "Not found: $exe" }
if ($Arguments) { Start-Process -FilePath $exe -ArgumentList $Arguments }
else { Start-Process -FilePath $exe }
Write-Output "started $exe"
