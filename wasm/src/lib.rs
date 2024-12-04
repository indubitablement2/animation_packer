use crc32fast::Hasher;
use serde_json::json;
use wasm_bindgen::prelude::*;

const MAX_MERGE_WASTE: u32 = 8192;
const MAX_RECT_SIZE: u32 = 512;

struct Rect {
    x: u32,
    y: u32,
    x_end: u32,
    y_end: u32,
    used_pixels: u32,
}
impl Rect {
    fn width(&self) -> u32 {
        self.x_end - self.x
    }

    fn height(&self) -> u32 {
        self.y_end - self.y
    }

    fn area(&self) -> u32 {
        self.width() * self.height()
    }

    fn wasted(&self) -> u32 {
        self.area() - self.used_pixels
    }

    fn intersect(&self, other: &Rect) -> bool {
        self.x < other.x_end && self.x_end > other.x && self.y < other.y_end && self.y_end > other.y
    }

    fn merge(&self, other: &Rect) -> Rect {
        Rect {
            x: self.x.min(other.x),
            y: self.y.min(other.y),
            x_end: self.x_end.max(other.x_end),
            y_end: self.y_end.max(other.y_end),
            used_pixels: self.used_pixels + other.used_pixels,
        }
    }
}

#[wasm_bindgen]
pub fn process(pixels: &[u8], width: usize, height: usize) -> String {
    assert!(pixels.len() == width * height * 4);

    let mut hasher = Hasher::new();
    let mut seen: Vec<usize> = vec![];

    // Identify stating rects.
    let mut rects = vec![];
    for y in 0..height {
        let mut x_start = 0;
        let mut was_visible = pixels[y * width * 4 + 3] != 0;
        for x in 0..width {
            let i = y * width + x;
            let col = &pixels[i * 4..i * 4 + 4];
            let is_visible = col[3] != 0;

            hasher.update(col);

            if is_visible != was_visible {
                if was_visible {
                    rects.push(Rect {
                        x: x_start as u32,
                        y: y as u32,
                        x_end: (x + 1) as u32,
                        y_end: (y + 1) as u32,
                        used_pixels: (x - x_start) as u32,
                    });
                }
                x_start = x;
                was_visible = is_visible;
            }
        }
        if was_visible {
            rects.push(Rect {
                x: x_start as u32,
                y: y as u32,
                x_end: width as u32,
                y_end: (y + 1) as u32,
                used_pixels: (width - x_start) as u32,
            });
        }
    }

    // Merge rects.
    while rects.len() > 1 {
        let mut smallest_waste = u32::MAX;
        let mut smallest_i = usize::MAX;
        let mut smallest_j = usize::MAX;

        // Find the next best pair to merge.
        for i in 0..rects.len() {
            let rect_a = &rects[i];
            for j in (i + 1)..rects.len() {
                let rect_b = &rects[j];

                let new_rect = rect_a.merge(&rect_b);
                if new_rect.wasted() < smallest_waste
                    && new_rect.width() <= MAX_RECT_SIZE
                    && new_rect.height() <= MAX_RECT_SIZE
                {
                    smallest_waste = new_rect.wasted();
                    smallest_i = i;
                    smallest_j = j;
                }
            }
        }

        if smallest_waste > MAX_MERGE_WASTE {
            break;
        }

        // Merge the best pair.
        let mut new_rect = rects[smallest_i].merge(&rects[smallest_j]);
        seen.clear();
        seen.push(smallest_i);
        seen.push(smallest_j);
        let mut i = 0;
        while i < rects.len() {
            if seen.contains(&i) {
                i += 1;
                continue;
            }
            let other_rect = &rects[i];
            if new_rect.intersect(other_rect) {
                new_rect = new_rect.merge(other_rect);
                seen.push(i);
                i = 0;
            } else {
                i += 1;
            }
        }

        // Remove merged rects
        seen.sort_unstable_by(|a, b| b.cmp(a));
        for i in seen.iter() {
            rects.swap_remove(*i);
        }
        rects.push(new_rect);
    }

    // Split any rect above threshold.
    let mut i = 0;
    while i < rects.len() {
        let rect = &rects[i];
        if rect.width() > MAX_RECT_SIZE {
            let x = rect.x;
            rects.push(Rect {
                x: rect.x + MAX_RECT_SIZE,
                y: rect.y,
                x_end: rect.x_end,
                y_end: rect.y_end,
                used_pixels: rect.used_pixels - MAX_RECT_SIZE,
            });
            rects[i].x_end = x + MAX_RECT_SIZE;
        } else if rect.height() > MAX_RECT_SIZE {
            let y = rect.y;
            rects.push(Rect {
                x: rect.x,
                y: rect.y + MAX_RECT_SIZE,
                x_end: rect.x_end,
                y_end: rect.y_end,
                used_pixels: rect.used_pixels - MAX_RECT_SIZE,
            });
            rects[i].y_end = y + MAX_RECT_SIZE;
        } else {
            i += 1;
        }
    }

    json!({
        "hash": hasher.finalize(),
        "rects": rects.iter().map(|r| {
            json!({
                "x": r.x,
                "y": r.y,
                "width": r.width(),
                "height": r.height(),
            })
        }).collect::<Vec<_>>(),
    })
    .to_string()
}
