# Pixel Art Optimizer

A web tool that shrinks **pixel art PNGs** without changing a single pixel. It was built to optimize game assets made
in **Aseprite** (sprites, tilesets, UI and animation frames), and it's meant for artists: nothing to install, no
command line.

## For artists

1. Open the tool's link in Chrome, Edge, Firefox or Safari.
2. Drop a folder (or a few PNGs) onto the dashed area, or click **Choose folder**.
3. Wait for it to finish. You'll see how much each file weighed before and after.
4. Save the result:
   - **Save to a folder** (Chrome and Edge): pick an empty folder and the files are written there with the same
     subfolders.
   - **Download ZIP** (any browser): a ZIP with the same folder structure.
   - **Report**: opens a detailed table right on the page (sizes, colors, status and notes for every file). From
     there you can copy it straight into Excel or Google Sheets, or download it as CSV.

Your originals are never modified, and images are never uploaded anywhere: everything happens inside the browser.

**Maximum compression** saves a little more (≈2% extra) and takes about four times longer.

### Tips for Aseprite exports

- Export at **100% scale** and let the game engine upscale with nearest-neighbor filtering. A sprite exported at 800%
  has 64 times more pixels to store.
- Keep your `.aseprite` files as the source. This tool only processes the exported PNGs and skips everything else.

## Why pixel art

Pixel art has few colors and large flat areas, so it can be stored with an exact color palette and fewer bits per pixel.
With Ashara's assets that typically cuts file size by 60–80% with zero quality loss. The tool works on any PNG, but
photos and painted art shrink much less.

## How it works

- Each PNG goes through [oxipng](https://github.com/shssoichiro/oxipng) compiled to WebAssembly
  ([@jsquash/oxipng](https://github.com/jamsinclair/jSquash)). oxipng only applies lossless reductions: an exact palette
  when there are 256 colors or fewer, fewer bits per pixel, and better zlib compression. Color profiles and metadata
  are kept.
- The result is then decoded and compared pixel by pixel with the original at 16 bits per channel
  ([src/core/pixels.js](src/core/pixels.js)). The only thing ignored is the hidden color of fully transparent pixels.
- The original is returned if the result isn't identical or isn't smaller, or if a color profile would be lost.
  Animated PNGs (APNG) are left as is.
- Files are processed in parallel with Web Workers (one per CPU core, up to 6).

## License

[MIT](LICENSE) © 2026 Ashara Studios

### Third-party licenses

The published site bundles these open source packages:

| Package | License |
| --- | --- |
| [oxipng](https://github.com/shssoichiro/oxipng) (via [@jsquash/oxipng](https://github.com/jamsinclair/jSquash)) | MIT (oxipng), Apache-2.0 (@jsquash/oxipng) |
| [wasm-feature-detect](https://github.com/GoogleChromeLabs/wasm-feature-detect) | Apache-2.0 |
| [fast-png](https://github.com/image-js/fast-png) | MIT |
| [iobuffer](https://github.com/image-js/iobuffer) | MIT |
| [fflate](https://github.com/101arrowz/fflate) | MIT |
