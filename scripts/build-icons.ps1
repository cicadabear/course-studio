$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$public = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public'))

foreach ($size in @(512,180)) {
  $bitmap = [Drawing.Bitmap]::new($size,$size,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $pen = [Drawing.Pen]::new([Drawing.Color]::White,4)
  $glyph = [Drawing.Drawing2D.GraphicsPath]::new()
  try {
    $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#ff6b00'))
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($size / 64.0),($size / 64.0))
    $pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    # Match icon.svg's book mark, on an opaque full-bleed square for iOS.
    $glyph.AddLine(18,20,30,20)
    $glyph.AddBezier(30,20,35,20,39,23,39,28)
    $glyph.AddLine(39,28,39,46)
    $glyph.AddBezier(39,46,35,42,31,41,18,41)
    $glyph.AddLine(18,41,18,20)
    $glyph.StartFigure()
    $glyph.AddLine(46,20,34,20)
    $graphics.DrawPath($pen,$glyph)
    $name = if ($size -eq 512) {'media-artwork.png'} else {'apple-touch-icon.png'}
    $bitmap.Save((Join-Path $public $name),[Drawing.Imaging.ImageFormat]::Png)
    Write-Output "$name ${size}x${size}"
  } finally {
    $glyph.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
  }
}
