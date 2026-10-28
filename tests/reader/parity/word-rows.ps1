# Row tops (pt) of one table as Word lays it out, to read each row's height.
#   powershell -File word-rows.ps1 -File a.docx -Table 2
param([Parameter(Mandatory)] [string]$File, [Parameter(Mandatory)] [int]$Table)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($File, $false, $true, $false)
    $word.ActiveWindow.View.Type = 3
    $doc.Repaginate()
    $t = $doc.Tables.Item($Table)
    $prev = $null
    foreach ($row in $t.Rows) {
        $r = $doc.Range($row.Range.Start, $row.Range.Start)
        $y = $r.Information(6)
        $text = ($row.Range.Text -replace '[\x00-\x1f]', ' ' -replace '\s+', ' ').Trim()
        if ($text.Length -gt 30) { $text = $text.Substring(0, 30) }
        $h = if ($prev -ne $null) { $y - $prev } else { '' }
        "{0}`ttop {1}`tprev-row-height {2}`t{3}" -f $row.Index, $y, $h, $text
        $prev = $y
    }
    $after = $doc.Range($t.Range.End, $t.Range.End).Information(6)
    "end`t$after`tlast-row-height $($after - $prev)"
    $doc.Close(0)
} finally {
    $word.Quit()
}
