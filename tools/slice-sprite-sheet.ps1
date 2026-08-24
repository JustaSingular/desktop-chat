# Slices a sprite sheet into individual frames, trimming transparent padding.
# Frames are detected by fully-transparent columns, so the sheet can be any size
# with any gap between frames.
#
#   powershell -File tools/slice-sprite-sheet.ps1 -Source "C:\path\Sprite-0002.png"
#
# Writes public/sprites/tab-rest.png (frame 0) and tab-open.png (frame 1).
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string[]]$Names = @('tab-rest', 'tab-open')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\sprites'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
try {
  # Which columns and rows contain any opaque pixel
  $colUsed = New-Object 'bool[]' $src.Width
  $rowUsed = New-Object 'bool[]' $src.Height
  for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
      if ($src.GetPixel($x, $y).A -ne 0) { $colUsed[$x] = $true; $rowUsed[$y] = $true }
    }
  }

  # Vertical extent is shared by all frames so they stay aligned to each other
  $top = 0; while ($top -lt $src.Height -and -not $rowUsed[$top]) { $top++ }
  $bottom = $src.Height - 1; while ($bottom -ge 0 -and -not $rowUsed[$bottom]) { $bottom-- }
  if ($bottom -lt $top) { throw "no opaque pixels in $Source" }
  $h = $bottom - $top + 1

  # Runs of used columns = frames
  $spans = New-Object System.Collections.ArrayList
  $x = 0
  while ($x -lt $src.Width) {
    if ($colUsed[$x]) {
      $start = $x
      while ($x -lt $src.Width -and $colUsed[$x]) { $x++ }
      [void]$spans.Add([pscustomobject]@{ Start = $start; End = $x - 1 })
    } else { $x++ }
  }

  Write-Host "$($spans.Count) frame(s), $h px tall"

  for ($i = 0; $i -lt $spans.Count; $i++) {
    $span = $spans[$i]
    $w = $span.End - $span.Start + 1
    $name = if ($i -lt $Names.Count) { $Names[$i] } else { "frame-$i" }
    $rect = New-Object System.Drawing.Rectangle $span.Start, $top, $w, $h
    $frame = $src.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $path = Join-Path $outDir "$name.png"
      $frame.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host ("  {0}.png  {1}x{2}" -f $name, $w, $h)
    } finally { $frame.Dispose() }
  }
} finally { $src.Dispose() }
