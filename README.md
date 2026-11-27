# MOSS-Image BBOX Editor

Draw boxes and describe their contents in ComfyUI. The node emits the native MOSS-Image layout prompt and the canvas aspect ratio.

## Use

Install `comfyui-moss-bbox` from ComfyUI Manager and restart ComfyUI. Add **MOSS-Image BBOX editor** from the conditioning menu. Connect **prompt** to the text encoder. Connect **aspect ratio** and the same megapixel value to **MOSS Aspect Ratio Resolution**, then use its dimensions for the latent.

Click **Edit boxes** for the editor, or **Open BBOX workspace** for the fullscreen view. Press **R** to draw a box. Select Character, Object, or Text and describe what belongs inside it. **Generate** or **Ctrl+Enter** runs the workflow and displays sampler steps beside the button.

The [Kromoss DMD example](examples/kromoss-dmd-bbox.json) uses EXL3 CLIP Loader, ComfyUI-ppm, and ComfyUI-UtilsCollection. Install them with Manager's missing-node installer. Put the Kromoss diffusion model and its OPD DMD LoRA in `models/diffusion_models` and `models/loras`, respectively. Select your own style adapter in **Style LoRA** and enable that node when you want to use it.

## Development

Run `npm ci`, `npm run build:css`, and `npm test`. The distributed CSS is built into the package.
