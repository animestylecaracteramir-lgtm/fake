import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings as SettingsIcon, 
  Save, 
  ShieldCheck, 
  Check, 
  KeyRound,
  Sparkles
} from 'lucide-react';
import { LLMSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'autonomous_agent_llm_settings_v3';

const DEFAULT_SETTINGS: LLMSettings = {
  provider: 'openai_compatible',
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  maxTokens: 4096,
  temperature: 0.2,
  maxRetries: 5,
};

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<LLMSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            provider: 'openai_compatible',
          };
        }
      }
    } catch {}
    return DEFAULT_SETTINGS;
  });

  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const presets = [
    { name: 'OpenAI (Official)', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o', provider: 'openai_compatible' },
    { name: 'Ollama (Local / Free)', baseURL: 'http://localhost:11434/v1', model: 'llama3.2', provider: 'openai_compatible' },
    { name: 'OpenRouter (Multi-Model)', baseURL: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet', provider: 'openai_compatible' },
    { name: 'Groq (Ultra-Fast)', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', provider: 'openai_compatible' },
    { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', provider: 'openai_compatible' },
  ];

  // Keep localStorage continuously updated
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // Initial fetch from server to synchronize with disk/env
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(serverData => {
        if (serverData && typeof serverData === 'object') {
          setSettings(prev => {
            const resolvedApiKey = serverData.apiKey || prev.apiKey || '';
            const merged: LLMSettings = {
              ...prev,
              ...serverData,
              apiKey: resolvedApiKey,
              provider: 'openai_compatible',
            };
            try {
              localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      })
      .catch(() => {});
  }, []);

  const saveToServer = async (settingsToSave: LLMSettings) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsToSave),
      });
      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } catch (err) {
      console.error('Failed to save settings to server:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveToServer(settings);
  };

  const applyPreset = (p: any) => {
    const updated: LLMSettings = {
      ...settings,
      provider: 'openai_compatible',
      baseURL: p.baseURL,
      model: p.model,
    };
    setSettings(updated);
    saveToServer(updated);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto font-mono">
      {/* Top Banner */}
      <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              LLM Adapter & Free-First Runtime Configuration
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              Configure universal OpenAI-compatible endpoints (OpenAI, Ollama, OpenRouter, Groq, DeepSeek, Localhost).
            </p>
          </div>
        </div>
      </div>

      {/* Preset Buttons */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-md space-y-3">
        <span className="text-xs font-bold uppercase tracking-widest text-zinc-500 block">
          Quick Provider Presets
        </span>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className="px-3.5 py-1.5 text-xs font-mono font-medium bg-[#111] hover:bg-[#1a1a1a] text-zinc-300 hover:text-white rounded-lg border border-[#262626] transition-all hover:border-[#333]"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Provider Mode
            </label>
            <select
              value={settings.provider}
              onChange={(e) => setSettings({ ...settings, provider: e.target.value as any })}
              className="w-full px-3 py-2 text-xs bg-[#080808] border border-[#262626] text-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value="openai_compatible">OpenAI-Compatible (OpenAI, Ollama, OpenRouter, Groq, DeepSeek, Localhost)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Model Name / Tag
            </label>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              placeholder="e.g. gpt-4o, llama3.2, deepseek-chat, claude-3.5-sonnet"
              className="w-full px-3 py-2 text-xs bg-[#080808] border border-[#262626] text-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
            Base URL Endpoint
          </label>
          <input
            type="text"
            value={settings.baseURL}
            onChange={(e) => setSettings({ ...settings, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1 or http://localhost:11434/v1"
            className="w-full px-3 py-2 text-xs bg-[#080808] border border-[#262626] text-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-zinc-500" />
            API Key / Token (Optional for Local Ollama)
          </label>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            placeholder="Leave blank for local Ollama or to rely on server defaults"
            className="w-full px-3 py-2 text-xs bg-[#080808] border border-[#262626] text-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Max Tokens per Iteration: <span className="text-blue-400 font-mono">{settings.maxTokens}</span>
            </label>
            <input
              type="range"
              min="1024"
              max="16384"
              step="512"
              value={settings.maxTokens}
              onChange={(e) => setSettings({ ...settings, maxTokens: parseInt(e.target.value) })}
              className="w-full accent-blue-500 bg-[#161616]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Temperature: <span className="text-blue-400 font-mono">{settings.temperature}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.temperature}
              onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
              className="w-full accent-blue-500 bg-[#161616]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>API Retry Attempts:</span>
              <span className="text-emerald-400 font-mono font-bold">{settings.maxRetries ?? 5} Tries</span>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={settings.maxRetries ?? 5}
              onChange={(e) => setSettings({ ...settings, maxRetries: parseInt(e.target.value) })}
              className="w-full accent-emerald-500 bg-[#161616]"
            />
            <span className="text-[10px] text-zinc-500 block mt-1">
              Auto-retry on 429/5xx & network drops with exponential backoff.
            </span>
          </div>
        </div>

        <div className="pt-4 border-t border-[#222] flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500 font-sans">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Credentials are strictly sanitized and never exposed in client streams.</span>
          </div>

          <button
            type="submit"
            className="px-6 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)] flex items-center gap-2 uppercase tracking-wider"
          >
            {savedSuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
            <span>{savedSuccess ? 'Settings Saved!' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
