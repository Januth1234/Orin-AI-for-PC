// Deterministic simulated desktop. Frames are rendered with raw pixel rects
// (no font stack): a dark canvas, an amber "window" with grey content bars and
// a big blocky action counter, so every action visibly changes the frame.
use super::controller::{clamp_norm, encode_jpeg_rgb, ComputerController, CuResult};
use image::{Rgb, RgbImage};

const BG: Rgb<u8> = Rgb([0x14, 0x13, 0x11]);
const AMBER: Rgb<u8> = Rgb([0xe0, 0x8a, 0x3c]);
const AMBER_DARK: Rgb<u8> = Rgb([0xb0, 0x6a, 0x24]);
const GREY: Rgb<u8> = Rgb([0x6b, 0x65, 0x60]);
const GREY_DARK: Rgb<u8> = Rgb([0x4a, 0x46, 0x43]);
const PANEL: Rgb<u8> = Rgb([0x1d, 0x1b, 0x18]);
const DIGIT: Rgb<u8> = Rgb([0xf2, 0xc9, 0x8a]);
const MARKER: Rgb<u8> = Rgb([0xf2, 0xe6, 0xd8]);

const W: u32 = 960;
const H: u32 = 600;

pub struct VirtualDesktop {
    counter: u32,
    last_action: String,
}

impl VirtualDesktop {
    pub fn new() -> Self {
        Self { counter: 0, last_action: "session started".into() }
    }

    fn note(&mut self, what: String) {
        self.counter = self.counter.wrapping_add(1);
        self.last_action = what;
    }

    fn render(&self) -> RgbImage {
        let mut img = RgbImage::from_pixel(W, H, BG);

        // The amber "app window" with a title bar.
        fill_rect(&mut img, 120, 90, 840, 520, AMBER);
        fill_rect(&mut img, 120, 90, 840, 132, AMBER_DARK);

        // A few grey content bars.
        fill_rect(&mut img, 150, 160, 650, 178, GREY);
        fill_rect(&mut img, 150, 196, 570, 214, GREY);
        fill_rect(&mut img, 150, 232, 620, 250, GREY_DARK);
        fill_rect(&mut img, 150, 268, 540, 286, GREY_DARK);

        // Counter panel: blocky pixel digits of the action counter.
        fill_rect(&mut img, 640, 420, 820, 500, PANEL);
        let digits = format!("{:02}", self.counter.min(99));
        draw_digits(&mut img, 668, 440, &digits, 10, DIGIT);

        // A marker that slides with the counter so consecutive frames differ
        // even when the digit count hasn't ticked over.
        let mx = 140 + ((self.counter as u64 * 97) % 640) as i32;
        fill_rect(&mut img, mx, 320, mx + 18, 338, MARKER);

        // Bottom status strip: a bar whose width tracks the last action length.
        let width = 40 + (self.last_action.chars().count() as i32 * 6).min(560);
        fill_rect(&mut img, 150, 540, 150 + width, 556, GREY_DARK);

        img
    }
}

fn fill_rect(img: &mut RgbImage, x0: i32, y0: i32, x1: i32, y1: i32, color: Rgb<u8>) {
    let (w, h) = (img.width() as i32, img.height() as i32);
    let (x0, x1) = (x0.clamp(0, w), x1.clamp(0, w));
    let (y0, y1) = (y0.clamp(0, h), y1.clamp(0, h));
    for y in y0..y1 {
        for x in x0..x1 {
            img.put_pixel(x as u32, y as u32, color);
        }
    }
}

/// 3x5 pixel glyphs, scaled up — deliberately blocky, no font rendering.
fn glyph(digit: u8) -> [[bool; 3]; 5] {
    match digit {
        0 => [[true, true, true], [true, false, true], [true, false, true], [true, false, true], [true, true, true]],
        1 => [[false, true, false], [true, true, false], [false, true, false], [false, true, false], [true, true, true]],
        2 => [[true, true, true], [false, false, true], [true, true, true], [true, false, false], [true, true, true]],
        3 => [[true, true, true], [false, false, true], [true, true, true], [false, false, true], [true, true, true]],
        4 => [[true, false, true], [true, false, true], [true, true, true], [false, false, true], [false, false, true]],
        5 => [[true, true, true], [true, false, false], [true, true, true], [false, false, true], [true, true, true]],
        6 => [[true, true, true], [true, false, false], [true, true, true], [true, false, true], [true, true, true]],
        7 => [[true, true, true], [false, false, true], [false, false, true], [false, false, true], [false, false, true]],
        8 => [[true, true, true], [true, false, true], [true, true, true], [true, false, true], [true, true, true]],
        9 => [[true, true, true], [true, false, true], [true, true, true], [false, false, true], [true, true, true]],
        _ => [[false; 3]; 5],
    }
}

fn draw_digits(img: &mut RgbImage, x: i32, y: i32, text: &str, scale: i32, color: Rgb<u8>) {
    let mut cx = x;
    for ch in text.chars() {
        if let Some(d) = ch.to_digit(10) {
            let g = glyph(d as u8);
            for (row, cells) in g.iter().enumerate() {
                for (col, on) in cells.iter().enumerate() {
                    if *on {
                        fill_rect(
                            img,
                            cx + (col as i32) * scale,
                            y + (row as i32) * scale,
                            cx + (col as i32 + 1) * scale,
                            y + (row as i32 + 1) * scale,
                            color,
                        );
                    }
                }
            }
        }
        cx += 4 * scale; // 3px glyph + 1px gap
    }
}

impl ComputerController for VirtualDesktop {
    async fn screenshot_jpeg(&self) -> CuResult<(Vec<u8>, u32, u32)> {
        encode_jpeg_rgb(&self.render())
    }

    fn move_mouse(&mut self, x: f64, y: f64) -> CuResult<()> {
        self.note(format!("move ({}, {})", clamp_norm(x) as i32, clamp_norm(y) as i32));
        Ok(())
    }

    fn click(&mut self, button: &str) -> CuResult<()> {
        self.note(format!("{button} click"));
        Ok(())
    }

    fn type_text(&mut self, text: &str) -> CuResult<()> {
        let short: String = text.chars().take(24).collect();
        self.note(format!("type “{short}”"));
        Ok(())
    }

    fn press_key(&mut self, key: &str) -> CuResult<()> {
        self.note(format!("press {key}"));
        Ok(())
    }

    fn scroll(&mut self, x: f64, y: f64, amount: i32) -> CuResult<()> {
        self.note(format!("scroll {} at ({}, {})", amount, clamp_norm(x) as i32, clamp_norm(y) as i32));
        Ok(())
    }

    fn drag(&mut self, from: (f64, f64), to: (f64, f64)) -> CuResult<()> {
        self.note(format!(
            "drag ({}, {}) → ({}, {})",
            clamp_norm(from.0) as i32,
            clamp_norm(from.1) as i32,
            clamp_norm(to.0) as i32,
            clamp_norm(to.1) as i32
        ));
        Ok(())
    }

    fn open_app(&mut self, name: &str) -> CuResult<()> {
        self.note(format!("open {name}"));
        Ok(())
    }

    fn focus_window(&mut self, title: &str) -> CuResult<()> {
        self.note(format!("focus “{title}”"));
        Ok(())
    }
}
