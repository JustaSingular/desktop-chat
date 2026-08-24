# Cuts every sprite named in art/sprites.json out of its sheet and writes it to
# src/sprites/. They live under src/ so Vite resolves and hashes them from CSS,
# which keeps the urls correct in dev, in the build, and behind Tauri's protocol.
#
#   powershell -File tools/export-sprites.ps1
param(
  [string]$Manifest = 'art/sprites.json',
  [string]$OutDir = 'src/sprites'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$spec = Get-Content (Join-Path $root $Manifest) -Raw | ConvertFrom-Json
$outPath = Join-Path $root $OutDir
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

$sheets = @{}
foreach ($key in $spec.sheets.PSObject.Properties.Name) {
  $path = Join-Path $root $spec.sheets.$key
  $sheets[$key] = [System.Drawing.Bitmap]::FromFile($path)
  Write-Host ("sheet '{0}': {1} ({2}x{3})" -f $key, $spec.sheets.$key, $sheets[$key].Width, $sheets[$key].Height)
}

try {
  foreach ($s in $spec.sprites) {
    $sheet = $sheets[$s.sheet]
    if (-not $sheet) { throw "sprite '$($s.name)' names unknown sheet '$($s.sheet)'" }
    $r = $s.rect
    if ($r[0] -lt 0 -or $r[1] -lt 0 -or
        ($r[0] + $r[2]) -gt $sheet.Width -or ($r[1] + $r[3]) -gt $sheet.Height) {
      throw "sprite '$($s.name)' rect $($r -join ',') falls outside its sheet"
    }
    $rect = New-Object System.Drawing.Rectangle ([int]$r[0]), ([int]$r[1]), ([int]$r[2]), ([int]$r[3])
    $part = $sheet.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $part.Save((Join-Path $outPath "$($s.name).png"), [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host ("  {0,-16} {1,3} x {2,-3}" -f $s.name, $r[2], $r[3])
    } finally { $part.Dispose() }
  }
} finally {
  foreach ($b in $sheets.Values) { $b.Dispose() }
}

Write-Host "wrote $($spec.sprites.Count) sprites to $OutDir"
