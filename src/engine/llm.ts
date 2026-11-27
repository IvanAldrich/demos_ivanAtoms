export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type Transport = (
  msgs: ChatMessage[],
  opts: { json: boolean },
) => Promise<string>;

export class SchemaError extends Error {
  constructor(public readonly reason: string) {
    super(`SchemaError: ${reason}`);
    this.name = 'SchemaError';
  }
}

export interface LlmOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  transport?: Transport;
}

function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1));
    } catch {
      /* fall through */
    }
  }
  throw new SchemaError('invalid_json');
}

/** Minimal OpenAI-compatible client; JSON-only helper used by pipeline stages. */
export class LlmClient {
  constructor(private readonly opts: LlmOptions) {}

  async completeJSON<T>(
    msgs: ChatMessage[],
    schema: { parse: (v: unknown) => T },
    opts: { temperature?: number } = {},
  ): Promise<T> {
    const raw = await this.call(msgs, true, opts.temperature);
    const data = extractJson(raw);
    try {
      return schema.parse(data);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message.slice(0, 600) : 'schema_mismatch';
      throw new SchemaError(detail);
    }
  }

  private async call(
    msgs: ChatMessage[],
    json: boolean,
    temperature = 0.2,
  ): Promise<string> {
    if (this.opts.transport) return this.opts.transport(msgs, { json });

    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

    const buildBody = (withFormat: boolean) =>
      JSON.stringify({
        model: this.opts.model,
        messages: msgs,
        temperature,
        ...(json && withFormat ? { response_format: { type: 'json_object' } } : {}),
      });

    // Timeout covers the WHOLE request including response body read.
    const timeoutMs = this.opts.timeoutMs ?? (Number(process.env.LLM_TIMEOUT_MS) || 120_000);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const doFetch = (withFormat: boolean) =>
      fetch(url, { method: 'POST', headers, body: buildBody(withFormat), signal: ctrl.signal });

    try {
      let res = await doFetch(true);
      if (!res.ok && res.status === 400) {
        const text = await res.text();
        if (/response_format|json_object/i.test(text)) {
          res = await doFetch(false);
        } else {
          throw new Error(`llm_status_${res.status}: ${text.slice(0, 200)}`);
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`llm_status_${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? '';
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') throw new Error('llm_timeout');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}