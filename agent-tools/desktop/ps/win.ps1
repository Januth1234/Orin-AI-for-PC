param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class OrinWin {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static string ForegroundTitle() {
        var sb = new StringBuilder(512);
        GetWindowText(GetForegroundWindow(), sb, 512);
        return sb.ToString();
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

[OrinWin]::SetProcessDPIAware() | Out-Null

switch ($Mode.ToLower()) {
    'list' {
        $rows = Get-Process | Where-Object { $_.MainWindowTitle } |
            Sort-Object ProcessName |
            ForEach-Object { "{0}`t{1}`t{2}" -f $_.Id, $_.ProcessName, $_.MainWindowTitle }
        $rows | ForEach-Object { Write-Output $_ }
    }
    'activate' {
        if ($Rest.Count -lt 1) { throw "activate needs a title substring" }
        $needle = [string]::Join(' ', $Rest)
        $target = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.ToLower().Contains($needle.ToLower()) } |
            Select-Object -First 1
        if (-not $target) { throw "No window title containing '$needle'" }
        [OrinWin]::ShowWindow($target.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
        [OrinWin]::SetForegroundWindow($target.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 250
        Write-Output "activated PID $($target.Id): $($target.MainWindowTitle)"
    }
    'rect' {
        if ($Rest.Count -lt 1) { throw "rect needs a title substring" }
        $needle = [string]::Join(' ', $Rest)
        $target = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.ToLower().Contains($needle.ToLower()) } |
            Select-Object -First 1
        if (-not $target) { throw "No window title containing '$needle'" }
        $rect = New-Object OrinWin+RECT
        [OrinWin]::GetWindowRect($target.MainWindowHandle, [ref]$rect) | Out-Null
        Write-Output "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
    }
    default { throw "Unknown mode '$Mode' (use list | activate | rect)" }
}
