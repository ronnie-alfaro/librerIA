"""
LLM provider abstraction for librerIA.

Reads config.toml and exposes a single LLM interface regardless of whether
the backend is Anthropic, OpenAI, Gemini, or a local llama.cpp / Ollama server.

Supported providers
───────────────────
  anthropic  →  Claude (claude-sonnet-4-6 etc.)
  openai     →  GPT-4o etc.
  gemini     →  Gemini 2.0 Flash etc.  (via Gemini's OpenAI-compatible endpoint)
  local      →  llama.cpp · Ollama · LM Studio  (OpenAI-compatible endpoint)
"""

import os
import tomllib
import httpx
from pathlib import Path

# Connect + first-byte timeout. Local models get longer (cold start).
_TIMEOUT_REMOTE = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0)
_TIMEOUT_LOCAL  = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=5.0)

BASE_DIR    = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.toml"

# Default models per provider (override in config.toml)
_DEFAULTS: dict[str, dict] = {
    "anthropic": {
        "answer_model": "claude-sonnet-4-6",
        "expand_model": "claude-haiku-4-5-20251001",
    },
    "openai": {
        "answer_model": "gpt-4o",
        "expand_model": "gpt-4o-mini",
        "base_url":     "https://api.openai.com/v1",
    },
    "gemini": {
        "answer_model": "gemini-2.0-flash",
        "expand_model": "gemini-2.0-flash",
        "base_url":     "https://generativelanguage.googleapis.com/v1beta/openai/",
    },
    "local": {
        "answer_model":  "local",
        "expand_model":  "local",
        "base_url":      "http://localhost:8080/v1",
        "api_key":       "no-key",
        "context_limit": 4096,   # match your llama-server --ctx-size; 0 = unlimited
    },
}

_ENV_KEY_MAP = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai":    "OPENAI_API_KEY",
    "gemini":    "GEMINI_API_KEY",
}


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "rb") as f:
            return tomllib.load(f)
    return {}


def fit_contexts(
    contexts:       list[dict],
    context_limit:  int,
    system:         str = "",
    question:       str = "",
    reserve_output: int = 2048,
) -> tuple[list[dict], int]:
    """
    Trim the contexts list so the full prompt stays within context_limit tokens.

    Token count is estimated as len(text) // 4 (chars-per-token approximation —
    accurate enough for truncation decisions without adding a tokenizer dep).

    Returns (trimmed_contexts, dropped_count).
    If context_limit == 0, returns all contexts unchanged.
    """
    if not context_limit or not contexts:
        return contexts, 0

    # Tokens consumed by fixed parts of the prompt
    overhead  = (len(system) + len(question)) // 4 + 300   # 300 = formatting slack
    available = context_limit - reserve_output - overhead

    if available <= 0:
        return contexts[:1], max(0, len(contexts) - 1)

    kept, used = [], 0
    for ctx in contexts:
        tokens = len(ctx["section_text"]) // 4
        if kept and used + tokens > available:
            break
        kept.append(ctx)
        used += tokens

    result = kept or contexts[:1]
    return result, len(contexts) - len(result)


def save_config(data: dict) -> None:
    """Rewrite config.toml from a flat dict returned by GET /api/config."""
    # Merge incoming data with existing config so untouched sections survive
    cfg = load_config()
    provider = data.get("provider", cfg.get("llm", {}).get("provider", "anthropic"))
    cfg.setdefault("llm", {})["provider"] = provider

    p = cfg.setdefault(provider, {})
    for key in ("api_key", "base_url", "answer_model", "expand_model"):
        if data.get(key):
            p[key] = data[key]
    if "context_limit" in data:
        p["context_limit"] = int(data["context_limit"])

    lines = ["# librerIA — LLM Configuration (managed by web UI or edited manually)\n\n"]
    lines.append(f'[llm]\nprovider = "{provider}"\n\n')

    for name in ("anthropic", "openai", "gemini", "local"):
        defs = _DEFAULTS.get(name, {})
        sect = {**defs, **cfg.get(name, {})}
        lines.append(f"[{name}]\n")
        for key in ("api_key", "base_url", "answer_model", "expand_model", "context_limit"):
            if key in sect:
                val = sect[key]
                lines.append(f'{key:<14} = {val!r}\n')
        lines.append("\n")

    CONFIG_FILE.write_text("".join(lines))


class LLM:
    """
    Unified sync + async LLM interface.

    Usage
    ─────
    llm = LLM()

    # Sync (CLI, query.py)
    text = llm.chat_sync(messages=[...], system="...", max_tokens=2048)

    # Async (web app, non-streaming)
    text = await llm.chat(messages=[...], system="...")

    # Async streaming (web app)
    async for chunk in llm.stream(messages=[...], system="..."):
        print(chunk, end="", flush=True)
    """

    def __init__(self):
        cfg = load_config()
        self.provider = cfg.get("llm", {}).get("provider", "anthropic")
        pcfg = {**_DEFAULTS.get(self.provider, {}), **cfg.get(self.provider, {})}

        self.answer_model  = pcfg.get("answer_model", "")
        self.expand_model  = pcfg.get("expand_model", self.answer_model)
        self.context_limit = int(pcfg.get("context_limit", 0))

        if self.provider == "anthropic":
            import anthropic
            key = pcfg.get("api_key") or os.environ.get("ANTHROPIC_API_KEY", "")
            self._sync  = anthropic.Anthropic(api_key=key,
                              timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0))
            self._async = anthropic.AsyncAnthropic(api_key=key,
                              timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0))

        elif self.provider in ("openai", "gemini", "local"):
            from openai import OpenAI, AsyncOpenAI
            if self.provider == "openai":
                key = pcfg.get("api_key") or os.environ.get("OPENAI_API_KEY", "")
                timeout = _TIMEOUT_REMOTE
            elif self.provider == "gemini":
                key = pcfg.get("api_key") or os.environ.get("GEMINI_API_KEY", "")
                pcfg["base_url"] = _DEFAULTS["gemini"]["base_url"]
                timeout = _TIMEOUT_REMOTE
            else:
                key = pcfg.get("api_key", "no-key")
                timeout = _TIMEOUT_LOCAL
            self._sync  = OpenAI(     api_key=key or "no-key", base_url=pcfg["base_url"],
                                       http_client=httpx.Client(timeout=timeout))
            self._async = AsyncOpenAI(api_key=key or "no-key", base_url=pcfg["base_url"],
                                       http_client=httpx.AsyncClient(timeout=timeout))
        else:
            raise ValueError(f"Unknown provider '{self.provider}'. "
                             f"Choose: anthropic | openai | gemini | local")

    # ── Verification ──────────────────────────────────────────────────────────

    def verify(self) -> tuple[bool, str]:
        """Return (ok, error_message). Use before CLI commands to surface config issues."""
        env = _ENV_KEY_MAP.get(self.provider)
        if env:
            cfg  = load_config()
            key  = cfg.get(self.provider, {}).get("api_key") or os.environ.get(env, "")
            if not key:
                return False, (
                    f"No API key configured for provider '{self.provider}'. "
                    f"Set the {env} environment variable or add api_key in config.toml."
                )
        return True, ""

    # ── Sync (for CLI / asyncio.to_thread wrappers) ───────────────────────────

    def chat_sync(
        self,
        messages:   list[dict],
        system:     str | None = None,
        max_tokens: int = 2048,
        model:      str | None = None,
    ) -> str:
        m = model or self.answer_model
        if self.provider == "anthropic":
            resp = self._sync.messages.create(
                model=m, max_tokens=max_tokens,
                system=system or "", messages=messages,
            )
            return resp.content[0].text
        else:
            msgs = ([{"role": "system", "content": system}] if system else []) + messages
            resp = self._sync.chat.completions.create(
                model=m, max_tokens=max_tokens, messages=msgs,
            )
            return resp.choices[0].message.content

    # ── Async non-streaming ───────────────────────────────────────────────────

    async def chat(
        self,
        messages:   list[dict],
        system:     str | None = None,
        max_tokens: int = 2048,
        model:      str | None = None,
    ) -> str:
        m = model or self.answer_model
        if self.provider == "anthropic":
            resp = await self._async.messages.create(
                model=m, max_tokens=max_tokens,
                system=system or "", messages=messages,
            )
            return resp.content[0].text
        else:
            msgs = ([{"role": "system", "content": system}] if system else []) + messages
            resp = await self._async.chat.completions.create(
                model=m, max_tokens=max_tokens, messages=msgs,
            )
            return resp.choices[0].message.content

    # ── Async streaming ───────────────────────────────────────────────────────

    async def stream(
        self,
        messages:   list[dict],
        system:     str | None = None,
        max_tokens: int = 2048,
        model:      str | None = None,
    ):
        """Async generator — yields text chunks as they arrive."""
        m = model or self.answer_model
        if self.provider == "anthropic":
            async with self._async.messages.stream(
                model=m, max_tokens=max_tokens,
                system=system or "", messages=messages,
            ) as s:
                async for chunk in s.text_stream:
                    yield chunk
        else:
            msgs = ([{"role": "system", "content": system}] if system else []) + messages
            resp = await self._async.chat.completions.create(
                model=m, max_tokens=max_tokens, messages=msgs, stream=True,
            )
            async for chunk in resp:
                content = chunk.choices[0].delta.content
                if content:
                    yield content

    # ── Info (for UI / logging) ───────────────────────────────────────────────

    def info(self) -> dict:
        return {
            "provider":      self.provider,
            "answer_model":  self.answer_model,
            "expand_model":  self.expand_model,
            "context_limit": self.context_limit,
        }
