# LLM provider configuration

The production service is designed around an OpenAI-compatible chat-completions endpoint configured only through deployment secrets/environment variables.

Current beta target:

- Base URL: `https://integrate.api.nvidia.com/v1`
- Model: `nvidia/llama-3.3-nemotron-super-49b-v1.5`
- API key: deployment secret only; never commit it to the repository.

The lead-qualification path uses `/v1/chat/completions` and expects structured JSON from the model.

## Voice limitation

The NVIDIA hosted endpoint configured above is used for chat inference. The current speech functions still use OpenAI-compatible `/audio/speech` and `/audio/transcriptions` routes, which are a separate capability and must not be assumed to exist on the NVIDIA endpoint. Until a compatible STT/TTS provider is configured, keep per-profile voice mode disabled; text qualification and HOT handoff remain independent of voice.

## Release verification

Before enabling a real WhatsApp profile, verify:

1. deployment health is green;
2. the configured chat model returns a successful test completion;
3. one WhatsApp profile is coupled by QR;
4. a real inbound text reaches AI qualification;
5. HOT takeover prevents further autonomous AI sends.
