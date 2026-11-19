# Runbook: scan with an on-prem vision model (OpenAI-compatible server)

Issue [#213](https://github.com/marinoscar/vault/issues/213) (IDOC-10), epic [#203](https://github.com/marinoscar/vault/issues/203). Applies when a deployment wants card or document scanning (passport, ID document) to run on a vision model it hosts itself instead of, or beside, OpenAI.

## How it works

- Vault mounts two providers of the platform AI slice: `openai` and `openai-compatible` (`apps/api/src/platform/ai/ai.config.ts`). The `openai-compatible` provider speaks OpenAI's wire protocol to any server at an administrator-chosen base URL: Ollama, vLLM, LM Studio, a LiteLLM gateway. Vault imports no provider SDK; the adapter is the platform's (`@marinoscar/platform-ai-providers`).
- Images go to the server inline (base64 `data:` URLs): a self-hosted server does not need to reach this deployment's object storage.
- The platform cannot tell what a self-hosted model can do: `GET {baseUrl}/models` lists ids only. Every discovered model is stored **unclassified**, and an administrator declares its capabilities in the Models UI before enabling it.
- Each scan feature runs on the model chosen for it: `card_extract` on `ai.cardExtractModel` (provider `ai.cardExtractProvider`), `document_extract` on `ai.documentExtractModel` (provider `ai.documentExtractProvider`), which falls back to the card choice when unset. A provider left unset means `openai`, so a deployment configured before #213 behaves as before.
- Scanning is offered (the scan entry points, the onboarding step "Scan a card") only when **all** of these hold, for the feature's model ([SECRETS.md](../SECRETS.md#which-model-scans)):
  1. AI is on;
  2. the model is an enabled catalogue model on an enabled provider and declares `vision_input`, `structured_output` and `responses`;
  3. the call can be paid: the provider is keyless (`requiresKey: false`), or the key policy is `byok_with_org_fallback` and the provider's deployment key is stored.

`responses` is the platform's responses **port**, not OpenAI's Responses endpoint: an OpenAI-compatible server offers it on both API styles (`chat_completions` and `responses`), so the scan features keep their `needs` unchanged.

## 0. Prerequisites

1. The build with #213 is deployed. No migration and no environment variable: the provider, its base URL and the model choice are runtime settings, edited in the Console.
2. You hold `ai_config:read` and `ai_config:write` (the AI pages) and `system_settings:read` and `system_settings:write` (the scan model choice is a system setting). An Admin holds all four.
3. A vision model that can follow a JSON schema (structured output). Vault does not recommend one; test yours with step 5 before switching users onto it.

## 1. Run the model behind an OpenAI-compatible server

The host names below are placeholders: use your own.

Ollama (serves `/v1` beside its own API):

```bash
ollama pull <vision-model>
OLLAMA_HOST=0.0.0.0:11434 ollama serve
# base URL: http://ai.internal.example.test:11434/v1
```

vLLM:

```bash
vllm serve <org>/<vision-model> --host 0.0.0.0 --port 8000
# base URL: http://ai.internal.example.test:8000/v1
```

The API container must reach that host. Keep the server on a private network; if it is exposed, put a key in front of it (step 2) rather than running it keyless.

## 2. Configure the provider

Console, **AI** (`/admin/settings/ai`), provider **OpenAI-compatible**:

1. **Base URL**: `http://ai.internal.example.test:11434/v1` (your server).
2. **API style**: `chat_completions` (what almost every compatible server serves) or `responses` (only if your server implements OpenAI's Responses API).
3. **Requires key**: off for a keyless server. Otherwise leave it on and store the key in the provider's write-only key field: it is encrypted under `SECRETS_ENCRYPTION_KEY`, never returned and never sent to the browser.
4. Enable the provider and save. **Test** checks that the server answers `GET {baseUrl}/models`.

The key policy stays `byok_with_org_fallback` (Vault users hold no key of their own). A keyless server works under either policy.

## 3. Discover the model and declare its capabilities

Console, **AI models** (`/admin/settings/ai/models`):

1. **Discover** (sync) the `openai-compatible` models. They arrive unclassified and disabled.
2. On the chosen model, declare at least `responses`, `structured_output` and `vision_input` (and the input modality `image`). This is an administrator override; the platform does not guess.
3. Enable the model.

A model missing `vision_input` or `structured_output` is not offered in the pickers, and selecting it by other means turns scanning off (fail closed), never into a failing scan.

## 4. Choose it for scanning

Console, **AI** page, section **Scanning models** (below the platform's settings, not a separate card):

- **Document scanning model**: pick the model (each entry shows model and provider). **Same as card scanning** clears the choice, so documents run on the card model.
- **Card scanning model** (optional): pick it too to scan payment cards on it. The card security code is never read or sent, whatever the model.

Both pickers list the models of every enabled provider that declare the needs. Without `ai_config:write` they are read-only.

## 5. Smoke test

1. As a Contributor (holds `secrets:write` and `ai:use`), open the passport or ID document scan (or the card scan) and use a **placeholder** image: a generated specimen or the ICAO specimen state `UTO`, never a real document.
2. The review screen shows the extracted fields. The response's `model` names your model.
3. On **AI usage** (`/admin/settings/ai/usage`, or `GET /api/admin/ai/usage`) a row appears under feature `document_extract` (or `card_extract`) with provider `openai-compatible`. Usage rows land in `ai_usage_events` as for any provider; a keyless call is recorded with key source `none`. No image byte and no extracted value is stored in a usage row.
4. If the scan entry point is missing, check `GET /api/secrets/scan/targets` (as a user with `ai:use`): the feature's `capabilities` is `null` when the model is not an enabled catalogue model, or lacks one of the three needs.

## Limits

The platform limits apply to every provider alike: `ai.limits` on the AI page (per user and per organization: requests per minute and per day, tokens). A self-hosted model costs nothing per call, but the limits still protect the server from a burst. A refused call answers `429 AI_RATE_LIMITED` / `AI_QUOTA_EXCEEDED` as before.

## Rollback

Re-select the previous model in **Scanning models** (for documents, **Same as card scanning** returns to the card model), then save. The change applies to the next scan; nothing is cached. Disabling the `openai-compatible` provider also stops every call to it: a feature whose model is on a disabled provider is reported unavailable and its entry points hide.

## Related

- [ai-platform-migration.md](ai-platform-migration.md): how card scanning moved onto the platform AI slice (E8).
- [SECRETS.md, card and document scanning](../SECRETS.md): the scan flows.
- [DOMAIN-REFERENCE.md](../DOMAIN-REFERENCE.md): the `ai.*Extract*` settings keys.
