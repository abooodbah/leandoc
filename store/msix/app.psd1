@{
    # Read by New-StorePackage.ps1, New-StoreImages.ps1 and Test-StorePackage.ps1.
    AppId = 'LeanDoc'
    Executable = 'LeanDoc.exe'
    # The command alias; the ZIP installer registers the same name under App Paths.
    Alias = 'leandoc.exe'
    IconSvg = 'brand\leandoc-mark.svg'
    # The extensions installer\install.ps1 registers.
    Extensions = @('.docx', '.dotx', '.docm', '.dotm', '.doc', '.rtf', '.odt')
    RequiredFiles = @(
        'WebView2Loader.dll',
        'assets\reader.html',
        'assets\reader.css',
        'assets\reader.js',
        'tools\leandoc-inspect.exe'
    )
    # ZIP-only files. In the MSIX, Windows installs, associates and uninstalls.
    ExcludeFromPackage = @('installer', 'INSTALL.txt')
    ReleaseAssetPattern = 'LeanDoc-v{0}-windows-x64.zip'
    SampleFile = 'docs\images\screenshot-source\library-renovation-report.docx'
    # Used until the repository variables hold the Partner Center values.
    PlaceholderIdentityName = 'Placeholder.LeanDoc'
    PlaceholderPublisher = 'CN=PLACEHOLDER-SET-MSIX_PUBLISHER'
    DefaultPublisherDisplayName = 'Lean Apps Studio'
}
