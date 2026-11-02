$ErrorActionPreference = 'Stop'
$buildRoot = 'F:\DotNotesBuild'
$repo = Join-Path $buildRoot 'upstream-joplin'
if ((git -C $repo rev-parse HEAD).Trim() -ne 'e41516e669efb693b009bedb21f3eb1fcbea4fc9') { throw 'Unexpected source revision' }
$env:TEMP = Join-Path $buildRoot 'tmp'
$env:TMP = $env:TEMP
$env:YARN_CACHE_FOLDER = Join-Path $buildRoot 'yarn-cache'
$env:YARN_GLOBAL_FOLDER = Join-Path $buildRoot 'yarn-global'
$env:YARN_ENABLE_SCRIPTS = 'false'
$env:YARN_CHECKSUM_BEHAVIOR = 'throw'
$env:npm_config_cache = Join-Path $buildRoot 'npm-cache'
$env:COREPACK_HOME = Join-Path $buildRoot 'corepack'
$env:GRADLE_USER_HOME = Join-Path $buildRoot 'gradle-cache'
$env:SKIP_ONENOTE_CONVERTER_BUILD = '1'
Set-Location -LiteralPath $repo
$yarn = Join-Path $repo '.yarn\releases\yarn-4.16.0.cjs'
# Only reviewed mobile dependency build scripts, no release/publish/clean task.
& node $yarn workspaces foreach --recursive --from '@joplin/app-mobile' --exclude '@joplin/onenote-converter' --topological-dev run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node $yarn workspaces foreach --recursive --from '@joplin/app-mobile' --topological-dev run tsc
exit $LASTEXITCODE
