param(
    [string]$UnityPath,
    [string]$OutputPath = 'Builds\Android\NeuroAR.apk'
)

$ErrorActionPreference = 'Stop'
$taskProject = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskVersion = '6000.0.62f1'
if (-not $UnityPath) {
    $taskCandidates = @(
        (Join-Path ${env:ProgramFiles} "Unity\Hub\Editor\$taskVersion\Editor\Unity.exe"),
        (Join-Path ${env:ProgramFiles} 'Unity\Editor\Unity.exe')
    )
    $UnityPath = $taskCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $UnityPath -or -not (Test-Path -LiteralPath $UnityPath -PathType Leaf)) {
    throw "No se encontró Unity. Instala Unity $taskVersion con Android Build Support (SDK, NDK y OpenJDK) o indica -UnityPath 'C:\ruta\Editor\Unity.exe'."
}
$taskAbsoluteOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    [System.IO.Path]::GetFullPath($OutputPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $taskProject $OutputPath))
}
if ([System.IO.Path]::GetExtension($taskAbsoluteOutput) -ne '.apk') {
    throw 'OutputPath debe terminar en .apk.'
}
$taskLogFolder = Join-Path $taskProject 'Builds\Logs'
New-Item -ItemType Directory -Force -Path $taskLogFolder | Out-Null
$taskLog = Join-Path $taskLogFolder 'android-build.log'
$taskUnityArgs = @(
    '-batchmode', '-quit', '-nographics',
    '-projectPath', $taskProject,
    '-buildTarget', 'Android',
    '-executeMethod', 'NeuroAR.Editor.AndroidProjectSetup.BuildApk',
    '-neuroarOutput', $taskAbsoluteOutput,
    '-logFile', $taskLog
)
Write-Output "Compilando NeuroAR Android. Registro: $taskLog"
$taskStartedUtc = [DateTime]::UtcNow
& $UnityPath @taskUnityArgs | Out-Host
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $taskAbsoluteOutput -PathType Leaf) -or (Get-Item -LiteralPath $taskAbsoluteOutput).LastWriteTimeUtc -lt $taskStartedUtc) {
    throw "Unity no generó el APK. Revisa el registro: $taskLog"
}
Write-Output "APK generado: $taskAbsoluteOutput"
