# Word's horizontal position (pt) of each character on the first line of a
# paragraph, made left-aligned, to read Word's per-character advance widths.
#   powershell -File word-advances.ps1 -File a.docx -Paragraph 14 [-Count 60]
param(
    [Parameter(Mandatory)] [string]$File,
    [Parameter(Mandatory)] [int]$Paragraph,
    [int]$Count = 60
)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($File, $false, $true, $false)
    $word.ActiveWindow.View.Type = 3
    $p = $doc.Paragraphs.Item($Paragraph)
    $p.Alignment = 0
    $doc.Repaginate()
    $r = $p.Range
    $out = @()
    for ($k = 0; $k -le $Count; $k++) {
        $c = $doc.Range($r.Start + $k, $r.Start + $k)
        $out += ("{0}`t{1}" -f $doc.Range($r.Start + $k, $r.Start + $k + 1).Text, $c.Information(5))
    }
    $out -join "`n"
    $doc.Close(0)
} finally {
    $word.Quit()
}
