// Computer Use controller abstraction. Every provider (virtual desktop, real
// Windows desktop) speaks normalized 0..1000 coordinates so DPI and multi-
// monitor quirks never leak into the model's decisions.

pub type CuResult<T> = Result<T, String>;

/// Coordinates are normalized to 0..=1000 over the primary screen/frame.
pub trait ComputerController {
    /// Capture the screen: returns (JPEG bytes, width px, height px).
    async fn screenshot_jpeg(&self) -> CuResult<(Vec<u8>, u32, u32)>;
    fn move_mouse(&mut self, x: f64, y: f64) -> CuResult<()>;
    fn click(&mut self, button: &str) -> CuResult<()>;
    fn type_text(&mut self, text: &str) -> CuResult<()>;
    fn press_key(&mut self, key: &str) -> CuResult<()>;
    fn scroll(&mut self, x: f64, y: f64, amount: i32) -> CuResult<()>;
    fn drag(&mut self, from: (f64, f64), to: (f64, f64)) -> CuResult<()>;
    fn open_app(&mut self, name: &str) -> CuResult<()>;
    fn focus_window(&mut self, title: &str) -> CuResult<()>;
}

pub fn clamp_norm(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1000.0)
    } else {
        0.0
    }
}

/// Encode an RGB8 frame as JPEG (quality 70). Shared by all providers.
pub fn encode_jpeg_rgb(frame: &image::RgbImage) -> CuResult<(Vec<u8>, u32, u32)> {
    use image::ImageEncoder as _;
    let (width, height) = frame.dimensions();
    let mut jpeg = std::io::Cursor::new(Vec::new());
    {
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 70);
        encoder
            .write_image(frame.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("Could not encode the screenshot: {e}"))?;
    }
    Ok((jpeg.into_inner(), width, height))
}
