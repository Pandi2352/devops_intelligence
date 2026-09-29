import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { AiConnector, IAiConnector } from '../models/AiConnector.js';
import { audit } from '../services/approvals.js';
import { chatModels, complete, describeAiError, listModels } from '../services/openaiClient.js';
import { maskSecret } from '../utils/secrets.js';
import { cleanString, isHttpUrl, isValidId, nameMatch, normalizeUrl } from '../utils/validation.js';

export const serializeAi = (c: IAiConnector) => ({
  _id: String(c._id),
  name: c.name,
  provider: c.provider,
  baseUrl: c.baseUrl,
  organization: c.organization,
  project: c.project,
  defaultModel: c.defaultModel,
  models: c.models,
  maxOutputTokens: c.maxOutputTokens,
  hasKey: Boolean(c.apiKey),
  keyHint: maskSecret(c.apiKey),
  isDefault: c.isDefault,
  isActive: c.isActive,
  status: c.status,
  lastError: c.lastError,
  lastTestedAt: c.lastTestedAt,
  usage: c.usage,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

type AiFields = Pick<IAiConnector, 'name' | 'provider' | 'baseUrl' | 'apiKey' | 'organization' | 'project' | 'defaultModel' | 'maxOutputTokens'>;

const readInput = (body: any, current?: IAiConnector | null): { fields?: AiFields; error?: string } => {
  const name = cleanString(body.name ?? current?.name, 80);
  if (!name) return { error: 'Enter a name' };
  const provider = (body.provider ?? current?.provider ?? 'openai') === 'openai-compatible' ? 'openai-compatible' : 'openai';
  const baseUrl = normalizeUrl(String(body.baseUrl ?? current?.baseUrl ?? '') || 'https://api.openai.com/v1');
  if (!isHttpUrl(baseUrl)) return { error: 'Base URL must be a valid http(s) URL' };
  const apiKey = body.apiKey ? String(body.apiKey).trim() : current?.apiKey || '';
  if (!apiKey && provider === 'openai') return { error: 'Enter the OpenAI API key' };
  if (apiKey && /\s/.test(apiKey)) return { error: 'The API key must not contain spaces' };
  const maxOutputTokens = Math.min(Math.max(Number(body.maxOutputTokens ?? current?.maxOutputTokens ?? 16000) || 16000, 2000), 128000);
  return {
    fields: {
      name,
      provider,
      baseUrl,
      apiKey,
      organization: cleanString(body.organization ?? current?.organization, 100),
      project: cleanString(body.project ?? current?.project, 100),
      defaultModel: cleanString(body.defaultModel ?? current?.defaultModel, 100),
      maxOutputTokens,
    },
  };
};

// Lists models (proves the key) and, when a model is chosen, asks it for one word.
const probe = async (f: AiFields) => {
  const all = await listModels(f);
  const models = f.provider === 'openai' ? chatModels(all) : all;
  let detail = `${models.length} chat model${models.length === 1 ? '' : 's'} available`;
  if (f.defaultModel) {
    if (models.length && !models.includes(f.defaultModel)) throw new Error(`Model ${f.defaultModel} is not available for this key`);
    const started = Date.now();
    const r = await complete(f, { model: f.defaultModel, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxOutputTokens: 200, timeoutMs: 60000 });
    detail += ` · ${f.defaultModel} answered "${r.content.trim().slice(0, 20)}" in ${((Date.now() - started) / 1000).toFixed(1)} s`;
  } else detail += ' · pick a default model';
  return { models, message: `API key valid · ${detail}` };
};

const applyProbe = async (doc: IAiConnector) => {
  doc.lastTestedAt = new Date();
  try {
    const r = await probe(doc);
    doc.models = r.models;
    doc.status = 'Connected';
    doc.lastError = '';
    return { ok: true, message: r.message };
  } catch (err: any) {
    doc.status = 'Error';
    doc.lastError = err?.response ? describeAiError(err) : err?.message || 'Test failed';
    return { ok: false, message: doc.lastError };
  }
};

const findDoc = (id: unknown) => (isValidId(id) ? AiConnector.findById(id) : Promise.resolve(null));

export const listAiConnectors = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ connectors: (await AiConnector.find().sort({ isDefault: -1, name: 1 })).map(serializeAi) });
};

export const createAiConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const { fields, error } = readInput(req.body || {});
  if (!fields) {
    res.status(400).json({ message: error });
    return;
  }
  if (await AiConnector.exists({ name: nameMatch(fields.name) })) {
    res.status(409).json({ message: `An AI connector named ${fields.name} already exists` });
    return;
  }
  const first = !(await AiConnector.exists({}));
  const doc = new AiConnector({ ...fields, isDefault: first || Boolean(req.body.isDefault), isActive: req.body.isActive !== false });
  if (doc.isDefault) await AiConnector.updateMany({}, { isDefault: false });
  const test = await applyProbe(doc);
  await doc.save();
  await audit(req.user, { action: 'CONNECTOR', target: `AI · ${doc.name}`, outcome: 'changed', message: `Added (${doc.provider}). ${test.message}` });
  res.status(201).json({ message: `${doc.name} added`, test, connector: serializeAi(doc) });
};

export const updateAiConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'AI connector not found' });
    return;
  }
  const { fields, error } = readInput(req.body || {}, doc);
  if (!fields) {
    res.status(400).json({ message: error });
    return;
  }
  if (fields.name.toLowerCase() !== doc.name.toLowerCase() && (await AiConnector.exists({ name: nameMatch(fields.name) }))) {
    res.status(409).json({ message: `An AI connector named ${fields.name} already exists` });
    return;
  }
  Object.assign(doc, fields);
  if (typeof req.body.isActive === 'boolean') doc.isActive = req.body.isActive;
  if (req.body.isDefault === true) {
    await AiConnector.updateMany({ _id: { $ne: doc._id } }, { isDefault: false });
    doc.isDefault = true;
  }
  const test = await applyProbe(doc);
  await doc.save();
  await audit(req.user, { action: 'CONNECTOR', target: `AI · ${doc.name}`, outcome: 'changed', message: `Updated${req.body.apiKey ? ' (new API key)' : ''}. ${test.message}` });
  res.json({ message: `${doc.name} saved`, test, connector: serializeAi(doc) });
};

export const setDefaultAiConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'AI connector not found' });
    return;
  }
  await AiConnector.updateMany({ _id: { $ne: doc._id } }, { isDefault: false });
  doc.isDefault = true;
  await doc.save();
  res.json({ message: `'${doc.name}' is now the default AI connector`, connector: serializeAi(doc) });
};

export const deleteAiConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'AI connector not found' });
    return;
  }
  await doc.deleteOne();
  if (doc.isDefault) {
    const next = await AiConnector.findOne().sort({ createdAt: 1 });
    if (next) await AiConnector.updateOne({ _id: next._id }, { isDefault: true });
  }
  await audit(req.user, { action: 'CONNECTOR', target: `AI · ${doc.name}`, outcome: 'changed', message: 'Deleted with its saved API key' });
  res.json({ message: `${doc.name} deleted` });
};

// The form's "Test connection" (unsaved values; reuses the stored key when editing). Returns the model list.
export const testAiConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  const current = await findDoc(req.body?.id);
  const { fields, error } = readInput({ name: 'test', ...(req.body || {}) }, current);
  if (!fields) {
    res.status(400).json({ ok: false, message: error });
    return;
  }
  try {
    const r = await probe(fields);
    res.json({ ok: true, message: r.message, models: r.models });
  } catch (err: any) {
    res.json({ ok: false, message: err?.response ? describeAiError(err) : err?.message, models: [] });
  }
};

export const testSavedAiConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'AI connector not found' });
    return;
  }
  const test = await applyProbe(doc);
  await doc.save();
  res.json({ ...test, connector: serializeAi(doc) });
};
