# Publishing a DocMind model

How an official DocMind model goes from a training run to something the Model
Manager can download. Nothing here is automated yet — it is a checklist.

The Model Manager is deliberately hosting-agnostic: the manifest carries plain
HTTPS URLs, so the files can live on Hugging Face today and somewhere else
tomorrow without touching the app.

## Workflow

### 1. Training

Fine-tune the base model on the DocMind task (grounded answers over retrieved
documentation sections, with `[SOURCE n]` citations).

### 2. Merge

Merge the adapter into the base weights so the result is a single standalone
model:

```bash
python scripts/merge_lora.py --base <base-model> --adapter <adapter> --out docmind-0.5b-v2
```

### 3. Convert to GGUF

```bash
python llama.cpp/convert_hf_to_gguf.py docmind-0.5b-v2 --outfile docmind-0.5b-v2-f16.gguf --outtype f16
```

### 4. Quantize to Q4_K_M

Q4_K_M is the default DocMind ships: it is the smallest quantization that still
holds up on citation accuracy.

```bash
./llama.cpp/llama-quantize docmind-0.5b-v2-f16.gguf docmind-0.5b-v2-Q4_K_M.gguf Q4_K_M
```

### 5. SHA256

Every official model **must** have a checksum — the manifest schema rejects an
entry without one, and DocMind refuses to install a file whose hash does not
match.

```bash
shasum -a 256 docmind-0.5b-v2-Q4_K_M.gguf
# -> 9f2c…  docmind-0.5b-v2-Q4_K_M.gguf
```

Record the byte size too:

```bash
stat -f%z docmind-0.5b-v2-Q4_K_M.gguf   # macOS
stat -c%s docmind-0.5b-v2-Q4_K_M.gguf   # Linux
```

### 6. Upload to Hugging Face

```bash
huggingface-cli upload docmind/docmind-lite-0.5b docmind-0.5b-v2-Q4_K_M.gguf
```

The download URL is the standard `resolve` link:

```
https://huggingface.co/docmind/docmind-lite-0.5b/resolve/main/docmind-0.5b-v2-Q4_K_M.gguf
```

Any HTTPS host works — the app only requires that the final URL is https and
that redirects stay on https.

### 7. Update the manifest

Add or replace the entry, then publish the manifest at the registry URL.

Bump `version` for a new build of the same model. DocMind shows
"Update available" and **never** replaces an installed model on its own: the
user chooses.

### 8. Test the download

```bash
DOCMIND_MODEL_REGISTRY_URL=https://…/manifest.json npm run dev
```

Open **AI Models → Local models** and check:

- the model appears with the right size and RAM hints;
- the progress bar reports real bytes and speed;
- `Verifying SHA256…` appears, then `Installing…`, then the model is usable;
- corrupting the file on the host makes the install fail and the file disappear.

### 9. Release

Tag the manifest change so a known-good catalog can be restored.

## Manifest format

Validated with Zod on load. An invalid manifest is rejected whole; the last
valid one stays cached.

```json
{
  "version": 1,
  "models": [
    {
      "id": "docmind-lite-0.5b-q4",
      "name": "DocMind Lite",
      "description": "Fast local model for low-memory machines.",
      "parameters": "0.5B",
      "quantization": "Q4_K_M",
      "filename": "docmind-0.5b-v2-Q4_K_M.gguf",
      "url": "https://huggingface.co/docmind/docmind-lite-0.5b/resolve/main/docmind-0.5b-v2-Q4_K_M.gguf",
      "sizeBytes": 417123456,
      "sha256": "9f2c…64 hex characters…",
      "recommendedRamGb": 8,
      "minimumRamGb": 4,
      "contextSize": 4096,
      "version": "2.0",
      "benchmarks": {
        "citationF1": null,
        "hallucinationRate": null,
        "usefulAnswerRate": null
      }
    }
  ]
}
```

### Field notes

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Becomes the directory name under `<userData>/models/`. Letters, digits, `.`, `_`, `-`. |
| `url` | yes | Must be `https://`. Redirects are followed, each hop re-checked. |
| `sizeBytes` | yes | Used for the RAM/disk hint before the download starts. |
| `sha256` | yes | 64 hex characters. Verified after download, before install. |
| `recommendedRamGb` / `minimumRamGb` | no | Drive the "Recommended / Compatible" hints against `os.totalmem()`. |
| `version` | no | Drives "Update available". |
| `benchmarks` | no | **Leave `null` until measured.** The UI hides a null metric rather than showing a zero. |

### Benchmarks

`citationF1`, `hallucinationRate` and `usefulAnswerRate` exist so real
evaluation results for the 0.5B V2 and 1.5B models have somewhere to go. Until
those runs exist they stay `null`, and the UI shows nothing. Do not fill them
in with estimates.

## Pointing DocMind at a registry

Resolution order:

1. **Settings** — AI Models → Advanced → Model registry.
2. **Environment** — `DOCMIND_MODEL_REGISTRY_URL`.
3. **Built-in default** — `DEFAULT_REGISTRY_URL` in `src/main/models/registry.ts`,
   currently the official DocMind Lite 0.5B (v2) catalog on Hugging Face
   (`markuz89/docmind-lite-0.5b`). Update this constant when a new official
   model is published, so a fresh clone still works with no configuration.

For development, the resolver also accepts a `file://` URL or an absolute path,
so the test fixture can stand in for a real registry:

```bash
DOCMIND_MODEL_REGISTRY_URL=$PWD/tests/fixtures/model-registry.json npm run dev
```

That fixture's checksums are placeholders, so its entries will fail checksum
verification on download — by design. It exercises the catalog UI, not the
download.
