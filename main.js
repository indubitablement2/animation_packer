import { MaxRectsPacker } from 'maxrects-packer'
import JSZip from 'jszip'
import initSync, { process } from "./wasm/pkg/wasm.js";

initSync();

const ANIMATION_ID = [
  //"portait"
  "idle",
  "move",
  "attack",
  "knockback",
  "death",
];

// { idle: [ [image_size, page_idx, page_offset, draw_offset], 0 ] }
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

async function _onImages() {
  const files = images.files;
  if (files.length === 0) {
    return;
  }

  document.getElementById('output').hidden = true;
  document.getElementById("progress").hidden = false;
  document.getElementById("progress").textContent = "0%";

  let progress = 0;

  /**
   * @type {{ file: File, hash: number, rects: { x: number, y: number, width: number, height: number }[] }[]}
   */
  const frames = [];
  /**
   * @type {{ [key: string]: { [key: number]: number } }}
   */
  const animations = {};
  for (const animation_id of ANIMATION_ID) {
    animations[animation_id] = {};
  }
  output_portrait = null;

  // Process images
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
          const processed = JSON.parse(process(pixels, img.width, img.height));

          let frame_idx = -1;
          for (let i = 0; i < frames.length; i++) {
            const other = frames[i];
            if (other.hash === processed.hash && other.rects.length == processed.rects.length) {
              frame_idx = i;
              break;
            }
          }

          if (frame_idx === -1) {
            frame_idx = frames.length;
            frames.push({
              file: file,
              width: img.width,
              height: img.height,
              hash: processed.hash,
              rects: processed.rects,
            });
          }
          animations[animation_id][parseInt(fileName.replace(animation_id, ""))] = frame_idx;

          break;
        }
      }
    }

    progress += 1 / files.length * 99;
    document.getElementById("progress").textContent = progress.toFixed(2) + "%";
  }

  document.getElementById("progress").textContent = "finalizing...";

  // todo portrait
  // Pack frames into atlas.
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
  for (const frame of frames) {
    for (const rect of frame.rects) {
      const page_rect = { width: rect.width, height: rect.height, data: rect };
      rect["page_rect"] = page_rect;
      rect["frame"] = frame;
      packer_input.push(page_rect);
    }
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

      rect["page_idx"] = page_idx;
      const sx = rect.x;
      const sy = rect.y;
      const w = page_rect.width;
      const h = page_rect.height;
      const dx = page_rect.x;
      const dy = page_rect.y;

      const img = new Image();
      img.src = URL.createObjectURL(rect.frame.file);
      await img.decode();
      ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h);
    }
    output_pages.push(out_canvas);
  }

  // Generate output json.
  output_json = {};
  for (const animation_id of ANIMATION_ID) {
    const animation = animations[animation_id];
    const animation_frames = [];
    for (const animation_frame_idx in animation) {
      const frame = frames[animation[animation_frame_idx]];
      const rects = [];
      for (const rect of frame.rects) {
        rects.push([
          rect.width,
          rect.height,
          rect.page_idx,
          rect.page_rect.x,
          rect.page_rect.y,
          rect.x - frame.width / 2,
          rect.y - frame.height / 2,
        ])
      }
      animation_frames.push(rects);
    }

    if (animation_frames.length > 0) {
      output_json[animation_id] = animation_frames;
    }
  }

  console.log(output_json);

  images.value = "";
  document.getElementById("animation_page").max = output_pages.length - 1;
  document.getElementById("animation_page").value = 0;
  document.getElementById('output').hidden = false;
  document.getElementById("progress").hidden = true;
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
  for (let i = 0; i < output_pages.length; i++) {
    // save as webp
    zip.file(`page${i}.webp`, output_pages[i].toDataURL("image/webp", 1).split("base64,")[1], { base64: true });
  }
  if (output_portrait) {
    const img = new Image();
    img.src = URL.createObjectURL(output_portrait);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    // save as webp
    zip.file(`portrait.webp`, canvas.toDataURL("image/webp", 1).split("base64,")[1], { base64: true });
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
