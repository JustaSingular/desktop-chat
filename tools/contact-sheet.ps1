# Crops boxes out of a sheet, scales them up nearest-neighbour, and lays them
# out in a labelled grid so the frames can be compared by eye.
#
#   powershell -File tools/contact-sheet.ps1 -Source in.png -Out out.png -Cols 3 -Zoom 3 -Boxes @("1,11,85,127", ...)
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string[]]$Boxes,
  [int]$Cols = 3,
  [int]$Zoom = 3
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
try {
  $parsed = $Boxes | ForEach-Object {
    $p = $_ -split ','
    [pscustomobject]@{ X = [int]$p[0]; Y = [int]$p[1]; W = [int]$p[2]; H = [int]$p[3] }
  }

  $cellW = ($parsed | Measure-Object -Property W -Maximum).Maximum * $Zoom
  $cellH = ($parsed | Measure-Object -Property H -Maximum).Maximum * $Zoom
  $pad = 14; $label = 20
  $rows = [math]::Ceiling($parsed.Count / $Cols)
  $canvasW = [int]($Cols * ($cellW + $pad) + $pad)
  $canvasH = [int]($rows * ($cellH + $pad + $label) + $pad)

  $canvas = New-Object System.Drawing.Bitmap($canvasW, $canvasH)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.Clear([System.Drawing.Color]::FromArgb(255, 26, 28, 34))
  $font = New-Object System.Drawing.Font('Consolas', 11)
  $brush = [System.Drawing.Brushes]::White

  for ($i = 0; $i -lt $parsed.Count; $i++) {
    $b = $parsed[$i]
    $col = $i % $Cols
    $row = [math]::Floor($i / $Cols)
    $x = [int]($pad + $col * ($cellW + $pad))
    $y = [int]($pad + $row * ($cellH + $pad + $label))
    $g.DrawString("[$i]  $($b.W)x$($b.H)", $font, $brush, [single]$x, [single]$y)
    $rect = New-Object System.Drawing.Rectangle $b.X, $b.Y, $b.W, $b.H
    $frame = $src.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $g.DrawImage($frame, $x, [int]($y + $label), [int]($b.W * $Zoom), [int]($b.H * $Zoom))
    } finally { $frame.Dispose() }
  }

  $font.Dispose(); $g.Dispose()
  $canvas.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Dispose()
  Write-Host "wrote $Out  ($canvasW x $canvasH)"
} finally { $src.Dispose() }
