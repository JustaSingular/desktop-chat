# Renders the bare panel with the furniture rectangles marked, so it is obvious
# which pixels of the body actually stay visible and which get covered.
# Reads the rects from art/sprites.json, so it stays honest if they change.
#
#   powershell -File tools/panel-freespace.ps1
param(
  [string]$Manifest = 'art/sprites.json',
  [string]$Out = 'art/reference/panel-free-space.png',
  [int]$Zoom = 6
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$spec = Get-Content (Join-Path $root $Manifest) -Raw | ConvertFrom-Json
$layout = $spec._layout

# the panel sprite's rect on the sheet
$panelSprite = $spec.sprites | Where-Object { $_.name -eq 'panel' }
$sheetPath = Join-Path $root $spec.sheets.($panelSprite.sheet)
$pr = $panelSprite.rect

$sheet = [System.Drawing.Bitmap]::FromFile($sheetPath)
try {
  $rect = New-Object System.Drawing.Rectangle ([int]$pr[0]), ([int]$pr[1]), ([int]$pr[2]), ([int]$pr[3])
  $panel = $sheet.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $w = $panel.Width * $Zoom
    $h = $panel.Height * $Zoom
    $canvas = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.Clear([System.Drawing.Color]::FromArgb(255, 26, 28, 34))
    $g.DrawImage($panel, 0, 0, $w, $h)

    # anything the UI paints over is dead space for body detail
    $covered = @('bar', 'style', 'log', 'input', 'send')
    $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 220, 40, 40))
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 80, 80)), 2
    $font = New-Object System.Drawing.Font('Consolas', 11)
    $label = [System.Drawing.Brushes]::White

    foreach ($name in $covered) {
      $r = $layout.$name
      $x = [int]($r[0] * $Zoom); $y = [int]($r[1] * $Zoom)
      $rw = [int]($r[2] * $Zoom); $rh = [int]($r[3] * $Zoom)
      $g.FillRectangle($fill, $x, $y, $rw, $rh)
      $g.DrawRectangle($pen, $x, $y, $rw, $rh)
      $g.DrawString($name, $font, $label, [single]($x + 3), [single]($y + 2))
    }

    $g.Dispose()
    $outPath = Join-Path $root $Out
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null
    $canvas.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Host "wrote $Out  (${w}x${h}, ${Zoom}x)"
    Write-Host "red = covered by UI. everything else is yours."
  } finally { $panel.Dispose() }
} finally { $sheet.Dispose() }
