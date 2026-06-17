type WorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

export type ScailPrompt = Record<string, WorkflowNode>;

export type BuildScailPromptOptions = {
  referenceImage: string;
  driveVideo: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  seed: number;
  steps: number;
  poseStrength: number;
  outputPrefix: string;
};

const baseScailPrompt: ScailPrompt = {
  '1': {
    class_type: 'UNETLoader',
    inputs: {
      unet_name: 'wan2.1_14B_SCAIL_2_fp8_scaled.safetensors',
      weight_dtype: 'default',
    },
  },
  '2': {
    class_type: 'LoraLoaderModelOnly',
    inputs: {
      model: ['1', 0],
      lora_name: 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
      strength_model: 1.0,
    },
  },
  '3': {
    class_type: 'ModelSamplingSD3',
    inputs: {
      model: ['2', 0],
      shift: 5.0,
    },
  },
  '4': {
    class_type: 'CLIPLoader',
    inputs: {
      clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
      type: 'wan',
    },
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['4', 0],
      text: '',
    },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['4', 0],
      text: '',
    },
  },
  '7': {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'wan_2.1_vae.safetensors',
    },
  },
  '8': {
    class_type: 'CLIPVisionLoader',
    inputs: {
      clip_name: 'clip_vision_h.safetensors',
    },
  },
  '9': {
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
  },
  '10': {
    class_type: 'CLIPVisionEncode',
    inputs: {
      clip_vision: ['8', 0],
      image: ['9', 0],
      crop: 'center',
    },
  },
  '11': {
    class_type: 'LoadVideo',
    inputs: {
      file: '',
    },
  },
  '12': {
    class_type: 'GetVideoComponents',
    inputs: {
      video: ['11', 0],
    },
  },
  '13': {
    class_type: 'WanSCAILToVideo',
    inputs: {
      positive: ['5', 0],
      negative: ['6', 0],
      vae: ['7', 0],
      width: 320,
      height: 576,
      length: 25,
      batch_size: 1,
      pose_strength: 1.0,
      pose_start: 0.0,
      pose_end: 1.0,
      video_frame_offset: 0,
      previous_frame_count: 5,
      pose_video: ['12', 0],
      reference_image: ['9', 0],
      clip_vision_output: ['10', 0],
    },
  },
  '14': {
    class_type: 'KSampler',
    inputs: {
      model: ['3', 0],
      seed: 1,
      steps: 4,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      positive: ['13', 0],
      negative: ['13', 1],
      latent_image: ['13', 2],
      denoise: 1.0,
    },
  },
  '15': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['14', 0],
      vae: ['7', 0],
    },
  },
  '16': {
    class_type: 'CreateVideo',
    inputs: {
      images: ['15', 0],
      fps: 24.0,
    },
  },
  '17': {
    class_type: 'SaveVideo',
    inputs: {
      video: ['16', 0],
      filename_prefix: 'scail/3dmotion',
      format: 'mp4',
      codec: 'h264',
    },
  },
};

function clonePrompt(prompt: ScailPrompt): ScailPrompt {
  return JSON.parse(JSON.stringify(prompt)) as ScailPrompt;
}

export function makeScailFrameCount(durationSeconds: number, fps: number) {
  const raw = Math.max(1, Math.round(durationSeconds * fps));
  return Math.max(5, raw + ((1 - raw) % 4 + 4) % 4);
}

export function buildScailPrompt(options: BuildScailPromptOptions): ScailPrompt {
  const prompt = clonePrompt(baseScailPrompt);
  prompt['5'].inputs.text = options.positivePrompt;
  prompt['6'].inputs.text = options.negativePrompt;
  prompt['9'].inputs.image = options.referenceImage;
  prompt['11'].inputs.file = options.driveVideo;
  prompt['13'].inputs.width = options.width;
  prompt['13'].inputs.height = options.height;
  prompt['13'].inputs.length = options.frameCount;
  prompt['13'].inputs.pose_strength = options.poseStrength;
  prompt['14'].inputs.seed = options.seed;
  prompt['14'].inputs.steps = options.steps;
  prompt['16'].inputs.fps = options.fps;
  prompt['17'].inputs.filename_prefix = options.outputPrefix;
  return prompt;
}
