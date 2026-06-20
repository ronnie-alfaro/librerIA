import { FormEvent, useEffect, useState } from 'react';
import { fetchConfig, fetchConfigModels, saveConfig } from '../api/client';
import type { LlmConfig } from '../domain';

const providers = ['anthropic', 'openai', 'gemini', 'local'];
type ModelLoadPayload = Partial<LlmConfig> & { api_key?: string };

export function SettingsView() {
  const [provider, setProvider] = useState('anthropic');
  const [answerModel, setAnswerModel] = useState('');
  const [expandModel, setExpandModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [contextLimit, setContextLimit] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    fetchConfig()
      .then((config) => {
        setProvider(config.provider);
        setAnswerModel(config.answer_model);
        setExpandModel(config.expand_model);
        setBaseUrl(config.base_url);
        setContextLimit(config.context_limit);
        setHasKey(config.has_key);
        if (config.has_key || config.provider === 'local') {
          void loadModels({
            provider: config.provider,
            base_url: config.base_url,
            answer_model: config.answer_model,
            expand_model: config.expand_model,
          });
        }
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : 'No se pudieron cargar los ajustes.'));
  }, []);

  async function loadModels(payload: ModelLoadPayload = {
    provider,
    base_url: baseUrl,
    answer_model: answerModel,
    expand_model: expandModel,
    api_key: apiKey,
    context_limit: contextLimit,
  }) {
    setLoadingModels(true);
    try {
      const result = await fetchConfigModels(payload);
      setModels(result.models);
      if (result.models.length) {
        setAnswerModel((current) => current && result.models.includes(current) ? current : result.models[0]);
        setExpandModel((current) => current && result.models.includes(current) ? current : result.models[0]);
      }
      if (result.error) setStatus(result.error);
    } catch (err) {
      setModels([]);
      setStatus(err instanceof Error ? err.message : 'No se pudieron cargar los modelos.');
    } finally {
      setLoadingModels(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      await saveConfig({
        provider,
        answer_model: answerModel,
        expand_model: expandModel,
        base_url: baseUrl,
        api_key: apiKey,
        context_limit: contextLimit,
      });
      setStatus('Ajustes guardados.');
      if (apiKey) setHasKey(true);
      await loadModels({
        provider,
        answer_model: answerModel,
        expand_model: expandModel,
        base_url: baseUrl,
        context_limit: contextLimit,
      });
      setApiKey('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'No se pudieron guardar los ajustes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Motor LLM</span>
          <h1>Ajustes</h1>
          <p>Configura el proveedor usado para expansión de búsqueda y generación de respuestas.</p>
        </div>
      </header>

      <form className="settings-grid" onSubmit={submit}>
        <label>
          Proveedor
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setModels([]);
            }}
          >
            {providers.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Modelo de respuesta
          {models.length ? (
            <select value={answerModel} onChange={(event) => setAnswerModel(event.target.value)}>
              {models.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
          ) : (
            <input value={answerModel} onChange={(event) => setAnswerModel(event.target.value)} placeholder="Guarda o conecta para cargar modelos" />
          )}
        </label>
        <label>
          Modelo de expansión
          {models.length ? (
            <select value={expandModel} onChange={(event) => setExpandModel(event.target.value)}>
              {models.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
          ) : (
            <input value={expandModel} onChange={(event) => setExpandModel(event.target.value)} placeholder="Usa un modelo pequeño/rápido si existe" />
          )}
        </label>
        <label>
          URL base
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Solo necesario para proveedores compatibles con OpenAI" />
        </label>
        <label>
          Clave API {hasKey && <span className="hint">configurada</span>}
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasKey ? 'Déjalo vacío para conservar la clave actual' : 'Pega la clave API'} type="password" />
        </label>
        <label>
          Límite de contexto
          <input value={contextLimit} onChange={(event) => setContextLimit(Number(event.target.value))} type="number" min="0" />
        </label>
        <div className="settings-actions">
          <button className="button" disabled={saving}>{saving ? 'Guardando...' : 'Guardar ajustes'}</button>
          <button className="button secondary" type="button" onClick={() => void loadModels()} disabled={saving || loadingModels}>
            {loadingModels ? 'Cargando modelos...' : 'Cargar modelos'}
          </button>
          {status && <span>{status}</span>}
        </div>
      </form>
    </div>
  );
}
