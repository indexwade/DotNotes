param([Parameter(Mandatory=$true)][string]$Apk)
$ErrorActionPreference = 'Stop'
# Read-only ELF inspection of packaged 64-bit libraries. This is not runtime testing.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Apk))
$results = @()
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notmatch '^lib/(arm64-v8a|x86_64)/[^/]+\.so$') { continue }
        $memory = [IO.MemoryStream]::new()
        $stream = $entry.Open()
        try { $stream.CopyTo($memory); $bytes = $memory.ToArray() }
        finally { $stream.Dispose(); $memory.Dispose() }
        if ($bytes[0] -ne 127 -or $bytes[1] -ne 69 -or $bytes[2] -ne 76 -or $bytes[3] -ne 70 -or $bytes[4] -ne 2 -or $bytes[5] -ne 1) {
            throw "Unexpected ELF format: $($entry.FullName)"
        }
        $offset = [BitConverter]::ToUInt64($bytes,32)
        $size = [BitConverter]::ToUInt16($bytes,54)
        $count = [BitConverter]::ToUInt16($bytes,56)
        $loads = @(); $relros = @()
        for ($i=0; $i -lt $count; $i++) {
            $p = [int]($offset + $i*$size)
            $type = [BitConverter]::ToUInt32($bytes,$p)
            $header = [pscustomobject]@{
                offset = [BitConverter]::ToUInt64($bytes,$p+8)
                v = [BitConverter]::ToUInt64($bytes,$p+16)
                mem = [BitConverter]::ToUInt64($bytes,$p+40)
                align = [BitConverter]::ToUInt64($bytes,$p+48)
                flags = [BitConverter]::ToUInt32($bytes,$p+4)
            }
            if ($type -eq 1) { $loads += $header }
            if ($type -eq 0x6474e552) { $relros += $header }
        }
        if (-not $loads.Count) { throw "No LOAD segments: $($entry.FullName)" }
        $loadPass = @($loads | Where-Object { $_.align -lt 16384 -or ($_.offset%16384) -ne ($_.v%16384) }).Count -eq 0
        $relroPass = $true; $ownLoadException = $false
        foreach ($relro in $relros) {
            $end = $relro.v + $relro.mem
            if ($end%16384 -eq 0) { continue }
            $pageEnd = [math]::Ceiling($end/16384)*16384
            $pageStart = [math]::Floor($relro.v/16384)*16384
            # A non-aligned RELRO end is safe if page protection overlaps no writable
            # data outside RELRO (the official separate-LOAD-segment exception).
            $overlaps = @($loads | Where-Object {
                ($_.flags -band 2) -and $_.v -lt $pageEnd -and ($_.v+$_.mem) -gt $pageStart -and
                ($_.v -lt $relro.v -or ($_.v+$_.mem) -gt $end)
            })
            if ($overlaps.Count) { $relroPass = $false } else { $ownLoadException = $true }
        }
        $results += [pscustomobject]@{ library=$entry.FullName; load16K=$loadPass; relro16K=$relroPass; relroOwnLoadException=$ownLoadException }
    }
} finally { $archive.Dispose() }
[pscustomobject]@{
    apk=(Resolve-Path -LiteralPath $Apk).Path
    bytes=(Get-Item -LiteralPath $Apk).Length
    sha256=(Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash
    nativeRuntimeTested=$false
    libraries=$results
} | ConvertTo-Json -Depth 5
if (-not $results.Count -or @($results | Where-Object { -not $_.load16K -or -not $_.relro16K }).Count) { exit 1 }
