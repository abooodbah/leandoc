# Word's layout of the first paragraphs: page, top position on the page (pt),
# line count, and the start of the text. For diagnosis against the reader.
#
#   powershell -File word-paragraphs.ps1 -File a.docx -Out para.json [-Count 80]
param(
    [Parameter(Mandatory)] [string]$File,
    [Parameter(Mandatory)] [string]$Out,
    [int]$Count = 80,
    [int]$First = 1
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
    $doc.Repaginate()
    $n = [Math]::Min($First + $Count - 1, $doc.Paragraphs.Count)
    for ($i = $First; $i -le $n; $i++) {
        $p = $doc.Paragraphs.Item($i)
        $r = $p.Range
        $start = $doc.Range($r.Start, $r.Start)
        $endR = $doc.Range([Math]::Max($r.Start, $r.End - 1), [Math]::Max($r.Start, $r.End - 1))
        $text = ($r.Text -replace '[\x00-\x1f]', ' ' -replace '\s+', ' ').Trim()
        if ($text.Length -gt 50) { $text = $text.Substring(0, 50) }
        $rows += [pscustomobject]@{
            i = $i
            page = $start.Information(3)
            endPage = $endR.Information(3)
            top = [Math]::Round($start.Information(6), 2)
            lines = $r.ComputeStatistics(1)
            font = $r.Font.Name
            size = $r.Font.Size
            before = $p.SpaceBefore
            after = $p.SpaceAfter
            rule = $p.LineSpacingRule
            spacing = $p.LineSpacing
            text = $text
        }
    }
    $doc.Close(0)
} finally {
    $word.Quit()
}
$rows | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 $Out
