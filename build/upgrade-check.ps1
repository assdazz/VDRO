param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [string]$PreviousInstallDirectory = ''
)

# Read-only preflight. Never terminate an application or change user data.
# Exit: 0 = clear, 10 = application/media process active, 20 = cannot verify.
$ErrorActionPreference = 'Stop'
try {
    $roots = @($InstallDirectory, $PreviousInstallDirectory) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' } |
        Select-Object -Unique
    if (-not $roots) { exit 20 }
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='VDRO.exe' OR Name='ffmpeg.exe' OR Name='ffprobe.exe'")
    foreach ($process in $processes) {
        if ([string]::IsNullOrWhiteSpace($process.ExecutablePath)) {
            # A named process with an unreadable path cannot safely be identified.
            exit 20
        }
        $executable = [IO.Path]::GetFullPath($process.ExecutablePath)
        foreach ($root in $roots) {
            if ($executable.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { exit 10 }
        }
    }
    exit 0
} catch {
    exit 20
}
