# Main Model and LoRA Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow model switcher that exposes only the active workflow's main model and LoRA controls, validates choices against ComfyUI `/object_info`, and applies selected overrides to the queued run.

**Architecture:** The backend owns workflow graph inspection and override validation so UI workflows, API graphs, and builder workflows share one path. The frontend fetches controls on demand, stores per-workflow overrides in memory, and includes `model_overrides` in `/api/run`. Explicit user overrides are applied after workflow-specific builder patches so they win over automatic default LoRA rewrites.

**Tech Stack:** Python stdlib HTTP server, existing `server.workflow_graph.workflow_to_api`, static JavaScript in `frontend/app.js`, CSS in `frontend/styles.css`, pytest, Playwright e2e.

## Global Constraints

- First version only supports main model and LoRA controls.
- Main model loaders: `CheckpointLoaderSimple.ckpt_name`, `UNETLoader.unet_name`, `UnetLoaderGGUF.unet_name`.
- LoRA loaders: `LoraLoaderModelOnly.lora_name`, plus Director-specific `LTXDirectorGuide.ic_lora_name`.
- Do not support switching between checkpoint, transformer, and GGUF workflow families.
- Do not expose text encoders, VAEs, upscalers, samplers, scheduler settings, downloads, or persistent browser storage.
- Values must come from the same loader field's `/object_info` options.
- Existing untracked files `debug_source.py` and `scripts/spring_time_remap.py` are unrelated and must not be staged.

---

### Task 1: Backend Model Control Extraction

**Files:**
- Modify: `server/camera_lab_server.py`
- Test: `tests/test_model_controls.py`

**Interfaces:**
- Produces: `workflow_model_controls(workflow_id: str) -> dict[str, Any]`
- Produces: `model_control_options(class_type: str, field: str) -> list[str]`
- Produces: `build_workflow_api_for_model_controls(workflow: dict[str, Any]) -> dict[str, dict]`

- [ ] **Step 1: Write failing backend extraction tests**

Create `tests/test_model_controls.py` with tests for UNET main model, ordinary LoRA, and Director IC-LoRA:

```python
import pytest

import server.camera_lab_server as server


def test_workflow_model_controls_extracts_main_model_and_lora(monkeypatch, tmp_path):
    workflow_path = tmp_path / "workflow.json"
    workflow_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(server, "WORKFLOWS", [{"id": "sample", "path": str(workflow_path), "mode": "i2v"}])
    monkeypatch.setattr(
        server,
        "workflow_to_api",
        lambda _workflow: {
            "35": {"class_type": "UNETLoader", "inputs": {"unet_name": "model-a.safetensors"}, "_meta": {"title": "Base model"}},
            "293": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": "lora-a.safetensors"}, "_meta": {"title": "Style LoRA"}},
        },
    )
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "UNETLoader": {"input": {"required": {"unet_name": [["model-a.safetensors", "model-b.safetensors"], {}]}}},
            "LoraLoaderModelOnly": {"input": {"required": {"lora_name": [["lora-a.safetensors", "lora-b.safetensors"], {}]}}},
        },
    )

    result = server.workflow_model_controls("sample")

    controls = {item["id"]: item for item in result["controls"]}
    assert controls["35:unet_name"]["category"] == "main_model"
    assert controls["35:unet_name"]["label"] == "Base model"
    assert controls["35:unet_name"]["options"] == ["model-a.safetensors", "model-b.safetensors"]
    assert controls["293:lora_name"]["category"] == "lora"
    assert controls["293:lora_name"]["options"] == ["lora-a.safetensors", "lora-b.safetensors"]


def test_workflow_model_controls_extracts_director_ic_lora(monkeypatch):
    monkeypatch.setattr(server, "DIRECTOR_V2_WORKFLOW_PATH", server.ROOT / "workflows" / "app" / "ltx_director_2.json")
    monkeypatch.setattr(server, "WORKFLOWS", [{"id": "ltx_director_2", "path": str(server.DIRECTOR_V2_WORKFLOW_PATH), "mode": "director_ref", "builder": "ltx_director_2"}])
    monkeypatch.setattr(
        server,
        "workflow_to_api",
        lambda _workflow: {
            "35": {"class_type": "UNETLoader", "inputs": {"unet_name": "model-a.safetensors"}},
            "132": {"class_type": "LTXDirectorGuide", "inputs": {"ic_lora_name": "None"}},
        },
    )
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "UNETLoader": {"input": {"required": {"unet_name": [["model-a.safetensors"], {}]}}},
            "LTXDirectorGuide": {"input": {"required": {"ic_lora_name": [["None", "ingredients.safetensors"], {}]}}},
        },
    )

    result = server.workflow_model_controls("ltx_director_2")

    controls = {item["id"]: item for item in result["controls"]}
    assert controls["35:unet_name"]["category"] == "main_model"
    assert controls["132:ic_lora_name"]["category"] == "director_ic_lora"
    assert controls["132:ic_lora_name"]["options"] == ["None", "ingredients.safetensors"]


def test_workflow_model_controls_rejects_unknown_workflow():
    with pytest.raises(ValueError, match="unknown workflow"):
        server.workflow_model_controls("missing")
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest -p no:cacheprovider tests/test_model_controls.py -q`

Expected: FAIL because `workflow_model_controls` does not exist.

- [ ] **Step 3: Implement extraction helpers**

Add near `MODEL_FOLDER_LOADERS` in `server/camera_lab_server.py`:

```python
MODEL_CONTROL_FIELDS: dict[tuple[str, str], str] = {
    ("CheckpointLoaderSimple", "ckpt_name"): "main_model",
    ("UNETLoader", "unet_name"): "main_model",
    ("UnetLoaderGGUF", "unet_name"): "main_model",
    ("LoraLoaderModelOnly", "lora_name"): "lora",
    ("LTXDirectorGuide", "ic_lora_name"): "director_ic_lora",
}


def object_info_options(class_type: str, field: str) -> list[str]:
    node = object_info().get(class_type, {})
    inputs = node.get("input", {}) if isinstance(node, dict) else {}
    entry = {**(inputs.get("required", {}) or {}), **(inputs.get("optional", {}) or {})}.get(field)
    if isinstance(entry, list) and entry and isinstance(entry[0], list):
        return [str(item) for item in entry[0]]
    if isinstance(entry, list) and entry and isinstance(entry[0], str) and len(entry) > 1 and isinstance(entry[1], dict):
        options = entry[1].get("options")
        if isinstance(options, list):
            return [str(item) for item in options]
    return []


def model_control_options(class_type: str, field: str) -> list[str]:
    return object_info_options(class_type, field)
```

Add workflow graph helper near `workflow_status`:

```python
def workflow_by_id(workflow_id: str) -> dict[str, Any]:
    workflow = next((item for item in WORKFLOWS if item["id"] == workflow_id), None)
    if not workflow:
        raise ValueError(f"unknown workflow: {workflow_id}")
    return workflow


def build_workflow_api_for_model_controls(workflow: dict[str, Any]) -> dict[str, dict]:
    path = Path(workflow["path"])
    data = json.loads(path.read_text(encoding="utf-8"))
    api = workflow_to_api(data)
    if not workflow.get("builder"):
        patch_ltx23_local_loras(api)
        bypass_sage_attention_patches(api)
    elif workflow.get("builder") == "ltx_director_2":
        bypass_sage_attention_patches(api)
    return api


def workflow_model_controls(workflow_id: str) -> dict[str, Any]:
    workflow = workflow_by_id(workflow_id)
    api = build_workflow_api_for_model_controls(workflow)
    controls: list[dict[str, Any]] = []
    for node_id, node in sorted(api.items(), key=lambda item: int(item[0]) if str(item[0]).isdigit() else 999999):
        class_type = str(node.get("class_type") or "")
        inputs = node.get("inputs") or {}
        for (loader_type, field), category in MODEL_CONTROL_FIELDS.items():
            if class_type != loader_type or field not in inputs:
                continue
            options = model_control_options(class_type, field)
            label = str((node.get("_meta") or {}).get("title") or "").strip() or f"{class_type} #{node_id}"
            controls.append({
                "id": f"{node_id}:{field}",
                "node_id": str(node_id),
                "class_type": class_type,
                "label": label,
                "field": field,
                "category": category,
                "value": str(inputs.get(field) or ""),
                "options": options,
            })
    return {"workflow_id": workflow_id, "controls": controls}
```

- [ ] **Step 4: Run backend extraction tests**

Run: `python -m pytest -p no:cacheprovider tests/test_model_controls.py -q`

Expected: PASS.

- [ ] **Step 5: Commit extraction task**

```powershell
git add server/camera_lab_server.py tests/test_model_controls.py
git commit -m "feat: expose workflow model controls"
```

### Task 2: Backend Override Validation and API Endpoint

**Files:**
- Modify: `server/camera_lab_server.py`
- Modify: `tests/test_model_controls.py`

**Interfaces:**
- Consumes: `workflow_model_controls(workflow_id: str) -> dict[str, Any]`
- Produces: `apply_model_overrides(api: dict[str, dict], workflow_id: str, overrides: dict[str, str]) -> None`
- Produces: `GET /api/workflow-model-controls?workflow_id=<id>`

- [ ] **Step 1: Write failing override tests**

Append to `tests/test_model_controls.py`:

```python
def test_apply_model_overrides_patches_valid_values(monkeypatch):
    api = {
        "35": {"class_type": "UNETLoader", "inputs": {"unet_name": "model-a.safetensors"}},
        "293": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": "lora-a.safetensors"}},
    }
    monkeypatch.setattr(
        server,
        "workflow_model_controls",
        lambda _workflow_id: {
            "workflow_id": "sample",
            "controls": [
                {"id": "35:unet_name", "node_id": "35", "field": "unet_name", "options": ["model-a.safetensors", "model-b.safetensors"]},
                {"id": "293:lora_name", "node_id": "293", "field": "lora_name", "options": ["lora-a.safetensors", "lora-b.safetensors"]},
            ],
        },
    )

    server.apply_model_overrides(api, "sample", {"35:unet_name": "model-b.safetensors", "293:lora_name": "lora-b.safetensors"})

    assert api["35"]["inputs"]["unet_name"] == "model-b.safetensors"
    assert api["293"]["inputs"]["lora_name"] == "lora-b.safetensors"


def test_apply_model_overrides_rejects_wrong_value(monkeypatch):
    api = {"35": {"class_type": "UNETLoader", "inputs": {"unet_name": "model-a.safetensors"}}}
    monkeypatch.setattr(
        server,
        "workflow_model_controls",
        lambda _workflow_id: {
            "workflow_id": "sample",
            "controls": [
                {"id": "35:unet_name", "node_id": "35", "field": "unet_name", "options": ["model-a.safetensors"]},
            ],
        },
    )

    with pytest.raises(ValueError, match="not available"):
        server.apply_model_overrides(api, "sample", {"35:unet_name": "missing.safetensors"})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest -p no:cacheprovider tests/test_model_controls.py -q`

Expected: FAIL because `apply_model_overrides` does not exist.

- [ ] **Step 3: Implement override validation and patching**

Add below `workflow_model_controls`:

```python
def normalize_model_overrides(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {str(key): str(value) for key, value in raw.items() if str(value).strip()}


def apply_model_overrides(api: dict[str, dict], workflow_id: str, overrides: dict[str, str]) -> None:
    if not overrides:
        return
    controls = {item["id"]: item for item in workflow_model_controls(workflow_id)["controls"]}
    for control_id, value in overrides.items():
        control = controls.get(control_id)
        if not control:
            raise ValueError(f"unknown model override: {control_id}")
        options = [str(item) for item in control.get("options") or []]
        if options and value not in options:
            raise ValueError(f"model override {control_id} value is not available: {value}")
        node = api.get(str(control["node_id"]))
        if not node:
            raise ValueError(f"model override node is missing: {control_id}")
        node.setdefault("inputs", {})[str(control["field"])] = value
```

In `run_batch_worker`, after building `api` and before writing `api_prompt.json`, add:

```python
            apply_model_overrides(api, run["workflow_id"], normalize_model_overrides(run.get("model_overrides")))
```

- [ ] **Step 4: Add HTTP endpoint**

In the GET routing branch for API endpoints, add:

```python
        if path == "/api/workflow-model-controls":
            params = urllib.parse.parse_qs(parsed.query)
            workflow_id = (params.get("workflow_id") or [""])[0]
            self.send_json(workflow_model_controls(workflow_id))
            return
```

- [ ] **Step 5: Run backend tests**

Run: `python -m pytest -p no:cacheprovider tests/test_model_controls.py tests/test_director_v2.py -q`

Expected: PASS.

- [ ] **Step 6: Commit override task**

```powershell
git add server/camera_lab_server.py tests/test_model_controls.py
git commit -m "feat: apply model overrides"
```

### Task 3: Frontend Model Switcher UI

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/workspace-model.js`
- Modify: `frontend/styles.css`
- Test: `tests/e2e/home.spec.js`

**Interfaces:**
- Consumes: `GET /api/workflow-model-controls?workflow_id=<id>`
- Produces: `state.modelOverrides: Record<string, Record<string, string>>`
- Produces: `/api/run` payload field `model_overrides`

- [ ] **Step 1: Write failing e2e test**

Append to `tests/e2e/home.spec.js`:

```javascript
test("model switcher applies main model and lora overrides", async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: data });
  });
  await page.route("**/api/workflow-model-controls?**", async (route) => {
    await route.fulfill({
      json: {
        workflow_id: "ltx23_gguf_ia2v",
        controls: [
          {
            id: "317:unet_name",
            node_id: "317",
            class_type: "UnetLoaderGGUF",
            label: "Base model",
            field: "unet_name",
            category: "main_model",
            value: "LTX-2.3-distilled-Q4_K_S.gguf",
            options: ["LTX-2.3-distilled-Q4_K_S.gguf", "LTX-2.3-distilled-Q8_0.gguf"],
          },
          {
            id: "293:lora_name",
            node_id: "293",
            class_type: "LoraLoaderModelOnly",
            label: "Distilled LoRA",
            field: "lora_name",
            category: "lora",
            value: "lora-a.safetensors",
            options: ["lora-a.safetensors", "lora-b.safetensors"],
          },
        ],
      },
    });
  });
  const runRequest = page.waitForRequest("**/api/run");
  await page.locator("#modelSwitcherBtn").click();
  await page.locator('select[data-model-control-id="317:unet_name"]').selectOption("LTX-2.3-distilled-Q8_0.gguf");
  await page.locator('select[data-model-control-id="293:lora_name"]').selectOption("lora-b.safetensors");
  await page.locator("#modelSwitcherApply").click();
  await page.locator("#runBtn").click();
  const payload = JSON.parse((await runRequest).postData() || "{}");
  expect(payload.model_overrides).toEqual({
    "317:unet_name": "LTX-2.3-distilled-Q8_0.gguf",
    "293:lora_name": "lora-b.safetensors",
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:e2e -- tests/e2e/home.spec.js -g "model switcher applies"`

Expected: FAIL because `#modelSwitcherBtn` does not exist.

- [ ] **Step 3: Add state**

In `frontend/workspace-model.js`, add to the initial state:

```javascript
modelOverrides: {},
modelControlCache: {},
```

- [ ] **Step 4: Add HTML controls**

In `frontend/index.html`, near the workflow select add:

```html
      <div class="workflow-tools">
        <button id="modelSwitcherBtn" type="button">Models</button>
      </div>
```

Near the end of `<body>`, add:

```html
  <div id="modelSwitcherModal" class="modal-backdrop" hidden>
    <section class="model-switcher-modal" role="dialog" aria-modal="true" aria-labelledby="modelSwitcherTitle">
      <div class="modal-header">
        <h2 id="modelSwitcherTitle">Models</h2>
        <button id="modelSwitcherClose" class="icon-button" type="button" title="Close">×</button>
      </div>
      <div id="modelSwitcherStatus" class="hint"></div>
      <div id="modelSwitcherBody" class="model-switcher-body"></div>
      <div class="modal-actions">
        <button id="modelSwitcherReset" type="button">Reset</button>
        <button id="modelSwitcherCancel" type="button">Cancel</button>
        <button id="modelSwitcherApply" type="button">Apply</button>
      </div>
    </section>
  </div>
```

- [ ] **Step 5: Add frontend JS**

In `frontend/app.js`, add helpers:

```javascript
function activeWorkflowForModels() {
  if (state.workspace === "director") return currentDirectorWorkflow();
  if (state.workspace === "edit") return currentEditWorkflow();
  return currentWorkflow();
}

function workflowModelOverrides(workflowId) {
  if (!state.modelOverrides[workflowId]) state.modelOverrides[workflowId] = {};
  return state.modelOverrides[workflowId];
}

async function openModelSwitcher() {
  const workflow = activeWorkflowForModels();
  if (!workflow) return;
  const modal = $("modelSwitcherModal");
  const status = $("modelSwitcherStatus");
  const body = $("modelSwitcherBody");
  modal.hidden = false;
  status.textContent = "Loading models...";
  body.innerHTML = "";
  try {
    const data = await api(`/api/workflow-model-controls?workflow_id=${encodeURIComponent(workflow.id)}`);
    state.modelControlCache[workflow.id] = data.controls || [];
    renderModelSwitcher(workflow.id, data.controls || []);
    status.textContent = data.controls?.length ? "" : "No main model or LoRA controls found for this workflow.";
  } catch (err) {
    status.textContent = `Model controls unavailable: ${err.message}`;
  }
}

function closeModelSwitcher() {
  $("modelSwitcherModal").hidden = true;
}

function renderModelSwitcher(workflowId, controls) {
  const body = $("modelSwitcherBody");
  const overrides = workflowModelOverrides(workflowId);
  body.innerHTML = "";
  for (const section of [
    ["main_model", "Main Model"],
    ["lora", "LoRA"],
    ["director_ic_lora", "Director IC-LoRA"],
  ]) {
    const rows = controls.filter((control) => control.category === section[0]);
    if (!rows.length) continue;
    const group = document.createElement("section");
    group.className = "model-switcher-section";
    const title = document.createElement("h3");
    title.textContent = section[1];
    group.appendChild(title);
    for (const control of rows) {
      const row = document.createElement("label");
      row.className = "model-switcher-row";
      const label = document.createElement("span");
      label.textContent = `${control.label} (${control.class_type}.${control.field})`;
      const select = document.createElement("select");
      select.dataset.modelControlId = control.id;
      const value = overrides[control.id] || control.value || "";
      for (const optionValue of control.options || []) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        select.appendChild(option);
      }
      if (value && ![...select.options].some((option) => option.value === value)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value} (unavailable)`;
        option.disabled = true;
        select.prepend(option);
      }
      select.value = value;
      row.append(label, select);
      group.appendChild(row);
    }
    body.appendChild(group);
  }
}

function applyModelSwitcher() {
  const workflow = activeWorkflowForModels();
  if (!workflow) return;
  const controls = state.modelControlCache[workflow.id] || [];
  const next = {};
  for (const select of $("modelSwitcherBody").querySelectorAll("select[data-model-control-id]")) {
    const control = controls.find((item) => item.id === select.dataset.modelControlId);
    if (control && select.value && select.value !== control.value) next[control.id] = select.value;
  }
  state.modelOverrides[workflow.id] = next;
  closeModelSwitcher();
}

function resetModelSwitcher() {
  const workflow = activeWorkflowForModels();
  if (workflow) state.modelOverrides[workflow.id] = {};
  renderModelSwitcher(workflow.id, state.modelControlCache[workflow.id] || []);
}

function attachModelOverrides(payload, workflowId) {
  const overrides = state.modelOverrides[workflowId] || {};
  if (Object.keys(overrides).length) payload.model_overrides = { ...overrides };
  return payload;
}
```

Call `attachModelOverrides(payload, workflow.id)` before each `collectPayload()` branch returns. For object literals returned directly, assign to `const payload` first and return `attachModelOverrides(payload, workflow.id)`.

Register events in the startup binding section:

```javascript
$("modelSwitcherBtn")?.addEventListener("click", openModelSwitcher);
$("modelSwitcherClose")?.addEventListener("click", closeModelSwitcher);
$("modelSwitcherCancel")?.addEventListener("click", closeModelSwitcher);
$("modelSwitcherApply")?.addEventListener("click", applyModelSwitcher);
$("modelSwitcherReset")?.addEventListener("click", resetModelSwitcher);
```

- [ ] **Step 6: Add CSS**

In `frontend/styles.css`, add:

```css
.workflow-tools {
  display: flex;
  justify-content: flex-end;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(10 12 16 / 70%);
}

.modal-backdrop[hidden] {
  display: none;
}

.model-switcher-modal {
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.modal-header,
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.model-switcher-body {
  display: grid;
  gap: 16px;
  margin: 14px 0;
}

.model-switcher-section {
  display: grid;
  gap: 10px;
}

.model-switcher-section h3 {
  margin: 0;
  font-size: 0.9rem;
}

.model-switcher-row {
  display: grid;
  gap: 6px;
}
```

- [ ] **Step 7: Run frontend test**

Run: `npm run test:e2e -- tests/e2e/home.spec.js -g "model switcher applies"`

Expected: PASS.

- [ ] **Step 8: Commit frontend task**

```powershell
git add frontend/index.html frontend/app.js frontend/workspace-model.js frontend/styles.css tests/e2e/home.spec.js
git commit -m "feat: add model switcher UI"
```

### Task 4: Integration Verification

**Files:**
- No new files

**Interfaces:**
- Consumes all prior task outputs.
- Produces verified working feature.

- [ ] **Step 1: Run focused Python tests**

Run: `python -m pytest -p no:cacheprovider tests/test_model_controls.py tests/test_director_v2.py tests/test_quant_profiles.py -q`

Expected: PASS.

- [ ] **Step 2: Run focused e2e test**

Run: `npm run test:e2e -- tests/e2e/home.spec.js -g "model switcher applies"`

Expected: PASS.

- [ ] **Step 3: Check git status**

Run: `git status --short`

Expected: only pre-existing untracked files remain:

```text
?? debug_source.py
?? scripts/spring_time_remap.py
```

- [ ] **Step 4: Final commit if needed**

If Task 4 required fixes:

```powershell
git status --short
git add server/camera_lab_server.py tests/test_model_controls.py frontend/index.html frontend/app.js frontend/workspace-model.js frontend/styles.css tests/e2e/home.spec.js
git commit -m "fix: stabilize model switcher"
```

If no fixes were needed, do not create an empty commit.
