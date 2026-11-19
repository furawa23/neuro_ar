param([switch]$SkipCore)

$ErrorActionPreference = 'Stop'
$taskProject = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw 'Instala el SDK de .NET 9 para ejecutar las verificaciones locales.'
}

Get-Content -LiteralPath (Join-Path $taskProject 'Packages\manifest.json') -Raw | ConvertFrom-Json | Out-Null
Write-Output 'Manifest de paquetes: JSON válido.'

if (-not $SkipCore) {
    & dotnet run --project (Join-Path $taskProject 'Tests\CoreChecks\CoreChecks.csproj') --configuration Release
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las verificaciones del núcleo neuronal.' }
    & dotnet run --project (Join-Path $taskProject 'Tests\PoseChecks\PoseChecks.csproj') --configuration Release
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las verificaciones de pose y orientación de cámara.' }
    if (Get-Command node -ErrorAction SilentlyContinue) {
        & node (Join-Path $taskProject 'scripts\generate-marker.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el marcador de impresión.' }
        & dotnet run --project (Join-Path $taskProject 'Tests\VisionChecks\VisionChecks.csproj') --configuration Release -- (Join-Path $taskProject 'Builds\Checks\marker-fixture.pgm')
    } else {
        Write-Output 'Node no está disponible: se verificará el detector con imágenes sintéticas; se omite regenerar el marcador.'
        & dotnet run --project (Join-Path $taskProject 'Tests\VisionChecks\VisionChecks.csproj') --configuration Release
    }
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las verificaciones del detector de marcador.' }
}

# Roslyn ships with the SDK. This generated checker has no NuGet package dependencies.
$taskSdkVersion = (& dotnet --version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'No se pudo localizar un SDK de .NET.' }
$taskSdkPattern = '^' + [regex]::Escape($taskSdkVersion) + ' \[(.+)\]$'
$taskSdkLine = & dotnet --list-sdks | Where-Object { $_ -match $taskSdkPattern } | Select-Object -First 1
if (-not $taskSdkLine -or -not ($taskSdkLine -match $taskSdkPattern)) {
    throw "No se encontró la carpeta del SDK $taskSdkVersion."
}
$taskSdkDirectory = Join-Path $Matches[1] $taskSdkVersion
$taskRoslyn = Join-Path $taskSdkDirectory 'Roslyn\bincore'
if (-not (Test-Path -LiteralPath (Join-Path $taskRoslyn 'Microsoft.CodeAnalysis.CSharp.dll'))) {
    throw 'El SDK no contiene los ensamblados de Roslyn necesarios.'
}
$taskMajor = [int]($taskSdkVersion.Split('.')[0])
if ($taskMajor -lt 9) { throw 'Se requiere el SDK de .NET 9 o posterior.' }
$taskChecks = Join-Path $taskProject 'Builds\Checks\Syntax'
New-Item -ItemType Directory -Force -Path $taskChecks | Out-Null
$taskRoslynXml = [System.Security.SecurityElement]::Escape($taskRoslyn)
@"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net$taskMajor.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="Microsoft.CodeAnalysis"><HintPath>$taskRoslynXml\Microsoft.CodeAnalysis.dll</HintPath></Reference>
    <Reference Include="Microsoft.CodeAnalysis.CSharp"><HintPath>$taskRoslynXml\Microsoft.CodeAnalysis.CSharp.dll</HintPath></Reference>
  </ItemGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $taskChecks 'SyntaxChecks.csproj') -Encoding UTF8
@'
<configuration><packageSources><clear /></packageSources></configuration>
'@ | Set-Content -LiteralPath (Join-Path $taskChecks 'NuGet.Config') -Encoding UTF8
@'
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

var files = Directory.GetFiles(args[0], "*.cs", SearchOption.AllDirectories);
var variants = new[]
{
    (Name: "Android", Symbols: new[] { "UNITY_ANDROID" }),
    (Name: "Editor Android", Symbols: new[] { "UNITY_EDITOR", "UNITY_ANDROID" }),
    (Name: "Editor Windows", Symbols: new[] { "UNITY_EDITOR", "UNITY_STANDALONE_WIN" })
};
var errors = 0;
foreach (var variant in variants)
{
    foreach (var file in files)
    {
        var options = new CSharpParseOptions(LanguageVersion.CSharp9, preprocessorSymbols: variant.Symbols);
        var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(file), options, file);
        foreach (var diagnostic in tree.GetDiagnostics().Where(item => item.Severity == DiagnosticSeverity.Error))
        {
            Console.Error.WriteLine($"[{variant.Name}] {diagnostic}");
            errors++;
        }
    }
}
Console.WriteLine($"Roslyn C# 9: {files.Length} archivos, {variants.Length} variantes, {errors} errores de sintaxis.");
Console.WriteLine("Este análisis no sustituye la compilación ni las pruebas de Unity/Android.");
Environment.ExitCode = errors == 0 ? 0 : 1;
'@ | Set-Content -LiteralPath (Join-Path $taskChecks 'Program.cs') -Encoding UTF8

& dotnet run --project (Join-Path $taskChecks 'SyntaxChecks.csproj') --configuration Release -- (Join-Path $taskProject 'Assets\NeuroAR')
if ($LASTEXITCODE -ne 0) { throw 'Se detectaron errores de sintaxis C#.' }
