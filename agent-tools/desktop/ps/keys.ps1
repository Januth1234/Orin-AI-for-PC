param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class OrinKeys {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint count, INPUT[] inputs, int size);

    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint INPUT_KEYBOARD = 1;

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

    static INPUT KeyInput(ushort vk, ushort scan, uint flags) {
        var input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.U.ki.wVk = vk;
        input.U.ki.wScan = scan;
        input.U.ki.dwFlags = flags;
        return input;
    }

    public static void Send(INPUT[] inputs) {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != (uint)inputs.Length)
            throw new Exception("SendInput was blocked or failed");
    }

    // Type text through the unicode path so any layout/character works.
    public static void TypeText(string text) {
        foreach (char ch in text) {
            ushort scan = ch;
            ushort vk = 0;
            if (ch == '\n') { vk = 0x0D; scan = 0; }
            var down = KeyInput(vk, scan, vk == 0 ? KEYEVENTF_UNICODE : 0);
            var up = KeyInput(vk, scan, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
            Send(new[] { down });
            System.Threading.Thread.Sleep(6);
            Send(new[] { up });
            System.Threading.Thread.Sleep(6);
        }
    }

    static readonly System.Collections.Generic.Dictionary<string, ushort> VkMap =
        new System.Collections.Generic.Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase) {
            { "enter", 0x0D }, { "return", 0x0D }, { "tab", 0x09 }, { "esc", 0x1B }, { "escape", 0x1B },
            { "backspace", 0x08 }, { "back", 0x08 }, { "delete", 0x2E }, { "del", 0x2E },
            { "insert", 0x2D }, { "home", 0x24 }, { "end", 0x23 },
            { "pageup", 0x21 }, { "pgup", 0x21 }, { "pagedown", 0x22 }, { "pgdn", 0x22 },
            { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
            { "space", 0x20 }, { "win", 0x5B }, { "meta", 0x5B }, { "apps", 0x5D },
            { "shift", 0x10 }, { "ctrl", 0x11 }, { "control", 0x11 }, { "alt", 0x12 },
            { "capslock", 0x14 }, { "numlock", 0x90 }, { "scrolllock", 0x91 },
            { "printscreen", 0x2C },
            { "f1", 0x70 }, { "f2", 0x71 }, { "f3", 0x72 }, { "f4", 0x73 }, { "f5", 0x74 }, { "f6", 0x75 },
            { "f7", 0x76 }, { "f8", 0x77 }, { "f9", 0x78 }, { "f10", 0x79 }, { "f11", 0x7A }, { "f12", 0x7B },
        };

    public static ushort ResolveVk(string name) {
        if (name.Length == 1 && char.IsLetterOrDigit(name[0])) return (ushort)VkKeyScanSimple(char.ToUpperInvariant(name[0]));
        ushort vk;
        if (VkMap.TryGetValue(name, out vk)) return vk;
        throw new Exception("Unknown key: " + name);
    }

    static ushort VkKeyScanSimple(char ch) {
        // letters/digits map to their own VK codes
        if (ch >= '0' && ch <= '9') return (ushort)ch;
        if (ch >= 'A' && ch <= 'Z') return (ushort)ch;
        throw new Exception("Unsupported single key: " + ch);
    }

    public static void Tap(string name, int delayMs = 25) {
        ushort vk = ResolveVk(name);
        Send(new[] { KeyInput(vk, 0, 0) });
        System.Threading.Thread.Sleep(delayMs);
        Send(new[] { KeyInput(vk, 0, KEYEVENTF_KEYUP) });
    }

    // chord like ctrl+shift+p — modifiers held, last token tapped, released in reverse
    public static void Combo(string chord, int delayMs = 30) {
        string[] parts = chord.Split('+');
        if (parts.Length < 2) { Tap(chord); return; }
        var pressed = new System.Collections.Generic.List<ushort>();
        for (int i = 0; i < parts.Length - 1; i++) {
            ushort vk = ResolveVk(parts[i].Trim());
            pressed.Add(vk);
            Send(new[] { KeyInput(vk, 0, 0) });
            System.Threading.Thread.Sleep(15);
        }
        ushort last = ResolveVk(parts[parts.Length - 1].Trim());
        Send(new[] { KeyInput(last, 0, 0) });
        System.Threading.Thread.Sleep(delayMs);
        Send(new[] { KeyInput(last, 0, KEYEVENTF_KEYUP) });
        for (int i = pressed.Count - 1; i >= 0; i--) {
            System.Threading.Thread.Sleep(15);
            Send(new[] { KeyInput(pressed[i], 0, KEYEVENTF_KEYUP) });
        }
    }
}
"@

switch ($Mode.ToLower()) {
    'type' {
        $text = [string]::Join(' ', $Rest)
        [OrinKeys]::TypeText($text)
        Write-Output "typed $($text.Length) characters"
    }
    'key' {
        if ($Rest.Count -lt 1) { throw "key needs a name, e.g. key enter" }
        [OrinKeys]::Tap($Rest[0])
        Write-Output "tapped $($Rest[0])"
    }
    'combo' {
        if ($Rest.Count -lt 1) { throw "combo needs a chord, e.g. combo ctrl+shift+p" }
        [OrinKeys]::Combo($Rest[0])
        Write-Output "sent combo $($Rest[0])"
    }
    default { throw "Unknown mode '$Mode' (use type | key | combo)" }
}
