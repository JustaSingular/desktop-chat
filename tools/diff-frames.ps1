# Compares equal-sized frames on a sheet against the first one, reporting where
# they differ. Tells you whether a row of near-identical frames is an animation,
# a set of states, or duplicates.
#
#   powershell -File tools/diff-frames.ps1 -Source "C:\path\Sprite.png" -Boxes "1,11,85,127 94,11,85,127"
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string[]]$Boxes   # "x,y,w,h" each
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
try {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $stride = $data.Stride

  $parsed = $Boxes | ForEach-Object {
    $p = $_ -split ','
    [pscustomobject]@{ X = [int]$p[0]; Y = [int]$p[1]; W = [int]$p[2]; H = [int]$p[3] }
  }

  $base = $parsed[0]
  for ($i = 1; $i -lt $parsed.Count; $i++) {
    $f = $parsed[$i]
    $diff = 0; $minX = 9999; $maxX = -1; $minY = 9999; $maxY = -1
    for ($y = 0; $y -lt $base.H; $y++) {
      for ($x = 0; $x -lt $base.W; $x++) {
        $a = ($base.Y + $y) * $stride + ($base.X + $x) * 4
        $b = ($f.Y + $y) * $stride + ($f.X + $x) * 4
        if ($bytes[$a] -ne $bytes[$b] -or $bytes[$a+1] -ne $bytes[$b+1] -or
            $bytes[$a+2] -ne $bytes[$b+2] -or $bytes[$a+3] -ne $bytes[$b+3]) {
          $diff++
          if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
          if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }
    if ($diff -eq 0) {
      Write-Host ("frame {0}: identical to frame 0" -f $i)
    } else {
      Write-Host ("frame {0}: {1} px differ, in local box x {2}..{3} y {4}..{5}  ({6}x{7})" -f `
        $i, $diff, $minX, $maxX, $minY, $maxY, ($maxX-$minX+1), ($maxY-$minY+1))
    }
  }
} finally { $bmp.Dispose() }
