# Main Model and LoRA Switcher Design

## Goal

Expose a compact model-switching UI that lets users change the current workflow's main generation model and LoRA selection without editing ComfyUI workflow JSON. The first version intentionally avoids text encoders, VAEs, upscalers, and cross-loader workflow conversion.

## Scope

The model switcher appears as a button near the workflow controls. Clicking it opens a modal with two sections:

- Main Model: one or more main model loader fields detected in the active workflow.
- LoRA: ordinary LoRA loader fields detected in the active workflow, plus Director IC-LoRA when the active workflow supports it.

The switcher only offers values that ComfyUI reports for the same loader field through `/object_info`. A `UNETLoader` field can only choose `UNETLoader.unet_name` options, a `CheckpointLoaderSimple` field can only choose checkpoint options, and a `UnetLoaderGGUF` field can only choose GGUF loader options. Switching between checkpoint, transformer, and GGUF workflow families remains a workflow variant decision, not a dropdown decision.

## Loader Detection

The backend owns loader detection so UI JSON, API graphs, and builder workflows use one consistent path. For the active workflow, the backend returns detected controls with:

- `node_id`
- `class_type`
- display label from `_meta.title`, UI node `title`, or a fallback such as `UNETLoader #35`
- field name such as `unet_name`, `ckpt_name`, or `lora_name`
- current value
- options from `/object_info`
- category: `main_model`, `lora`, or `director_ic_lora`

Initial supported main model fields:

- `CheckpointLoaderSimple.ckpt_name`
- `UNETLoader.unet_name`
- `UnetLoaderGGUF.unet_name`

Initial supported LoRA fields:

- `LoraLoaderModelOnly.lora_name`
- Director-specific `LTXDirectorGuide.ic_lora_name`

`LoraLoader.lora_name` can be added later if app workflows start using it.

## API Design

Add a read endpoint:

`GET /api/workflow-model-controls?workflow_id=<id>`

Response:

```json
{
  "workflow_id": "ltx_director_2",
  "controls": [
    {
      "id": "35:unet_name",
      "node_id": "35",
      "class_type": "UNETLoader",
      "label": "UNETLoader #35",
      "field": "unet_name",
      "category": "main_model",
      "value": "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
      "options": ["ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"]
    }
  ]
}
```

Generation requests include:

```json
{
  "model_overrides": {
    "35:unet_name": "alternate_model.safetensors",
    "293:lora_name": "alternate_lora.safetensors"
  }
}
```

The backend validates each override against the detected controls for that workflow before patching the API graph. Unknown control ids, wrong-field values, or values absent from the loader options are rejected with a clear error.

## Backend Flow

1. Resolve `workflow_id` to a workflow entry.
2. Build or convert the workflow graph the same way generation does, far enough to discover loader nodes.
3. Read `/object_info` options for the supported loader fields.
4. Return controls for fields present in the graph.
5. During generation, apply valid `model_overrides` after the workflow API graph is built and after workflow-specific builder patches have run, but before submission to ComfyUI.

For existing automatic patches such as `patch_ltx23_local_loras`, explicit user overrides win. This preserves current defaults while making user choices authoritative for the run.

## Frontend Flow

The frontend stores `state.modelOverrides` keyed by workflow id. When the workflow changes, the modal fetches fresh controls and displays any existing override only if it is still valid.

The modal layout is utilitarian:

- Toolbar button: `Models`
- Modal title: `Models`
- Section headings: `Main Model`, `LoRA`
- Each row: node label, loader type, dropdown, and current/default hint
- Footer: `Reset`, `Cancel`, `Apply`

Applying changes updates local state. The next `/api/run` payload includes overrides for the active workflow.

## Error Handling

If ComfyUI is offline or `/object_info` is unavailable, the modal opens with an error message and no editable controls.

If a loader node has a current value that is not in the current options, the row remains visible, marks the value as unavailable, and disables applying that unavailable value.

If generation receives an invalid override, the backend returns a validation error before queuing the run.

## Testing

Backend tests cover:

- extracting main model controls from a UNETLoader workflow
- extracting LoRA controls from `LoraLoaderModelOnly`
- extracting Director IC-LoRA controls from `LTXDirectorGuide`
- rejecting an override not present in object_info options
- applying a valid override after workflow build

Frontend/e2e tests cover:

- opening the model switcher
- rendering main model and LoRA dropdowns from a mocked endpoint
- applying a selection and verifying `/api/run` includes `model_overrides`
- resetting overrides for the current workflow

## Out of Scope

- Switching a workflow between checkpoint, transformer, and GGUF loader families.
- Editing text encoders, VAEs, upscalers, samplers, or scheduler settings.
- Downloading missing models.
- Persisting overrides globally across browser sessions.
