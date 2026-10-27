# Width of a sample line set in each font inside a document, where Word
# substitutes a missing font as that document's font table says.
#   powershell -File word-widths-in-document.ps1 -File a.docx [-Fonts "A,B"]
param([string]$File,[string]$Fonts="Linux Libertine O,Linux Biolinum O,Times New Roman,Calibri,Cambria")
$text = "The quick brown fox jumps over the lazy dog, then reads 1234567890 pages."
$word = New-Object -ComObject Word.Application; $word.Visible=$false; $word.DisplayAlerts=0
try { $doc=$word.Documents.Open($File,$false,$true,$false); $word.ActiveWindow.View.Type=3
 $end=$doc.Content.End-1; $doc.Range($end,$end).InsertParagraphAfter(); $p=$doc.Paragraphs.Item($doc.Paragraphs.Count)
 foreach($font in $Fonts.Split(',')){ $p.Range.Text=$text; $p=$doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.Font.Name=$font; $p.Range.Font.Size=12; $p.Alignment=0; $p.LeftIndent=0; $p.FirstLineIndent=0; $doc.Repaginate()
  $r=$p.Range; $s=$doc.Range($r.Start,$r.Start).Information(5); $e=$doc.Range($r.End-1,$r.End-1).Information(5); $l=$doc.Range($r.End-1,$r.End-1).Information(10)
  "{0}`t{1:N2} pt (line {2})" -f $font,($e-$s),$l }
 $doc.Close(0) } finally { $word.Quit() }
