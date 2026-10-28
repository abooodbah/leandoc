# Each table's height as Word lays it out: from the top of its first row to
# the top of the paragraph after it, when both are on one page.
#   powershell -File word-tables.ps1 -File a.docx
param([Parameter(Mandatory)] [string]$File)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($File, $false, $true, $false)
    $word.ActiveWindow.View.Type = 3
    $doc.Repaginate()
    $i = 0
    foreach ($t in $doc.Tables) {
        $i++
        $start = $doc.Range($t.Range.Start, $t.Range.Start)
        $after = $doc.Range($t.Range.End, $t.Range.End)
        $p1 = $start.Information(3); $p2 = $after.Information(3)
        $y1 = $start.Information(6); $y2 = $after.Information(6)
        $text = ($t.Range.Text -replace '[\x00-\x1f]', ' ' -replace '\s+', ' ').Trim()
        if ($text.Length -gt 40) { $text = $text.Substring(0, 40) }
        $h = if ($p1 -eq $p2) { [Math]::Round($y2 - $y1, 1) } else { "spans pages $p1-$p2" }
        "{0}`tpage {1}`trows {2}`tcols {3}`ttop {4}`theight(pt) {5}`t{6}" -f $i, $p1, $t.Rows.Count, $t.Columns.Count, $y1, $h, $text
    }
    $doc.Close(0)
} finally {
    $word.Quit()
}
