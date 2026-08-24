# Finds every separate shape on a sheet by flood-filling opaque pixels, then
# reports (and optionally exports) each one's bounding box.
#
#   powershell -File tools/slice-components.ps1 -Source in.png
#   powershell -File tools/slice-components.ps1 -Source in.png -Region "0,145,315,100" -OutDir parts
#
# -MinPixels drops specks. -Gap merges shapes whose boxes are within N px of
# each other, for art where a piece is drawn as several disconnected bits.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Region,
  [string]$OutDir,
  [int]$MinPixels = 4,
  [int]$Gap = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
try {
  $rx = 0; $ry = 0; $rw = $bmp.Width; $rh = $bmp.Height
  if ($Region) { $p = $Region -split ','; $rx=[int]$p[0]; $ry=[int]$p[1]; $rw=[int]$p[2]; $rh=[int]$p[3] }

  $full = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($full, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $stride = $data.Stride

  # local opaque mask
  $mask = New-Object 'bool[]' ($rw * $rh)
  for ($y = 0; $y -lt $rh; $y = $y + 1) {
    for ($x = 0; $x -lt $rw; $x = $x + 1) {
      $mask[$y * $rw + $x] = $bytes[($ry + $y) * $stride + ($rx + $x) * 4 + 3] -ne 0
    }
  }

  $seen = New-Object 'bool[]' ($rw * $rh)
  $comps = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Generic.Stack[int]

  for ($i = 0; $i -lt $mask.Length; $i = $i + 1) {
    if (-not $mask[$i] -or $seen[$i]) { continue }
    $stack.Clear(); $stack.Push($i); $seen[$i] = $true
    $n = 0; $x0 = $rw; $x1 = -1; $y0 = $rh; $y1 = -1

    while ($stack.Count -gt 0) {
      $c = $stack.Pop()
      $cx = [int]($c % $rw); $cy = [int][math]::Floor($c / $rw)
      $n = $n + 1
      if ($cx -lt $x0) { $x0 = $cx }; if ($cx -gt $x1) { $x1 = $cx }
      if ($cy -lt $y0) { $y0 = $cy }; if ($cy -gt $y1) { $y1 = $cy }

      for ($dy = -1; $dy -le 1; $dy = $dy + 1) {
        for ($dx = -1; $dx -le 1; $dx = $dx + 1) {
          $nx = $cx + $dx; $ny = $cy + $dy
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $rw -or $ny -ge $rh) { continue }
          $ni = $ny * $rw + $nx
          if ($mask[$ni] -and -not $seen[$ni]) { $seen[$ni] = $true; $stack.Push($ni) }
        }
      }
    }
    if ($n -ge $MinPixels) {
      [void]$comps.Add([pscustomobject]@{ X = $x0; Y = $y0; X1 = $x1; Y1 = $y1; N = $n })
    }
  }

  # optional merge of boxes that sit within $Gap of each other
  if ($Gap -gt 0) {
    $merged = $true
    while ($merged) {
      $merged = $false
      for ($a = 0; $a -lt $comps.Count -and -not $merged; $a = $a + 1) {
        for ($b = $a + 1; $b -lt $comps.Count -and -not $merged; $b = $b + 1) {
          $left = $comps[$a]; $right = $comps[$b]
          if ($left.X - $Gap -le $right.X1 -and $right.X - $Gap -le $left.X1 -and
              $left.Y - $Gap -le $right.Y1 -and $right.Y - $Gap -le $left.Y1) {
            $left.X = [math]::Min($left.X, $right.X); $left.Y = [math]::Min($left.Y, $right.Y)
            $left.X1 = [math]::Max($left.X1, $right.X1); $left.Y1 = [math]::Max($left.Y1, $right.Y1)
            $left.N += $right.N
            $comps.RemoveAt($b)
            $merged = $true
          }
        }
      }
    }
  }

  $sorted = $comps | Sort-Object Y, X
  Write-Host "$($sorted.Count) component(s) in region $rx,$ry,$rw,$rh"
  if ($OutDir) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

  [int]$idx = 0
  foreach ($c in $sorted) {
    [int]$w = $c.X1 - $c.X + 1; [int]$h = $c.Y1 - $c.Y + 1
    [int]$ax = $rx + $c.X; [int]$ay = $ry + $c.Y
    Write-Host ("  [{0,2}] sheet x{1,4} y{2,4}   {3,3} x {4,-3}  {5} px" -f $idx, $ax, $ay, $w, $h, $c.N)
    if ($OutDir) {
      $rect = New-Object System.Drawing.Rectangle $ax, $ay, $w, $h
      $part = $bmp.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try { $part.Save((Join-Path $OutDir ("part-{0:d2}.png" -f $idx)), [System.Drawing.Imaging.ImageFormat]::Png) }
      finally { $part.Dispose() }
    }
    $idx = $idx + 1
  }
} finally { $bmp.Dispose() }
