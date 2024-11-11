import { MaxRectsPacker } from 'maxrects-packer'
import JSZip from 'jszip'

document.getElementById("animation_count").addEventListener("input", _onInputAnimationCount);
document.getElementById("generate").addEventListener("click", _onGenerate);
document.getElementById("animation_page").addEventListener("change", _onAnimationPage);
document.getElementById("download").addEventListener("click", _onDownload);

let count = 0;

// image_size, page_idx, page_offset, draw_offset
let output_json = [];
let output_pages = [];

document.getElementById("animation_count").value = 1;
_onInputAnimationCount();

function _onInputAnimationCount() {
  document.getElementById('animations').innerHTML = '';

  count = parseInt(document.getElementById("animation_count").value);

  for (let i = 0; i < count; i++) {
    let animation = document.createElement('div');
    animation.innerHTML = `
      <label for="animation_${i}">${i}:</label>
      <input type="file" id="animation_${i}" accept="image" multiple />
    `;
    document.getElementById('animations').appendChild(animation);
  }
}

async function _onGenerate() {
  document.getElementById('output').hidden = true;
  document.getElementById("generate").hidden = true;
  document.getElementById("progress").hidden = false;
  document.getElementById("progress").textContent = "0%";

  let total_files = 0;
  for (let i = 0; i < count; i++) {
    total_files += document.getElementById(`animation_${i}`).files.length;
  }
  let progress = 0;

  const animations = [];
  const imgs = [];

  for (let animation_idx = 0; animation_idx < count; animation_idx++) {
    const animation = [];

    const files = document.getElementById(`animation_${animation_idx}`).files;
    for (let animation_frame = 0; animation_frame < files.length; animation_frame++) {
      const file = files[animation_frame];
      console.log(file);

      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const pixels = imageData.data;

      // Identify non-transparent pixel bounds
      let top = img.height, left = img.width, bottom = 0, right = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const index = (y * img.width + x) * 4 + 3;
          if (pixels[index] > 0) {
            top = Math.min(top, y);
            left = Math.min(left, x);
            bottom = Math.max(bottom, y);
            right = Math.max(right, x);
          }
        }
      }

      // Crop image
      canvas.width = right - left + 1;
      canvas.height = bottom - top + 1;
      canvas["draw_offset_x"] = left;
      canvas["draw_offset_y"] = top;
      ctx.drawImage(img, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

      // Check for duplicate images
      var img_idx = -1;
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        if (img.width === canvas.width
          && img.height === canvas.height
          && img["draw_offset_x"] === canvas["draw_offset_x"]
          && img["draw_offset_y"] === canvas["draw_offset_y"]) {
          const img_data = img.getContext("2d").getImageData(0, 0, img.width, img.height).data;
          const canvas_data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          let equal = true;
          for (let j = 0; j < img_data.length; j++) {
            if (img_data[j] !== canvas_data[j]) {
              equal = false;
              break;
            }
          }
          if (equal) {
            console.log('duplicate image');
            img_idx = i;
            break;
          }
        }
      }

      if (img_idx === -1) {
        img_idx = imgs.length;
        imgs.push(canvas);
      }
      animation.push(img_idx);

      progress += 1 / total_files * 80;
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
    border: 2
  };
  let packer = new MaxRectsPacker(2048, 2048, 2, options);

  let input = [];
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    input.push({ width: img.width, height: img.height, data: i });
  }
  packer.addArray(input);

  document.getElementById("progress").textContent = "80%";

  // Create output pages.
  const pages = packer.bins;
  output_pages = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const ctx = canvas.getContext("2d");
    for (let j = 0; j < page.rects.length; j++) {
      const rect = page.rects[j];
      const img = imgs[rect.data];
      img["page_idx"] = i;
      img["page_offset_x"] = rect.x;
      img["page_offset_y"] = rect.y;
      ctx.drawImage(img, rect.x, rect.y);
    }
    output_pages.push(canvas);
  }

  // Generate output json.
  output_json = [];
  for (const animation of animations) {
    const frames = [];
    for (const img_idx of animation) {
      const img = imgs[img_idx];
      frames.push([
        img.width,
        img.height,
        img["page_idx"],
        img["page_offset_x"],
        img["page_offset_y"],
        img["draw_offset_x"],
        img["draw_offset_y"],
      ]);
    }
    output_json.push(frames);
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
  document.getElementById('output_canvas').width = canvas.width / 4;
  document.getElementById('output_canvas').height = canvas.height / 4;
  const ctx = document.getElementById('output_canvas').getContext("2d");
  ctx.drawImage(canvas, 0, 0, canvas.width / 4, canvas.height / 4);
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