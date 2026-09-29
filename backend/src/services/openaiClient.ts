import axios from 'axios';
import { AiConnector, IAiConnector } from '../models/AiConnector.js';

// OpenAI Chat Completions (also served by OpenAI-compatible APIs). Tool calling + structured JSON output.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  run: (args: any) => Promise<unknown>;
}

export type AiConn = Pick<IAiConnector, 'baseUrl' | 'apiKey' | 'organization' | 'project'>;

const headers = (c: AiConn) => ({
  Authorization: `Bearer ${c.apiKey}`,
  'Content-Type': 'application/json',
  ...(c.organization ? { 'OpenAI-Organization': c.organization } : {}),
  ...(c.project ? { 'OpenAI-Project': c.project } : {}),
});

const base = (c: AiConn) => (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');

export const describeAiError = (err: any): string => {
  const status = err?.response?.status;
  const msg = err?.response?.data?.error?.message || err?.response?.data?.message;
  if (status === 401) return 'The AI provider rejected the API key (401). Check it was copied completely and is not revoked.';
  if (status === 403) return `Access denied (403)${msg ? `: ${msg}` : ''}`;
  if (status === 404) return msg || 'Not found (404): check the base URL and the model name.';
  if (status === 429) return `Rate limit or quota reached (429)${msg ? `: ${msg}` : ''}. Check billing/limits in your OpenAI account.`;
  if (status) return `AI provider responded with HTTP ${status}${msg ? `: ${String(msg).slice(0, 300)}` : ''}`;
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'The AI provider did not answer in time.';
  if (err?.code === 'ENOTFOUND') return 'Could not resolve the AI provider host. Check the base URL and internet access.';
  return err?.message || 'AI request failed';
};

export const listModels = async (c: AiConn): Promise<string[]> => {
  const res = await axios.get(`${base(c)}/models`, { headers: headers(c), timeout: 20000 });
  return ((res.data?.data || []) as { id: string }[]).map((m) => m.id).sort();
};

// Chat models only (the /models list also has embeddings, audio, image and moderation models).
export const chatModels = (ids: string[]) =>
  ids.filter((id) => /^(gpt-|o\d|chatgpt-)/i.test(id) && !/(embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search)/i.test(id));

interface CompletionOpts {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  maxToolRounds?: number;
  timeoutMs?: number;
  /** Called before each request and after tool calls, for progress messages. */
  onProgress?: (e: { round: number; phase: 'thinking' | 'tools'; tools: { name: string; count: number }[] }) => void | Promise<void>;
}

export interface CompletionResult {
  content: string;
  messages: ChatMessage[]; // including tool calls and results
  usage: { promptTokens: number; completionTokens: number; requests: number };
  toolCalls: { name: string; args: unknown; result: unknown }[];
}

// Runs the tool loop until the model answers. Tools are executed server-side.
export const complete = async (c: AiConn, o: CompletionOpts): Promise<CompletionResult> => {
  const messages = [...o.messages];
  const usage = { promptTokens: 0, completionTokens: 0, requests: 0 };
  const toolCalls: CompletionResult['toolCalls'] = [];
  const tools = o.tools?.length
    ? o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    : undefined;

  const maxRounds = o.maxToolRounds ?? 12;
  for (let round = 0; round <= maxRounds; round++) {
    const last = round === maxRounds;
    await o.onProgress?.({ round, phase: 'thinking', tools: [] });
    const body: Record<string, unknown> = {
      model: o.model,
      messages: last && tools ? [...messages, { role: 'system', content: 'Stop calling tools now. Answer with the information you already have.' }] : messages,
      // Tools stay declared (the history has tool calls) but may not be called on the final round.
      ...(tools ? { tools, tool_choice: last ? 'none' : 'auto' } : {}),
      ...(o.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: o.jsonSchema.name, strict: true, schema: o.jsonSchema.schema } } } : {}),
      ...(o.maxOutputTokens ? { max_completion_tokens: o.maxOutputTokens } : {}),
    };
    const res = await axios.post(`${base(c)}/chat/completions`, body, { headers: headers(c), timeout: o.timeoutMs ?? 300000 });
    usage.requests += 1;
    usage.promptTokens += res.data?.usage?.prompt_tokens || 0;
    usage.completionTokens += res.data?.usage?.completion_tokens || 0;
    const choice = res.data?.choices?.[0];
    const msg = choice?.message || {};
    if (msg.tool_calls?.length && o.tools?.length && !last) {
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
      await o.onProgress?.({
        round,
        phase: 'tools',
        tools: msg.tool_calls.map((tc: any) => {
          let count = 1;
          try {
            const a = JSON.parse(tc.function?.arguments || '{}');
            if (Array.isArray(a.packages)) count = a.packages.length;
          } catch {
            /* ignore */
          }
          return { name: tc.function?.name, count };
        }),
      });
      for (const call of msg.tool_calls) {
        const tool = o.tools.find((t) => t.name === call.function?.name);
        let args: unknown = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}');
        } catch {
          /* bad JSON from the model */
        }
        let result: unknown;
        try {
          result = tool ? await tool.run(args) : { error: `Unknown tool ${call.function?.name}` };
        } catch (err: any) {
          result = { error: err?.message || 'Tool failed' };
        }
        toolCalls.push({ name: call.function?.name, args, result });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
      }
      continue;
    }
    if (choice?.finish_reason === 'length') throw new Error('The AI answer was cut off (output token limit). Try again, or raise "max output tokens" on the AI connector.');
    if (msg.refusal) throw new Error(`The model refused: ${msg.refusal}`);
    const content = String(msg.content ?? '');
    messages.push({ role: 'assistant', content });
    return { content, messages, usage, toolCalls };
  }
  throw new Error('The AI kept calling tools without answering; try again.');
};

export const recordUsage = async (connectorId: string, u: CompletionResult['usage']) => {
  await AiConnector.updateOne(
    { _id: connectorId },
    { $inc: { 'usage.promptTokens': u.promptTokens, 'usage.completionTokens': u.completionTokens, 'usage.requests': u.requests } }
  ).catch(() => undefined);
};

export const defaultAiConnector = async (id?: string) => {
  if (id) {
    const c = await AiConnector.findOne({ _id: id, isActive: true }).catch(() => null);
    if (c) return c;
  }
  return (await AiConnector.findOne({ isActive: true, isDefault: true })) || AiConnector.findOne({ isActive: true }).sort({ createdAt: 1 });
};
