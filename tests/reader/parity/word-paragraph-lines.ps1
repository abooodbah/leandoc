# Where Word puts each line of the first paragraph that contains a needle:
# page/top of each line, and the line text, with the paragraph's font and spacing.
#   powershell -File word-paragraph-lines.ps1 -File a.docx -Needle "text"
param([string]$File,[string]$Needle)
$word = New-Object -ComObject Word.Application; $word.Visible=$false; $word.DisplayAlerts=0
try { $doc=$word.Documents.Open($File,$false,$true,$false); $word.ActiveWindow.View.Type=3; $doc.Repaginate()
foreach($p in $doc.Paragraphs){ if($p.Range.Text.Contains($Needle)){ $r=$p.Range
 "font " + $r.Font.Name + " " + $r.Font.Size + " spacing " + $p.LineSpacingRule + "/" + $p.LineSpacing + " before " + $p.SpaceBefore + " after " + $p.SpaceAfter + " left " + $p.LeftIndent + " first " + $p.FirstLineIndent + " align " + $p.Alignment
 $prev=""; $line=""
 for($i=$r.Start;$i -lt $r.End-1;$i++){ $ch=$doc.Range($i,$i+1); $k="{0}/{1:N1}" -f $ch.Information(3),$ch.Information(6)
  if($k -ne $prev){ if($line){"$prev`t$line"}; $line=""; $prev=$k }; $line+=$ch.Text }
 "$prev`t$line"; break } }
$doc.Close(0) } finally { $word.Quit() }
