# Reports the bounding box of every component on a sprite sheet.
# Components are found by transparent gutters: rows first, then columns within
# each row band.
#
#   powershell -File tools/inspect-sheet.ps1 -Source "C:\path\Sprite.png"
param(
  [Parameter(Mandatory = $true)][string]$Source
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
try {
  $w = $bmp.Width; $h = $bmp.Height
  Write-Host "sheet: $w x $h"

  # Pull the alpha channel out in one locked read — GetPixel per pixel is slow
  # on a sheet this size.
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $stride = $data.Stride

  function Test-Opaque($x, $y) { $bytes[$y * $stride + $x * 4 + 3] -ne 0 }

  # rows containing anything
  $rowUsed = New-Object 'bool[]' $h
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      if ($bytes[$y * $stride + $x * 4 + 3] -ne 0) { $rowUsed[$y] = $true; break }
    }
  }

  $bands = New-Object System.Collections.ArrayList
  $y = 0
  while ($y -lt $h) {
    if ($rowUsed[$y]) {
      $start = $y
      while ($y -lt $h -and $rowUsed[$y]) { $y++ }
      [void]$bands.Add([pscustomobject]@{ Top = $start; Bottom = $y - 1 })
    } else { $y++ }
  }

  Write-Host "$($bands.Count) row band(s)"
  $n = 0
  foreach ($band in $bands) {
    Write-Host ""
    Write-Host ("row band y $($band.Top)..$($band.Bottom)  (h=$($band.Bottom - $band.Top + 1))")

    $colUsed = New-Object 'bool[]' $w
    for ($x = 0; $x -lt $w; $x++) {
      for ($yy = $band.Top; $yy -le $band.Bottom; $yy++) {
        if ($bytes[$yy * $stride + $x * 4 + 3] -ne 0) { $colUsed[$x] = $true; break }
      }
    }

    $x = 0
    while ($x -lt $w) {
      if ($colUsed[$x]) {
        $x0 = $x
        while ($x -lt $w -and $colUsed[$x]) { $x++ }
        $x1 = $x - 1

        # tighten vertically to this component alone
        $t = $band.Bottom; $b = $band.Top
        for ($yy = $band.Top; $yy -le $band.Bottom; $yy++) {
          for ($xx = $x0; $xx -le $x1; $xx++) {
            if ($bytes[$yy * $stride + $xx * 4 + 3] -ne 0) {
              if ($yy -lt $t) { $t = $yy }
              if ($yy -gt $b) { $b = $yy }
              break
            }
          }
        }
        Write-Host ("  [{0,2}] x {1,3}..{2,-3} y {3,3}..{4,-3}  {5} x {6}" -f $n, $x0, $x1, $t, $b, ($x1-$x0+1), ($b-$t+1))
        $n++
      } else { $x++ }
    }
  }
} finally { $bmp.Dispose() }
