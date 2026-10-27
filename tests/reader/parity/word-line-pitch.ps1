# Word's single-spaced line pitch for fonts: a new document, one paragraph of
# many lines per font at a given size, line spacing single, no spacing
# before or after; the pitch is the vertical distance between the first and
# last line's top divided by the line count minus one.
#   powershell -File word-line-pitch.ps1 [-Fonts "Aptos,Times New Roman"] [-Size 12]
param(
    [string]$Fonts = "Aptos,Aptos Display,Calibri,Calibri Light,Cambria,Times New Roman,Arial,Georgia,Segoe UI,Verdana,Garamond,Book Antiqua,Courier New,Consolas,Tahoma",
    [double]$Size = 12
)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Add()
    $word.ActiveWindow.View.Type = 3
    foreach ($font in $Fonts.Split(',')) {
        $doc.Content.Delete() | Out-Null
        $range = $doc.Content
        $range.Text = ("Word line pitch test " * 120).Trim()
        $p = $doc.Paragraphs.Item(1)
        $p.Range.Font.Name = $font
        $p.Range.Font.Size = $Size
        $p.LineSpacingRule = 0
        $p.SpaceBefore = 0
        $p.SpaceAfter = 0
        $doc.Repaginate()
        $r = $p.Range
        $lines = $r.ComputeStatistics(1)
        $first = $doc.Range($r.Start, $r.Start).Information(6)
        $last = $doc.Range($r.End - 1, $r.End - 1).Information(6)
        $pitch = ($last - $first) / ($lines - 1)
        "{0}`t{1}`tlines {2}`tpitch {3:N3} pt`tratio {4:N4}" -f $font, $Size, $lines, $pitch, ($pitch / $Size)
    }
    $doc.Close(0)
} finally {
    $word.Quit()
}
