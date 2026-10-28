# Width of a sample text set in each font at 12 pt, as Word lays it out (the
# horizontal position after its last character), to compare fonts' widths.
#   powershell -File word-widths.ps1 [-Fonts "Aptos,Arial"]
param(
    [string]$Fonts = "Aptos,Aptos Display,Aptos Narrow,Calibri,Arial,Segoe UI,Verdana,Tahoma,Carlito,Liberation Sans"
)
$ErrorActionPreference = 'Stop'
$text = "The quick brown fox jumps over the lazy dog, then reads 1234567890 pages."
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Add()
    $word.ActiveWindow.View.Type = 3
    $doc.PageSetup.LeftMargin = 36
    $doc.PageSetup.RightMargin = 36
    foreach ($font in $Fonts.Split(',')) {
        $doc.Content.Delete() | Out-Null
        $doc.Content.Text = $text
        $p = $doc.Paragraphs.Item(1)
        $p.Range.Font.Name = $font
        $p.Range.Font.Size = 12
        $p.Alignment = 0
        $doc.Repaginate()
        $r = $p.Range
        $start = $doc.Range($r.Start, $r.Start).Information(5)
        $end = $doc.Range($r.End - 1, $r.End - 1).Information(5)
        "{0}`t{1:N2} pt" -f $font, ($end - $start)
    }
    $doc.Close(0)
} finally {
    $word.Quit()
}
