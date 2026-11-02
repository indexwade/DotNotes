param(
    [string]$BuildRoot = 'F:\DotNotesBuild',
    [string]$JavaHome = 'C:\Program Files\Java\jdk-21',
    [ValidateSet('armeabi-v7a','arm64-v8a','x86','x86_64')]
    [string[]]$Architectures = @('armeabi-v7a','arm64-v8a','x86','x86_64')
)
$ErrorActionPreference = 'Stop'
# Uses already installed, reviewed tools. No downloads, cleanup, production keys or deployment.
$repo = Join-Path $BuildRoot 'upstream-joplin'
$gradle = Join-Path $BuildRoot 'tools\gradle-8.14.3\bin\gradle.bat'
$sdk = Join-Path $BuildRoot 'sdk'
foreach ($required in @($gradle, $JavaHome, $sdk, (Join-Path $repo 'packages\lib\services\plugins\dotNotesAssets.json'))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing prerequisite: $required" }
}
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_USER_HOME = Join-Path $BuildRoot 'android-user'
$env:GRADLE_USER_HOME = Join-Path $BuildRoot 'gradle-cache'
$env:TEMP = Join-Path $BuildRoot 'tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $BuildRoot 'npm-cache'
$env:CI = '1'
Push-Location (Join-Path $repo 'packages\app-mobile\android')
try {
    # Upstream profileable includes the JS bundle, uses its existing public test key.
    # Use one architecture selection for both application and dependency libraries.
    & $gradle assembleProfileable "-PreactNativeArchitectures=$($Architectures -join ',')" --no-daemon --max-workers=2 --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed: $LASTEXITCODE" }
} finally { Pop-Location }
