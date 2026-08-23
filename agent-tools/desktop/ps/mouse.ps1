param(
    [Parameter(Mandatory = $true)][string]$Action,
    [int]$X = -1,
    [int]$Y = -1,
    [int]$X2 = -1,
    [int]$Y2 = -1,
    [int]$Amount = 0
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class OrinMouse {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint count, INPUT[] inputs, int size);

    public const int SM_XVIRTUALSCREEN = 76;
    public const int SM_YVIRTUALSCREEN = 77;
    public const int SM_CXVIRTUALSCREEN = 78;
    public const int SM_CYVIRTUALSCREEN = 79;

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData;
        public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION U;
    }

    static INPUT MouseInput(uint flags, int dx = 0, int dy = 0, uint data = 0) {
        var input = new INPUT();
        input.type = 0;
        input.U.mi.dx = dx; input.U.mi.dy = dy;
        input.U.mi.mouseData = data;
        input.U.mi.dwFlags = flags;
        return input;
    }

    public static void Send(INPUT[] inputs) {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != (uint)inputs.Length)
            throw new Exception("SendInput was blocked or failed");
    }

    public static void MoveTo(int x, int y) {
        int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        int nx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
        int ny = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
        Send(new[] { MouseInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny) });
    }

    public static void PressLeft()   { Send(new[] { MouseInput(MOUSEEVENTF_LEFTDOWN) }); }
    public static void ReleaseLeft() { Send(new[] { MouseInput(MOUSEEVENTF_LEFTUP) }); }
    public static void ClickRight() {
        Send(new[] { MouseInput(MOUSEEVENTF_RIGHTDOWN) });
        System.Threading.Thread.Sleep(40);
        Send(new[] { MouseInput(MOUSEEVENTF_RIGHTUP) });
    }
    public static void Wheel(int amount) {
        Send(new[] { MouseInput(MOUSEEVENTF_WHEEL, 0, 0, (uint)(amount * 120)) });
    }
}
"@

[OrinMouse]::SetProcessDPIAware() | Out-Null

function Require-XY {
    if ($X -lt 0 -or $Y -lt 0) { throw "Action '$Action' needs -X and -Y physical pixel coordinates" }
}

switch ($Action.ToLower()) {
    'move' {
        Require-XY
        [OrinMouse]::MoveTo($X, $Y)
        Write-Output "moved to $X,$Y"
    }
    'click' {
        Require-XY
        [OrinMouse]::MoveTo($X, $Y)
        Start-Sleep -Milliseconds 70
        [OrinMouse]::PressLeft()
        Start-Sleep -Milliseconds 40
        [OrinMouse]::ReleaseLeft()
        Write-Output "left click at $X,$Y"
    }
    'double' {
        Require-XY
        [OrinMouse]::MoveTo($X, $Y)
        Start-Sleep -Milliseconds 70
        [OrinMouse]::PressLeft(); Start-Sleep -Milliseconds 40; [OrinMouse]::ReleaseLeft()
        Start-Sleep -Milliseconds 90
        [OrinMouse]::PressLeft(); Start-Sleep -Milliseconds 40; [OrinMouse]::ReleaseLeft()
        Write-Output "double click at $X,$Y"
    }
    'right' {
        Require-XY
        [OrinMouse]::MoveTo($X, $Y)
        Start-Sleep -Milliseconds 70
        [OrinMouse]::ClickRight()
        Write-Output "right click at $X,$Y"
    }
    'down' {
        Require-XY
        [OrinMouse]::MoveTo($X, $Y)
        Start-Sleep -Milliseconds 60
        [OrinMouse]::PressLeft()
        Write-Output "button held at $X,$Y (release with: orin up)"
    }
    'up' {
        Require-XY
        [OrinMouse]::MoveTo($X, $Y)
        [OrinMouse]::ReleaseLeft()
        Write-Output "released at $X,$Y"
    }
    'drag' {
        if ($X -lt 0 -or $Y -lt 0 -or $X2 -lt 0 -or $Y2 -lt 0) { throw "drag needs -X,-Y (from) and -X2,-Y2 (to)" }
        [OrinMouse]::MoveTo($X, $Y)
        Start-Sleep -Milliseconds 140
        [OrinMouse]::PressLeft()
        Start-Sleep -Milliseconds 120
        $steps = 14
        for ($i = 1; $i -le $steps; $i++) {
            $cx = [int]($X + ($X2 - $X) * $i / $steps)
            $cy = [int]($Y + ($Y2 - $Y) * $i / $steps)
            [OrinMouse]::MoveTo($cx, $cy)
            Start-Sleep -Milliseconds 18
        }
        Start-Sleep -Milliseconds 120
        [OrinMouse]::ReleaseLeft()
        Write-Output "dragged $X,$Y -> $X2,$Y2"
    }
    'scroll' {
        Require-XY
        [OrinMouse]::MoveTo($X, $Y)
        Start-Sleep -Milliseconds 60
        [OrinMouse]::Wheel($Amount)
        Write-Output "scrolled $($Amount) notches at $X,$Y"
    }
    default { throw "Unknown action '$Action'" }
}
