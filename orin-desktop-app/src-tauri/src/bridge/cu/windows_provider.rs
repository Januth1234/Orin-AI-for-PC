// Real Windows desktop controller: input via enigo (SendInput), screen size
// via GetSystemMetrics, window focus via EnumWindows + SetForegroundWindow,
// and screenshots via a classic GDI BitBlt → GetDIBits → JPEG pipeline.
#![cfg(windows)]

use super::controller::{clamp_norm, encode_jpeg_rgb, ComputerController, CuResult};
use enigo::{
    Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings,
};

pub struct WindowsDesktop {
    enigo: Enigo,
}

impl WindowsDesktop {
    pub fn new() -> CuResult<Self> {
        let enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("Could not initialize desktop input control: {e}"))?;
        Ok(Self { enigo })
    }

    fn screen_size(&self) -> (i32, i32) {
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
        let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        if width <= 0 || height <= 0 {
            (1920, 1080) // sane fallback; GetSystemMetrics rarely fails
        } else {
            (width, height)
        }
    }

    /// Normalized 0..1000 → physical pixels on the primary screen.
    fn to_px(&self, x: f64, y: f64) -> (i32, i32) {
        let (w, h) = self.screen_size();
        let px = (clamp_norm(x) / 1000.0 * w as f64).round();
        let py = (clamp_norm(y) / 1000.0 * h as f64).round();
        (px.clamp(0.0, (w - 1) as f64) as i32, py.clamp(0.0, (h - 1) as f64) as i32)
    }

    fn input_err(e: enigo::InputError) -> String {
        format!("Input simulation failed: {e}")
    }
}

impl ComputerController for WindowsDesktop {
    async fn screenshot_jpeg(&self) -> CuResult<(Vec<u8>, u32, u32)> {
        capture_screen_gdi()
    }

    fn move_mouse(&mut self, x: f64, y: f64) -> CuResult<()> {
        let (px, py) = self.to_px(x, y);
        self.enigo
            .move_mouse(px, py, Coordinate::Abs)
            .map_err(Self::input_err)
    }

    fn click(&mut self, button: &str) -> CuResult<()> {
        match button.to_lowercase().as_str() {
            "right" => self
                .enigo
                .button(Button::Right, Direction::Click)
                .map_err(Self::input_err),
            "double" => {
                self.enigo.button(Button::Left, Direction::Click).map_err(Self::input_err)?;
                self.enigo.button(Button::Left, Direction::Click).map_err(Self::input_err)
            }
            _ => self
                .enigo
                .button(Button::Left, Direction::Click)
                .map_err(Self::input_err),
        }
    }

    fn type_text(&mut self, text: &str) -> CuResult<()> {
        if text.is_empty() {
            return Ok(());
        }
        self.enigo.text(text).map_err(Self::input_err)
    }

    fn press_key(&mut self, key: &str) -> CuResult<()> {
        let mut modifiers: Vec<Key> = Vec::new();
        let mut mains: Vec<Key> = Vec::new();
        for part in key.split('+') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            match part.to_lowercase().as_str() {
                "ctrl" | "control" | "ctl" => modifiers.push(Key::Control),
                "alt" | "option" => modifiers.push(Key::Alt),
                "shift" => modifiers.push(Key::Shift),
                "meta" | "win" | "windows" | "super" | "cmd" | "command" => modifiers.push(Key::Meta),
                other => match named_key(other) {
                    Some(k) => mains.push(k),
                    None => {
                        return Err(format!(
                            "I don't recognize the key “{part}”. Use names like enter, tab, esc, space, backspace, delete, up, ctrl+s."
                        ))
                    }
                },
            }
        }
        if mains.is_empty() && modifiers.is_empty() {
            return Ok(());
        }
        for m in &modifiers {
            self.enigo.key(*m, Direction::Press).map_err(Self::input_err)?;
        }
        if mains.is_empty() {
            // Modifier-only chord ("ctrl") — click the modifier itself.
            if let Some(m) = modifiers.first() {
                self.enigo.key(*m, Direction::Click).map_err(Self::input_err)?;
            }
        }
        for k in &mains {
            self.enigo.key(*k, Direction::Click).map_err(Self::input_err)?;
        }
        for m in modifiers.iter().rev() {
            self.enigo.key(*m, Direction::Release).map_err(Self::input_err)?;
        }
        Ok(())
    }

    fn scroll(&mut self, x: f64, y: f64, amount: i32) -> CuResult<()> {
        self.move_mouse(x, y)?;
        // enigo: positive length scrolls down on the vertical axis.
        self.enigo.scroll(amount.clamp(-20, 20), Axis::Vertical).map_err(Self::input_err)
    }

    fn drag(&mut self, from: (f64, f64), to: (f64, f64)) -> CuResult<()> {
        self.move_mouse(from.0, from.1)?;
        self.enigo.button(Button::Left, Direction::Press).map_err(Self::input_err)?;
        self.move_mouse(to.0, to.1)?;
        self.enigo.button(Button::Left, Direction::Release).map_err(Self::input_err)
    }

    fn open_app(&mut self, name: &str) -> CuResult<()> {
        if !is_safe_launch_name(name) {
            return Err(format!("“{name}” isn't something I'm allowed to launch."));
        }
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", name.trim()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Could not launch “{name}”: {e}"))?;
        Ok(())
    }

    fn focus_window(&mut self, title: &str) -> CuResult<()> {
        let needle = title.trim().to_lowercase();
        if needle.is_empty() {
            return Err("I need a window title to look for.".into());
        }
        let mut ctx = FindCtx { needle_lower: needle, found: None };
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::EnumWindows(
                Some(enum_proc),
                windows::Win32::Foundation::LPARAM(&mut ctx as *mut FindCtx as isize),
            )
            .map_err(|_| "Window enumeration failed.".to_string())?;
        }
        match ctx.found {
            Some(hwnd) => {
                let ok = unsafe { windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd) };
                if ok.as_bool() {
                    Ok(())
                } else {
                    Err("Windows refused to bring that window to the front.".into())
                }
            }
            None => Err(format!("No visible window matching “{title}” was found.")),
        }
    }
}

struct FindCtx {
    needle_lower: String,
    found: Option<windows::Win32::Foundation::HWND>,
}

unsafe extern "system" fn enum_proc(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::BOOL {
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextW, IsWindowVisible};
    let ctx = &mut *(lparam.0 as *mut FindCtx);
    if IsWindowVisible(hwnd).as_bool() {
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len > 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.to_lowercase().contains(&ctx.needle_lower) {
                ctx.found = Some(hwnd);
                return BOOL(0); // stop enumerating
            }
        }
    }
    BOOL(1)
}

fn named_key(name: &str) -> Option<Key> {
    let k = name.to_lowercase();
    Some(match k.as_str() {
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "space" => Key::Space,
        "backspace" | "bksp" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "pgup" => Key::PageUp,
        "pagedown" | "pgdn" => Key::PageDown,
        "up" | "arrowup" => Key::UpArrow,
        "down" | "arrowdown" => Key::DownArrow,
        "left" | "arrowleft" => Key::LeftArrow,
        "right" | "arrowright" => Key::RightArrow,
        "capslock" | "caps" => Key::CapsLock,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        single if single.chars().count() == 1 => {
            Key::Unicode(single.chars().next().unwrap_or(' '))
        }
        _ => return None,
    })
}

fn is_safe_launch_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed.chars().count() <= 200
        && trimmed
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | ':' | '/' | '\\'))
}

/// GDI screen capture: GetDC → CreateCompatibleDC/Bitmap → BitBlt → GetDIBits
/// (32-bit BGRA, top-down) → RGB → JPEG (quality 70). All GDI objects are
/// released on every path.
fn capture_screen_gdi() -> CuResult<(Vec<u8>, u32, u32)> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS,
        SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    if width <= 0 || height <= 0 {
        return Err("Could not determine the screen size for capture.".into());
    }
    let (width, height) = (width as u32, height as u32);

    let hdc_screen = unsafe { GetDC(None::<&HWND>) };
    if hdc_screen.is_invalid() {
        return Err("Could not get access to the screen for capture.".into());
    }

    let encode = (|| -> CuResult<Vec<u8>> {
        let hdc_mem = unsafe { CreateCompatibleDC(hdc_screen) };
        if hdc_mem.is_invalid() {
            return Err("Could not prepare the screen capture.".into());
        }
        let hbmp = unsafe { CreateCompatibleBitmap(hdc_screen, width as i32, height as i32) };
        if hbmp.is_invalid() {
            unsafe { DeleteDC(hdc_mem) };
            return Err("Could not allocate the screen capture buffer.".into());
        }
        let old_obj = unsafe { SelectObject(hdc_mem, hbmp) };
        let blit = unsafe { BitBlt(hdc_mem, 0, 0, width as i32, height as i32, hdc_screen, 0, 0, SRCCOPY) };
        // Unselect before GetDIBits, as documented.
        unsafe { SelectObject(hdc_mem, old_obj) };

        let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
        if let Err(blt_err) = blit {
            unsafe { DeleteObject(hbmp) };
            unsafe { DeleteDC(hdc_mem) };
            return Err(format!("Screen capture failed: {blt_err}"));
        }

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32), // top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: windows::Win32::Graphics::Gdi::BI_RGB.0,
            biSizeImage: pixels.len() as u32,
            ..Default::default()
        };
        let copied = unsafe {
            GetDIBits(
                hdc_mem,
                hbmp,
                0,
                height,
                Some(pixels.as_mut_ptr().cast()),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        };
        unsafe { DeleteObject(hbmp) };
        unsafe { DeleteDC(hdc_mem) };
        if copied == 0 {
            return Err("Screen capture failed while reading pixels.".into());
        }

        // BGRA → RGB.
        let mut rgb = Vec::with_capacity((width as usize) * (height as usize) * 3);
        for px in pixels.chunks_exact(4) {
            rgb.push(px[2]);
            rgb.push(px[1]);
            rgb.push(px[0]);
        }
        let frame = image::RgbImage::from_raw(width, height, rgb)
            .ok_or_else(|| "Screen capture produced a malformed frame.".to_string())?;
        encode_jpeg_rgb(&frame).map(|(bytes, _, _)| bytes)
    })();

    unsafe { ReleaseDC(None::<&HWND>, hdc_screen) };
    encode.map(|bytes| (bytes, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real capture against the actual desktop — proves the GDI pipeline works
    /// on this machine. Read-only: no input is injected.
    #[cfg(windows)]
    #[test]
    fn real_screen_capture_works() {
        let desktop = WindowsDesktop::new().expect("enigo init");
        let (jpeg, width, height) = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(desktop.screenshot_jpeg())
            .expect("screen capture failed");
        assert!(width >= 800 && height >= 600, "sane screen size, got {width}x{height}");
        // JPEG SOI marker + non-trivial payload (a blank frame still compresses).
        assert!(jpeg.len() > 5_000, "jpeg suspiciously small: {} bytes", jpeg.len());
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "missing JPEG SOI marker");
    }
}
