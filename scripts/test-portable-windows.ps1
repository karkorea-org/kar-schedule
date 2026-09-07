$ErrorActionPreference = 'Stop'
$bundle = (Resolve-Path 'portable/KAR Schedule').Path
$runtime = Join-Path $bundle 'prerequisites/WebView2Runtime-x64.exe'
$signature = Get-AuthenticodeSignature -FilePath $runtime
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'The bundled WebView2 installer must have a valid Microsoft signature.'
}
$runtimeProcess = Start-Process -FilePath $runtime -ArgumentList '/silent', '/install' -WorkingDirectory $env:TEMP -PassThru
if (-not $runtimeProcess.WaitForExit(180000)) {
    Stop-Process -Id $runtimeProcess.Id -Force
    throw 'WebView2 setup timed out.'
}
if ($runtimeProcess.ExitCode -notin @(0, 3010)) {
    throw "WebView2 setup failed: $($runtimeProcess.ExitCode)"
}

function Get-BundleHashes {
    @(Get-ChildItem $bundle -Recurse -File | Sort-Object FullName | ForEach-Object {
        "$($_.FullName):$((Get-FileHash $_.FullName -Algorithm SHA256).Hash)"
    })
}

function Test-AppLaunch([string]$Executable) {
    $dataRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    $database = Join-Path $dataRoot 'kr.kar.schedule/kar-schedule.sqlite3'
    $app = Start-Process -FilePath $Executable -WorkingDirectory $env:TEMP -PassThru
    try {
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Seconds 1
            $app.Refresh()
            if ($app.HasExited) { throw "App exited during startup: $($app.ExitCode)" }
            if ($app.MainWindowHandle -ne 0 -and $app.MainWindowTitle -eq 'KAR 업무 일정' -and (Test-Path $database)) {
                $ready = $true
                break
            }
        }
        if (-not $ready) {
            Write-Output "Window: $($app.MainWindowTitle); expected SQLite: $database; APPDATA: $env:APPDATA"
            foreach ($root in @($dataRoot, $env:LOCALAPPDATA)) {
                Get-ChildItem (Join-Path $root 'kr.kar.schedule*') -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName, Length
            }
            throw 'Expected KAR window and per-user SQLite initialization did not finish.'
        }
        Write-Output "Startup passed: $Executable; local database: $database"
    } finally {
        if (-not $app.HasExited) {
            [void]$app.CloseMainWindow()
            if (-not $app.WaitForExit(15000)) { Stop-Process -Id $app.Id -Force }
        }
    }
}

$before = Get-BundleHashes
Test-AppLaunch (Join-Path $bundle 'kar-schedule.exe')
$shareName = 'KARPortableQA'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$shareCreated = $false
try {
    New-SmbShare -Name $shareName -Path $bundle -ReadAccess $account | Out-Null
    $shareCreated = $true
    Test-AppLaunch "\\localhost\$shareName\kar-schedule.exe"
} finally {
    if ($shareCreated) { Remove-SmbShare -Name $shareName -Force }
}
$after = Get-BundleHashes
if (Compare-Object $before $after) { throw 'App wrote to or changed its distribution folder.' }
Write-Output 'Local and read-only SMB startup passed. Distribution folder stayed unchanged.'
