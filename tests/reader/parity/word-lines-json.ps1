# Word's line breaks for many paragraphs, as JSON: for each paragraph its
# alignment, font, size, text width (pt) and the text of each line.
#   powershell -File word-lines-json.ps1 -File a.docx -Out lines.json -First 1 -Last 200
param(
    [Parameter(Mandatory)] [string]$File,
    [Parameter(Mandatory)] [string]$Out,
    [int]$First = 1,
    [int]$Last = 200,
    [switch]$Left
)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$rows = @()
try {
    $doc = $word.Documents.Open($File, $false, $true, $false)
    $word.ActiveWindow.View.Type = 3
    $word.ActiveWindow.View.RevisionsFilter.Markup = 0
    $word.ActiveWindow.View.RevisionsFilter.View = 0
    if ($Left) { foreach ($q in $doc.Paragraphs) { if ($q.Alignment -eq 3) { $q.Alignment = 0 } } }
    $doc.Repaginate()
    $sel = $word.Selection
    $Last = [Math]::Min($Last, $doc.Paragraphs.Count)
    for ($i = $First; $i -le $Last; $i++) {
        $p = $doc.Paragraphs.Item($i)
        $r = $p.Range
        if ($r.Information(12)) { continue }   # inside a table
        if ($r.End - $r.Start -lt 40) { continue }
        $lines = @()
        $pos = $r.Start
        $guard = 0
        while ($pos -lt $r.End - 1 -and $guard -lt 400) {
            $guard++
            # One character in, so the insertion point is on this line and not at
            # the end of the previous one.
            $probe = [Math]::Min($pos + 1, $r.End - 1)
            $sel.SetRange($probe, $probe)
            $null = $sel.EndKey(5, 0)
            $end = $sel.Start
            if ($end -le $pos) { break }
            $lines += $doc.Range($pos, [Math]::Min($end, $r.End)).Text
            $pos = $end
        }
        $ps = $doc.PageSetup
        $width = $ps.PageWidth - $ps.LeftMargin - $ps.RightMargin - $p.LeftIndent - $p.RightIndent
        $rows += [pscustomobject]@{
            i = $i; align = $p.Alignment; font = $r.Font.Name; size = $r.Font.Size
            width = $width; firstIndent = $p.FirstLineIndent; lines = $lines
        }
    }
    $doc.Close(0)
} finally {
    $word.Quit()
}
$rows | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 $Out
