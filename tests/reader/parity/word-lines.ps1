# The text of each line of one paragraph as Word lays it out.
#   powershell -File word-lines.ps1 -File a.docx -Paragraph 8
param(
    [Parameter(Mandatory)] [string]$File,
    [Parameter(Mandatory)] [int]$Paragraph,
    [int]$Align = -1
)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($File, $false, $true, $false)
    $word.ActiveWindow.View.Type = 3
    $doc.Repaginate()
    if ($Align -ge 0) { $doc.Paragraphs.Item($Paragraph).Alignment = $Align; $doc.Repaginate() }
    $r = $doc.Paragraphs.Item($Paragraph).Range
    $sel = $word.Selection
    $sel.SetRange($r.Start, $r.Start)
    $lines = @()
    while ($sel.Start -lt $r.End - 1) {
        $start = $sel.Start
        $null = $sel.EndKey(5, 0)            # end of line, move
        $end = $sel.Start
        $lines += $doc.Range($start, [Math]::Min($end, $r.End)).Text
        $null = $sel.MoveRight(1, 1, 0)      # step past the line end
        if ($sel.Start -le $start) { break }
        $sel.SetRange($end, $end)
        $null = $sel.HomeKey(5, 0)
        if ($sel.Start -lt $end) { $sel.SetRange($end, $end) }
        $sel.Collapse(1)
        if ($sel.Start -eq $start) { break }
    }
    $font = $r.Font
    "font={0} size={1} width={2}pt kern={3}" -f $font.Name, $font.Size, ($doc.PageSetup.PageWidth - $doc.PageSetup.LeftMargin - $doc.PageSetup.RightMargin), $font.Kerning
    $i = 0
    foreach ($l in $lines) { $i++; "{0,2} [{1,3}] {2}" -f $i, $l.Length, ($l -replace '[\r\a]', '') }
    $doc.Close(0)
} finally {
    $word.Quit()
}
