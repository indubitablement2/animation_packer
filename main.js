import { MaxRectsPacker } from 'maxrects-packer'
import JSZip from 'jszip'

const ANIMATION_ID = [
  //"portait"
  "idle",
  "move",
  "attack",
  "knockback",
  "death",
];

const RECT_SIZE = 256;

// {animation_id: frames[rects[...]]}
// { idle: [ [ [image_size, page_idx, page_offset, draw_offset], ... ] ] }
let output_json = {};
let output_pages = [];
let output_portrait = null;

/**
 * @type {HTMLInputElement}
 */
const images = document.getElementById("images");

images.addEventListener("change", _onImages);
document.getElementById("animation_page").addEventListener("change", _onAnimationPage);
document.getElementById("download").addEventListener("click", _onDownload);
const progress = document.getElementById("progress");

document.getElementById("animation_names").textContent = "Image names: portrait, " + ANIMATION_ID.join("#, ") + "#";

async function _onImages() {
  const files = images.files;
  if (files.length === 0) {
    return;
  }

  document.getElementById('output').hidden = true;
  progress.value = 0.0;

  /**
   * @type {{ file: File, image: Image, pixels: Uint8ClampedArray, x: number, y: number, width: number, height: number, animations: { animation_id: string, frame_idx: number }[], page_idx: number }[]}
   */
  const rects = [];

  output_portrait = null;

  // Process images into rects.
  for (const file of files) {
    const fileName = file.name.toLowerCase();
    if (fileName.startsWith("portrait")) {
      output_portrait = file;
    } else {
      for (const animation_id of ANIMATION_ID) {
        if (fileName.startsWith(animation_id)) {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          await img.decode()
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(0, 0, img.width, img.height).data;

          const animation_frame_idx = parseInt(fileName.replace(animation_id, ""));

          for (let rect_y = 0; rect_y < Math.ceil(img.height / RECT_SIZE); rect_y++) {
            for (let rect_x = 0; rect_x < Math.ceil(img.width / RECT_SIZE); rect_x++) {
              let x_min = Number.POSITIVE_INFINITY;
              let y_min = Number.POSITIVE_INFINITY;
              let x_max = Number.NEGATIVE_INFINITY;
              let y_max = Number.NEGATIVE_INFINITY;

              for (let y = rect_y * RECT_SIZE; y < rect_y * RECT_SIZE + RECT_SIZE; y++) {
                for (let x = rect_x * RECT_SIZE; x < rect_x * RECT_SIZE + RECT_SIZE; x++) {
                  if (pixels[(y * img.width + x) * 4 + 3] > 0) {
                    x_min = Math.min(x_min, x);
                    y_min = Math.min(y_min, y);
                    x_max = Math.max(x_max, x);
                    y_max = Math.max(y_max, y);
                  }
                }
              }

              if (x_min === Number.POSITIVE_INFINITY) {
                continue;
              }

              let w = x_max - x_min + 1;
              let h = y_max - y_min + 1;

              // Check if the rect is already in the list.
              let is_new = true;
              for (const other of rects) {
                if (other.x === x_min && other.y === y_min && other.width === w && other.height === h) {
                  let are_the_same = true;
                  for (let y = y_min; y <= y_max; y++) {
                    for (let x = x_min; x <= x_max; x++) {
                      if (pixels[(y * img.width + x) * 4 + 0] != other.pixels[(y * img.width + x) * 4 + 0]
                        || pixels[(y * img.width + x) * 4 + 1] != other.pixels[(y * img.width + x) * 4 + 1]
                        || pixels[(y * img.width + x) * 4 + 2] != other.pixels[(y * img.width + x) * 4 + 2]
                        || pixels[(y * img.width + x) * 4 + 3] != other.pixels[(y * img.width + x) * 4 + 3]) {
                        are_the_same = false;
                        break;
                      }
                    }
                    if (!are_the_same) {
                      break;
                    }
                  }
                  if (are_the_same) {
                    is_new = false;
                    other.animations.push({ animation_id: animation_id, frame_idx: animation_frame_idx });
                    break;
                  }
                }
              }
              if (is_new) {
                rects.push({
                  file: file,
                  image: img,
                  pixels: pixels,
                  x: x_min,
                  y: y_min,
                  width: w,
                  height: h,
                  animations: [{ animation_id: animation_id, frame_idx: animation_frame_idx }],
                  page_idx: -1
                });
              }
            }
          }

          break;
        }
      }
    }

    progress.value += 1 / files.length;
  }

  // Pack rects into atlas.
  const options = {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
    tag: false,
    exclusiveTag: false,
    border: 0
  };
  const packer = new MaxRectsPacker(2048, 2048, 1, options);
  let packer_input = [];
  for (const rect of rects) {
    packer_input.push({ width: rect.width, height: rect.height, data: rect });
  }
  packer.addArray(packer_input);

  // Create output pages.
  const pages = packer.bins;
  output_pages = [];
  for (let page_idx = 0; page_idx < pages.length; page_idx++) {
    const page = pages[page_idx];
    const out_canvas = document.createElement("canvas");
    out_canvas.width = page.width;
    out_canvas.height = page.height;
    const ctx = out_canvas.getContext("2d");
    for (const page_rect of page.rects) {
      const rect = page_rect.data;
      rect["page_rect"] = page_rect;

      rect.page_idx = page_idx;
      const sx = rect.x;
      const sy = rect.y;
      const w = page_rect.width;
      const h = page_rect.height;
      const dx = page_rect.x;
      const dy = page_rect.y;

      ctx.drawImage(rect.image, sx, sy, w, h, dx, dy, w, h);
    }
    output_pages.push(out_canvas);
  }

  // Generate output json.
  /**
   * @type {{ [key: string]: { [key: number]: any[] } }}
   */
  const animations = {};
  for (const rect of rects) {
    for (const rect_animation of rect.animations) {
      if (!animations[rect_animation.animation_id]) {
        animations[rect_animation.animation_id] = {};
      }
      if (!animations[rect_animation.animation_id][rect_animation.frame_idx]) {
        animations[rect_animation.animation_id][rect_animation.frame_idx] = [];
      }
      animations[rect_animation.animation_id][rect_animation.frame_idx].push(rect);
    }
  }
  const duplicate_frame = Number(document.getElementById("base_frame_rate").value);
  output_json = {};
  for (const animation_id in animations) {
    output_json[animation_id] = [];
    const animation = animations[animation_id];
    for (const animation_frame_idx in animation) {
      const rects = [];
      for (const rect of animation[animation_frame_idx]) {
        rects.push([
          rect.width,
          rect.height,
          rect.page_idx,
          rect.page_rect.x,
          rect.page_rect.y,
          rect.x - rect.image.width / 2,
          rect.y - rect.image.height / 2,
        ])
      }
      for (let _i = 0; _i < duplicate_frame; _i++) {
        output_json[animation_id].push(rects);
      }
    }
  }

  console.log(output_json);

  images.value = "";
  document.getElementById("animation_page").max = output_pages.length - 1;
  document.getElementById("animation_page").value = 0;
  document.getElementById('output').hidden = false;
  _onAnimationPage();
}

function _onAnimationPage() {
  const page = parseInt(document.getElementById("animation_page").value);
  const canvas = output_pages[page];
  document.getElementById('output_canvas').width = canvas.width / 2;
  document.getElementById('output_canvas').height = canvas.height / 2;
  const ctx = document.getElementById('output_canvas').getContext("2d");
  ctx.drawImage(canvas, 0, 0, canvas.width / 2, canvas.height / 2);
}

async function _onDownload() {
  const zip = new JSZip();

  const toBlobAsync = (canvas, type, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  // Pages
  for (let i = 0; i < output_pages.length; i++) {
    const blob = await toBlobAsync(output_pages[i], "image/webp", 1);
    zip.file(`page${i}.webp`, blob);
  }

  // Portrait
  const img = new Image();
  img.src = URL.createObjectURL(output_portrait);
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);

  const portraitBlob = await toBlobAsync(canvas, "image/webp", 1);
  zip.file(`portrait.webp`, portraitBlob);


  // JSON
  zip.file('animations.json', JSON.stringify(output_json));

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = "animation.zip";
  link.click();
  URL.revokeObjectURL(link.href);

  // for (let i = 0; i < output_pages.length; i++) {
  //   // save as webp
  //   zip.file(`page${i}.webp`, output_pages[i].toDataURL("image/webp", 1).split("base64,")[1], { base64: true });
  // }
  // if (output_portrait) {
  //   const img = new Image();
  //   img.src = URL.createObjectURL(output_portrait);
  //   await img.decode();
  //   const canvas = document.createElement("canvas");
  //   canvas.width = img.width;
  //   canvas.height = img.height;
  //   canvas.getContext("2d").drawImage(img, 0, 0);
  //   // save as webp
  //   zip.file(`portrait.webp`, canvas.toDataURL("image/webp", 1).split("base64,")[1], { base64: true });
  // }
  // zip.file('animations.json', JSON.stringify(output_json));
  // zip.generateAsync({ type: "blob" }).then(function (content) {
  //   const link = document.createElement("a");
  //   link.href = URL.createObjectURL(content);
  //   link.download = "animation.zip";  // Set the name of the download file
  //   link.click();  // Trigger the download
  //   URL.revokeObjectURL(link.href);
  // });
}

/**
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 */
function _get_rects(pixels, width, height) {
  const ret = [];

  const rects_height = Math.ceil(height / RECT_SIZE);
  const rects_width = Math.ceil(width / RECT_SIZE);

  for (let rect_y = 0; rect_y < rects_height; rect_y++) {
    for (let rect_x = 0; rect_x < rects_width; rect_x++) {

    }
  }

  return ret;
}