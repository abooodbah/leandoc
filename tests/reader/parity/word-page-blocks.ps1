# The blocks Word lays out on one page (the page's Rectangles), with their
# top, height and first text, to compare a page with the reader's.
#   powershell -File word-page-blocks.ps1 -File a.docx -Page 3
param([Parameter(Mandatory)] [string]$File, [int]$Page = 1)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($File, $false, $true, $false)
    $word.ActiveWindow.View.Type = 3
    $doc.Repaginate()
    $pane = $word.ActiveWindow.Panes.Item(1)
    foreach ($rect in $pane.Pages.Item($Page).Rectangles) {
        $text = ""
        try {
            $raw = $rect.Range.Text
            $text = $raw.Substring(0, [Math]::Min(60, $raw.Length)).Replace("`r", " ").Replace([string][char]7, " ")
        } catch { $text = "(no text)" }
        "type {0} top {1} h {2} : {3}" -f $rect.RectangleType, $rect.Top, $rect.Height, $text
    }
    $doc.Close(0)
} finally {
    $word.Quit()
}
