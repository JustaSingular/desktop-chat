# Prints one region of a sheet as an ASCII colour map, plus a palette legend.
# Use it to read exact component rectangles out of pixel art.
#
#   powershell -File tools/map-frame.ps1 -Source "C:\path\Sprite.png" -Box "1,11,85,127"
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Box   # "x,y,w,h"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$p = $Box -split ','
$bx = [int]$p[0]; $by = [int]$p[1]; $bw = [int]$p[2]; $bh = [int]$p[3]

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
try {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $stride = $data.Stride

  $symbols = '#','O','o','.',':','+','=','*'
  $map = @{}
  $next = 0

  # header: column ruler
  $tens = ' ' * 5; $ones = ' ' * 5
  for ($x = 0; $x -lt $bw; $x++) {
    $tens += if ($x % 10 -eq 0) { [string]([int]($x / 10) % 10) } else { ' ' }
    $ones += [string]($x % 10)
  }
  Write-Host $tens
  Write-Host $ones

  for ($y = 0; $y -lt $bh; $y++) {
    $sb = New-Object System.Text.StringBuilder
    for ($x = 0; $x -lt $bw; $x++) {
      $i = ($by + $y) * $stride + ($bx + $x) * 4
      if ($bytes[$i + 3] -eq 0) { [void]$sb.Append(' '); continue }
      $key = "{0},{1},{2}" -f $bytes[$i+2], $bytes[$i+1], $bytes[$i]
      if (-not $map.ContainsKey($key)) { $map[$key] = $symbols[$next]; $next++ }
      [void]$sb.Append($map[$key])
    }
    Write-Host ("{0,3}: {1}" -f $y, $sb.ToString())
  }

  Write-Host ""
  Write-Host "legend:"
  foreach ($k in $map.Keys) { Write-Host ("  {0}  rgb({1})" -f $map[$k], $k) }
} finally { $bmp.Dispose() }
