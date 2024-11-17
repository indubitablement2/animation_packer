import { MaxRectsPacker } from 'maxrects-packer'
import JSZip from 'jszip'

const ANIMATION_ID = [
  "IDLE",
  "MOVE",
  "ATTACK",
];

const MAX_MERGE_WASTE = 16000;
const MAX_RECT_SIZE = 512;

// image_size, page_idx, page_offset, draw_offset
let output_json = {};
let output_pages = [];

for (const animation_id of ANIMATION_ID) {
  let animation = document.createElement('div');
  animation.innerHTML = `
    <label for="${animation_id}">${animation_id}:</label>
    <input type="file" id="${animation_id}" accept="image" multiple />
  `;
  document.getElementById('animations').appendChild(animation);
}

document.getElementById("auto").addEventListener("change", _onAuto);
document.getElementById("clear").addEventListener("click", _onClear);
document.getElementById("generate").addEventListener("click", _onGenerate);
document.getElementById("animation_page").addEventListener("change", _onAnimationPage);
document.getElementById("download").addEventListener("click", _onDownload);

function _onAuto() {
  const files = document.getElementById("auto").files;

  const order = [...ANIMATION_ID];
  order.sort();
  order.reverse();

  for (const file of files) {
    const fileName = file.name.toUpperCase();
    for (const animation_id of order) {
      if (fileName.startsWith(animation_id)) {
        const inputElement = document.getElementById(animation_id);
        const dataTransfer = new DataTransfer();
        for (const existingFile of inputElement.files) {
          dataTransfer.items.add(existingFile);
        }
        dataTransfer.items.add(file);
        inputElement.files = dataTransfer.files;
        break;
      }
    }
  }
  document.getElementById("auto").value = "";
}

function _onClear() {
  for (const animation_id of ANIMATION_ID) {
    document.getElementById(`${animation_id}`).value = "";
  }
}

async function _onGenerate() {
  let total_files = 0;
  for (const animation_id of ANIMATION_ID) {
    total_files += document.getElementById(`${animation_id}`).files.length;
  }
  if (total_files === 0) {
    return;
  }

  document.getElementById('output').hidden = true;
  document.getElementById("generate").hidden = true;
  document.getElementById("progress").hidden = false;
  document.getElementById("progress").textContent = "0%";


  let progress = 0;

  /**
   * @type {HTMLCanvasElement[][]}
   */
  const animations = [];
  /**
   * @type {HTMLCanvasElement[]}
   */
  const canvases = [];

  for (const animation_id of ANIMATION_ID) {
    const animation = [];

    const files = document.getElementById(`${animation_id}`).files;
    for (let animation_frame = 0; animation_frame < files.length; animation_frame++) {
      const file = files[animation_frame];
      console.log(file);

      animation.push(await parse_image(file, canvases));

      progress += 1 / total_files * 90;
      document.getElementById("progress").textContent = progress.toFixed(2) + "%";
    }

    animations.push(animation);
  }

  // Pack images into atlas.
  const options = {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
    tag: false,
    exclusiveTag: false,
    border: 0
  };
  let packer = new MaxRectsPacker(2048, 2048, 1, options);

  let input = [];
  for (const canvas of canvases) {
    for (const rect of canvas["rects"]) {
      rect["canvas"] = canvas;
      input.push({ width: rect.width, height: rect.height, data: rect });
    }
  }
  packer.addArray(input);

  document.getElementById("progress").textContent = "95%";

  // Create output pages.
  const pages = packer.bins;
  output_pages = [];
  for (let page_idx = 0; page_idx < pages.length; page_idx++) {
    const page = pages[page_idx];
    const out_canvas = document.createElement("canvas");
    out_canvas.width = page.width;
    out_canvas.height = page.height;
    const ctx = out_canvas.getContext("2d");
    for (const _rect of page.rects) {
      const rect = _rect.data;
      const in_canvas = rect.canvas;
      rect["page_idx"] = page_idx;
      rect["page_offset_x"] = _rect.x;
      rect["page_offset_y"] = _rect.y;
      const sx = rect.x;
      const sy = rect.y;
      const w = _rect.width;
      const h = _rect.height;
      const dx = _rect.x;
      const dy = _rect.y;
      ctx.drawImage(in_canvas, sx, sy, w, h, dx, dy, w, h);
    }
    output_pages.push(out_canvas);
  }

  // Generate output json.
  output_json = {};
  for (let animation_idx = 0; animation_idx < animations.length; animation_idx++) {
    const animation_id = ANIMATION_ID[animation_idx];
    const animation = animations[animation_idx];
    const frames = [];
    for (const canvas of animation) {
      const rects = [];
      for (const rect of canvas.rects) {
        rects.push(rect.data);
      }
      frames.push(rects);
      // frames.push({
      //   "width": img.width,
      //   "height": img.height,
      //   "page_idx": img["page_idx"],
      //   "page_offset_x": img["page_offset_x"],
      //   "page_offset_y": img["page_offset_y"],
      //   "draw_offset_x": img["draw_offset_x"],
      //   "draw_offset_y": img["draw_offset_y"],
      // });
    }

    if (frames.length > 0) {
      output_json[animation_id] = frames;
    }
  }
  console.log(output_json);

  document.getElementById("animation_page").max = output_pages.length - 1;
  document.getElementById("animation_page").value = 0;
  _onAnimationPage();

  document.getElementById('output').hidden = false;
  document.getElementById("generate").hidden = false;
  document.getElementById("progress").hidden = true;
}

function _onAnimationPage() {
  const page = parseInt(document.getElementById("animation_page").value);
  const canvas = output_pages[page];
  document.getElementById('output_canvas').width = canvas.width / 2;
  document.getElementById('output_canvas').height = canvas.height / 2;
  const ctx = document.getElementById('output_canvas').getContext("2d");
  ctx.drawImage(canvas, 0, 0, canvas.width / 2, canvas.height / 2);
}

function _onDownload() {
  const zip = new JSZip();
  for (let i = 0; i < output_pages.length; i++) {
    // save as webp
    zip.file(`page${i}.webp`, output_pages[i].toDataURL("image/webp", 1).split("base64,")[1], { base64: true });
  }
  zip.file('animations.json', JSON.stringify(output_json));
  zip.generateAsync({ type: "blob" }).then(function (content) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "animation.zip";  // Set the name of the download file
    link.click();  // Trigger the download
    URL.revokeObjectURL(link.href);
  });
}
/**
 * 
 * @param {*} file 
 * @param {HTMLCanvasElement[]} canvases 
 * @returns {Promise<HTMLCanvasElement>}
 */
async function parse_image(file, canvases) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
  canvas["pixels"] = pixels;

  // Check for duplicate images
  for (const other of canvases) {
    const other_pixels = other["pixels"];
    if (pixels.length !== other_pixels.length) {
      continue;
    }

    let duplicate = true;
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] !== other_pixels[i]) {
        duplicate = false;
        break;
      }
    }
    if (duplicate) {
      console.log('duplicate image');
      return other;
    }
  }

  const rects = [];

  // Identify stating rects
  for (let y = 0; y < img.height; y++) {
    let x_start = 0;
    let was_visible = pixels[y * img.width * 4 + 3] > 0;
    for (let x = 0; x < img.width; x++) {
      const is_visible = pixels[(y * img.width + x) * 4 + 3] > 0;
      if (is_visible !== was_visible) {
        if (was_visible) {
          rects.push({ x: x_start, y: y, width: x - x_start, height: 1, used_pixels: x - x_start });
        }
        x_start = x;
        was_visible = is_visible;
      }
    }
    if (was_visible) {
      rects.push({ x: x_start, y: y, width: x - x_start, height: 1, used_pixels: x - x_start });
    }
  }

  // Merge rects
  while (rects.length > 1) {
    let smallest_waste = Number.MAX_VALUE;
    let smallest_rect_a;
    let smallest_rect_b;

    // Find the next best pair to merge
    for (let i = 0; i < rects.length - 1; i++) {
      const rect_a = rects[i];
      for (let j = i + 1; j < rects.length; j++) {
        const rect_b = rects[j];

        let new_rect = rect_merge(rect_a, rect_b);
        if (rect_wasted_pixels(new_rect) < smallest_waste
          && new_rect.width <= MAX_RECT_SIZE
          && new_rect.height <= MAX_RECT_SIZE) {
          smallest_waste = rect_wasted_pixels(new_rect);
          smallest_rect_a = rect_a;
          smallest_rect_b = rect_b;
        }
      }
    }

    if (smallest_waste > MAX_MERGE_WASTE) {
      break;
    }

    // Merge the best pair
    let merged_rects = new Set();
    merged_rects.add(smallest_rect_a);
    merged_rects.add(smallest_rect_b);
    let new_rect = rect_merge(smallest_rect_a, smallest_rect_b);
    let i = 0;
    while (i < rects.length) {
      const other_rect = rects[i];
      if (rect_intersect(new_rect, other_rect) && !merged_rects.has(other_rect)) {
        new_rect = rect_merge(new_rect, other_rect);
        merged_rects.add(other_rect);
        i = 0;
      } else {
        i += 1;
      }
    }

    // Remove merged rects
    for (const rect of merged_rects) {
      rects.splice(rects.indexOf(rect), 1);
    }
    rects.push(new_rect);
  }

  // Split any rect above 512
  let i = 0;
  while (i < rects.length) {
    const rect = rects[i];
    if (rect.width > MAX_RECT_SIZE) {
      rects.push({ x: rect.x + MAX_RECT_SIZE, y: rect.y, width: rect.width - MAX_RECT_SIZE, height: rect.height });
      rect.width = MAX_RECT_SIZE;
    } else if (rect.height > MAX_RECT_SIZE) {
      rects.push({ x: rect.x, y: rect.y + MAX_RECT_SIZE, width: rect.width, height: rect.height - MAX_RECT_SIZE });
      rect.height = MAX_RECT_SIZE;
    } else {
      i += 1;
    }
  }

  // Remove empty space from rects
  for (const rect of rects) {
    let x_start = rect.x;
    let x_end = rect.x + rect.width;
    let y_start = rect.y;
    let y_end = rect.y + rect.height;
    for (let y = rect.y; y < y_end; y++) {
      for (let x = rect.x; x < x_end; x++) {
        if (pixels[(y * img.width + x) * 4 + 3] > 0) {
          x_start = Math.min(x_start, x);
          x_end = Math.max(x_end, x + 1);
          y_start = Math.min(y_start, y);
          y_end = Math.max(y_end, y + 1);
        }
      }
    }
    rect.x = x_start;
    rect.y = y_start;
    rect.width = x_end - x_start;
    rect.height = y_end - y_start;
  }

  // Calculate draw offset for each rects
  const offset_x = parseFloat(document.getElementById("offset_x").value);
  const offset_y = parseFloat(document.getElementById("offset_y").value);
  for (const rect of rects) {
    rect["draw_offset_x"] = rect.x - img.width * offset_x;
    rect["draw_offset_y"] = rect.y - img.height * offset_y;
  }

  canvas["rects"] = rects;
  canvases.push(canvas);
  return canvas;
}

function rect_merge(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x_end = Math.max(a.x + a.width, b.x + b.width);
  const y_end = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: x,
    y: y,
    width: x_end - x,
    height: y_end - y,
    used_pixels: a.used_pixels + b.used_pixels,
  };
}

function rect_area(rect) {
  return rect.width * rect.height;
}

function rect_wasted_pixels(rect) {
  return rect_area(rect) - rect.used_pixels;
}

function rect_intersect(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}
