$ErrorActionPreference = 'Stop'
$guidePath = Join-Path $PSScriptRoot 'HandLink-System-Defense-Guide.docx'
$pdfPath = Join-Path $PSScriptRoot 'HandLink-System-Defense-Guide.pdf'
$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open($guidePath, $false, $false)
    $document.Fields.Update() | Out-Null
    foreach ($toc in $document.TablesOfContents) {
        $toc.Update()
    }
    $document.Repaginate()
    foreach ($toc in $document.TablesOfContents) {
        $toc.UpdatePageNumbers()
    }
    $document.Save()
    $document.ExportAsFixedFormat($pdfPath, 17)
    $pages = $document.ComputeStatistics(2)
    Write-Output "Word opened and saved the guide successfully. Pages: $pages"
    Write-Output "PDF exported: $pdfPath"
} finally {
    if ($null -ne $document) {
        $document.Close(0)
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) | Out-Null
    }
    if ($null -ne $word) {
        $word.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
