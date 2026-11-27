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
  transport?: Transport;
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
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new SchemaError('invalid_json');
    }
    try {
      return schema.parse(data);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message.slice(0, 500) : 'schema_mismatch';
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

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.opts.model,
        messages: msgs,
        temperature,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`llm_status_${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }
}