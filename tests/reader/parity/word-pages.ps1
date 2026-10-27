# Records Word's own pagination: the page count and the first text of every
# page's body, for comparison with the reader (probe.mjs).
#
#   powershell -File word-pages.ps1 -Out word.json -Files a.docx,b.docx
param(
    [Parameter(Mandatory)] [string]$Out,
    [Parameter(Mandatory)] [string[]]$Files
)
$ErrorActionPreference = 'Stop'
$wdGoToPage = 1; $wdGoToAbsolute = 1; $wdStatisticPages = 2
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$results = @()
try {
    foreach ($file in $Files) {
        $doc = $null
        try {
            $doc = $word.Documents.Open($file, $false, $true, $false)
            # Show the document as final, which is what the reader shows.
            $word.ActiveWindow.View.Type = 3
            $word.ActiveWindow.View.RevisionsFilter.Markup = 0
            $word.ActiveWindow.View.RevisionsFilter.View = 0
            $doc.Repaginate()
            $count = $doc.ComputeStatistics($wdStatisticPages)
            $firsts = @()
            for ($page = 1; $page -le $count; $page++) {
                $range = $doc.GoTo($wdGoToPage, $wdGoToAbsolute, $page)
                $end = [Math]::Min($range.Start + 200, $doc.Content.End)
                $text = $doc.Range($range.Start, $end).Text
                $text = ($text -replace '[\r\n\a\f\v\t]', ' ' -replace '[\x00-\x1f]', '' -replace '\s+', ' ').Trim()
                if ($text.Length -gt 80) { $text = $text.Substring(0, 80) }
                $firsts += $text
            }
            $results += [pscustomobject]@{ file = $file; pages = $count; firsts = $firsts }
            Write-Output ("{0}`t{1}" -f $count, (Split-Path $file -Leaf))
        } catch {
            $results += [pscustomobject]@{ file = $file; error = "$_" }
            Write-Output ("ERR`t{0}`t{1}" -f (Split-Path $file -Leaf), "$_")
        } finally {
            if ($doc) { $doc.Close(0) }
        }
    }
} finally {
    $word.Quit()
}
$results | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 $Out
