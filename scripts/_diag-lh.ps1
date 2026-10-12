# Temporary diagnostic: extract Lighthouse LCP details (deleted after use).
param([string]$Dir = '.lighthouseci')

$f = Get-ChildItem "$Dir/lhr-*.json" | Sort-Object LastWriteTime | Select-Object -Last 1
$j = Get-Content $f.FullName -Raw | ConvertFrom-Json
Write-Output ('FILE: ' + $f.Name)
Write-Output '--- lcp audit ---'
$j.audits.'largest-contentful-paint' | ConvertTo-Json -Depth 6
Write-Output '--- fcp audit (score/displayValue) ---'
$j.audits.'first-contentful-paint' | Select-Object score, displayValue | ConvertTo-Json
Write-Output '--- runtimeError ---'
$j.runtimeError | ConvertTo-Json
Write-Output '--- configSettings ---'
$j.configSettings | ConvertTo-Json -Depth 4
Write-Output '--- final-screenshot dimensions ---'
$fs = $j.audits.'final-screenshot'
if ($fs -and $fs.details.data) {
  $b64 = $fs.details.data -replace '^data:[^,]+,', ''
  $bytes = [Convert]::FromBase64String($b64)
  [IO.File]::WriteAllBytes("$env:TEMP/lh-final-screenshot.png", $bytes)
  Write-Output ("saved: $env:TEMP/lh-final-screenshot.png (" + $bytes.Length + ' bytes)')
}
