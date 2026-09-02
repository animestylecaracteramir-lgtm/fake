import React, { useState, useRef } from 'react';
import { 
  Play, 
  Sparkles, 
  ShieldCheck, 
  Cpu, 
  Terminal, 
  Layers, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  ArrowRight,
  Shield,
  FileCode,
  Share2,
  ExternalLink,
  Upload,
  Download,
  FileJson,
  Copy,
  Check,
  Code,
  FileText,
  X,
  RefreshCw
} from 'lucide-react';
import { AgentState } from '../types';

interface AgentDashboardProps {
  state: AgentState;
  onStartAgent: (goal: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSelectTab: (tab: string) => void;
}

export const AgentDashboard: React.FC<AgentDashboardProps> = ({
  state,
  onStartAgent,
  onPause,
  onResume,
  onStop,
  onSelectTab,
}) => {
  const [inputMode, setInputMode] = useState<'text' | 'json'>('text');
  const [goalInput, setGoalInput] = useState('');
  const [jsonInput, setJsonInput] = useState(`{
  "goal": "Build a production-ready V2Ray VLESS server configuration on port 443 with TCP transport and Reality security (SNI www.cloudflare.com, flow xtls-rprx-vision).",
  "parameters": {
    "protocol": "vless",
    "port": 443,
    "transport": "tcp",
    "security": "reality",
    "routing_rules": ["adblock", "private_ips"]
  },
  "max_iterations": 20,
  "auto_verify": true,
  "export_destination": "outputs/vless_reality_server.json"
}`);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showJsonExportModal, setShowJsonExportModal] = useState(false);
  const [exportType, setExportType] = useState<'full_state' | 'artifacts_only' | 'goal_spec'>('full_state');
  const [copiedExport, setCopiedExport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presets = [
    {
      title: 'VLESS + Reality Server Config',
      desc: 'Build & verify a production VLESS Reality server on port 443 with adblock and GeoIP private filters.',
      goal: 'Build a production-ready V2Ray VLESS server configuration on port 443 with TCP transport and Reality security (SNI www.cloudflare.com, dest www.cloudflare.com:443, flow xtls-rprx-vision). Enable ad-blocking and private IP blocking routing rules. Validate schema rigorously and export to outputs/vless_reality_server.json.',
      badge: 'V2Ray / Xray',
      jsonSpec: {
        goal: 'Build a production-ready V2Ray VLESS server configuration on port 443 with TCP transport and Reality security (SNI www.cloudflare.com, dest www.cloudflare.com:443, flow xtls-rprx-vision). Enable ad-blocking and private IP blocking routing rules. Validate schema rigorously and export to outputs/vless_reality_server.json.',
        protocol: 'vless',
        port: 443,
        security: 'reality',
        export_file: 'outputs/vless_reality_server.json'
      }
    },
    {
      title: 'VMess + WebSocket Client Link',
      desc: 'Create client VMess over WebSocket with TLS, validate structure, and generate share link.',
      goal: 'Synthesize a client V2Ray VMess configuration connecting to edge.server.example.com on port 443 with WebSocket transport (path /v2ray-ws) and TLS security. Validate the configuration, test it, and export both the client JSON config and shareable vmess:// link.',
      badge: 'Client Share Link',
      jsonSpec: {
        goal: 'Synthesize a client V2Ray VMess configuration connecting to edge.server.example.com on port 443 with WebSocket transport (path /v2ray-ws) and TLS security. Validate the configuration, test it, and export both the client JSON config and shareable vmess:// link.',
        protocol: 'vmess',
        transport: 'ws',
        security: 'tls',
        generate_share_link: true
      }
    },
    {
      title: 'Synthesize Custom Python Tool',
      desc: 'Create, test, and persist a self-extending mathematical optimization tool into registry.',
      goal: 'Create a new custom tool named "calculate_crypto_entropy" that takes a string argument and returns its Shannon entropy score and security rating. Test the tool with sample inputs, verify its behavior, and save the experiment log in memory.',
      badge: 'Self-Extending Agent',
      jsonSpec: {
        goal: 'Create a new custom tool named "calculate_crypto_entropy" that takes a string argument and returns its Shannon entropy score and security rating. Test the tool with sample inputs, verify its behavior, and save the experiment log in memory.',
        tool_name: 'calculate_crypto_entropy',
        category: 'custom',
        auto_test: true
      }
    },
    {
      title: 'System & Package Audit Report',
      desc: 'Inspect environment, list installed dependencies, and compile a verified markdown report.',
      goal: 'Inspect the system execution environment, list all available Python packages, verify tool registry status, and compile a comprehensive system health audit report in outputs/system_audit_report.md.',
      badge: 'System Audit',
      jsonSpec: {
        goal: 'Inspect the system execution environment, list all available Python packages, verify tool registry status, and compile a comprehensive system health audit report in outputs/system_audit_report.md.',
        output_format: 'markdown',
        destination: 'outputs/system_audit_report.md'
      }
    },
  ];

  const handleJsonInputChange = (val: string) => {
    setJsonInput(val);
    try {
      const parsed = JSON.parse(val);
      setJsonError(null);
      if (parsed.goal && typeof parsed.goal === 'string') {
        setGoalInput(parsed.goal);
      }
    } catch (err: any) {
      setJsonError(err.message || 'Invalid JSON syntax');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        setJsonInput(JSON.stringify(parsed, null, 2));
        setJsonError(null);
        if (parsed.goal && typeof parsed.goal === 'string') {
          setGoalInput(parsed.goal);
        } else if (typeof parsed === 'string') {
          setGoalInput(parsed);
        } else {
          setGoalInput(JSON.stringify(parsed));
        }
        setInputMode('json');
      } catch (err: any) {
        setJsonError('Failed to parse JSON file: ' + err.message);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMode === 'json') {
      try {
        const parsed = JSON.parse(jsonInput);
        const goalStr = parsed.goal || JSON.stringify(parsed);
        if (!goalStr.trim()) return;
        onStartAgent(goalStr);
      } catch (err: any) {
        setJsonError('Invalid JSON: ' + err.message);
      }
    } else {
      if (!goalInput.trim()) return;
      onStartAgent(goalInput.trim());
    }
  };

  const handleApplyPreset = (preset: typeof presets[0]) => {
    setGoalInput(preset.goal);
    setJsonInput(JSON.stringify(preset.jsonSpec, null, 2));
    onStartAgent(preset.goal);
  };

  const getExportData = () => {
    if (exportType === 'artifacts_only') {
      return {
        timestamp: new Date().toISOString(),
        goal: state.goal,
        status: state.status,
        artifacts: state.artifacts,
        validationStatus: state.validationStatus,
      };
    } else if (exportType === 'goal_spec') {
      return {
        goal: state.goal || goalInput,
        strategy: state.currentStrategy,
        currentPlan: state.currentPlan,
        iterationCount: state.iterationCount,
        maxIterations: state.maxIterations,
        timestamp: new Date().toISOString(),
      };
    }
    return state;
  };

  const handleDownloadJson = () => {
    const data = getExportData();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent_${exportType}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = () => {
    const data = getExportData();
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 2000);
  };

  const loopPhases = [
    'GOAL',
    'REASON',
    'PLAN',
    'TOOL SELECTION',
    'EXECUTE',
    'OBSERVE',
    'VERIFY',
    'REPAIR',
    'COMPLETE',
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-mono">
      {/* Top Banner / Goal Formulation Box */}
      <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-widest uppercase flex items-center gap-2">
                Autonomous Goal Formulation
              </h2>
              <p className="text-xs text-zinc-400 font-sans mt-0.5">
                Provide natural language intent or structured JSON input &middot; Export execution output as JSON
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Input Mode Selector */}
            <div className="flex items-center gap-1 bg-[#111] p-1 rounded-xl border border-[#222]">
              <button
                type="button"
                onClick={() => setInputMode('text')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 uppercase tracking-wider ${
                  inputMode === 'text'
                    ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.35)]'
                    : 'text-zinc-400 hover:text-white hover:bg-[#1a1a1a]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Text Prompt</span>
              </button>

              <button
                type="button"
                onClick={() => setInputMode('json')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 uppercase tracking-wider ${
                  inputMode === 'json'
                    ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.35)]'
                    : 'text-zinc-400 hover:text-white hover:bg-[#1a1a1a]'
                }`}
              >
                <FileJson className="w-3.5 h-3.5" />
                <span>JSON Input</span>
              </button>
            </div>

            {/* Hidden File Input for JSON Upload */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".json,application/json"
              className="hidden"
            />

            {/* Import JSON File Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-bold bg-[#141414] hover:bg-[#202020] text-zinc-300 hover:text-white border border-[#333] rounded-xl transition-all flex items-center gap-1.5 uppercase tracking-wider shadow-sm"
              title="Upload JSON File"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span>Import JSON</span>
            </button>

            {/* Export JSON Button */}
            <button
              type="button"
              onClick={() => setShowJsonExportModal(true)}
              className="px-3 py-1.5 text-xs font-bold bg-[#141414] hover:bg-[#202020] text-zinc-300 hover:text-white border border-[#333] rounded-xl transition-all flex items-center gap-1.5 uppercase tracking-wider shadow-sm"
              title="Export Current State & Artifacts to JSON"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export JSON</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {inputMode === 'text' ? (
            <div className="relative">
              <textarea
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="e.g. Build and verify a high-performance VLESS + Reality Server config on port 443 with ad-blocking and export to outputs/..."
                rows={3}
                disabled={state.status === 'running'}
                className="w-full px-4 py-3 text-sm text-zinc-100 bg-[#080808] border border-[#262626] rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-zinc-600 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-blue-400" />
                  Structured JSON Goal & Execution Parameters:
                </span>
                {jsonError ? (
                  <span className="text-rose-400 font-bold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Syntax Error: {jsonError}
                  </span>
                ) : (
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Valid JSON Payload
                  </span>
                )}
              </div>
              <textarea
                value={jsonInput}
                onChange={(e) => handleJsonInputChange(e.target.value)}
                rows={7}
                disabled={state.status === 'running'}
                className="w-full p-3.5 text-xs text-emerald-400 bg-[#050505] border border-[#262626] rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-mono leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Full JSON In/Out Support &middot; Zero API keys written to logs</span>
            </div>

            <div className="flex items-center gap-2">
              {state.status === 'running' ? (
                <>
                  <button
                    type="button"
                    onClick={onPause}
                    className="px-4 py-2 text-xs font-bold text-zinc-300 bg-[#161616] hover:bg-[#222] border border-[#333] rounded-lg transition-colors uppercase tracking-wider"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={onStop}
                    className="px-4 py-2 text-xs font-bold text-rose-300 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-900/50 rounded-lg transition-colors uppercase tracking-wider"
                  >
                    Stop Agent
                  </button>
                </>
              ) : state.status === 'paused' ? (
                <button
                  type="button"
                  onClick={onResume}
                  className="px-5 py-2 text-xs font-bold text-emerald-400 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/40 rounded-lg transition-colors flex items-center gap-2 uppercase tracking-wider"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Resume Agent
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={inputMode === 'text' ? !goalInput.trim() : !!jsonError || !jsonInput.trim()}
                  className="px-6 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-[#1a1a1a] disabled:text-zinc-600 disabled:border-[#2a2a2a] disabled:cursor-not-allowed rounded-xl transition-all shadow-[0_0_12px_rgba(59,130,246,0.35)] border border-blue-500 flex items-center gap-2 uppercase tracking-wider"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Execute Autonomous Goal
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Preset Goal Cards */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 px-1">
          Recommended Goal Templates
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {presets.map((preset, index) => (
            <div
              key={index}
              onClick={() => state.status !== 'running' && handleApplyPreset(preset)}
              className={`p-4 rounded-xl border border-[#222] bg-[#0c0c0c] hover:border-blue-500/50 hover:bg-[#111] hover:shadow-[0_0_12px_rgba(59,130,246,0.15)] transition-all cursor-pointer flex flex-col justify-between group ${
                state.status === 'running' ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-blue-950/60 text-blue-400 border border-blue-500/40">
                    {preset.badge}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
                </div>
                <h4 className="text-xs font-bold text-zinc-200 group-hover:text-white">
                  {preset.title}
                </h4>
                <p className="text-xs font-sans text-zinc-500 line-clamp-2 leading-relaxed">
                  {preset.desc}
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-[#1e1e1e] flex items-center text-[11px] font-medium text-blue-400 group-hover:text-blue-300">
                <span>Run with Agent &rarr;</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Autonomous Loop Visual Architecture */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-200">
              Autonomous Loop Lifecycle
            </h3>
          </div>
          <span className="text-[11px] font-mono text-zinc-500">
            Iterative &middot; Self-Healing &middot; Non-Hardcoded
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5">
          {loopPhases.map((phase, idx) => {
            return (
              <div
                key={phase}
                className="px-2 py-2 rounded-lg bg-[#080808] border border-[#1e1e1e] text-center flex flex-col items-center justify-center gap-1 hover:border-[#333] transition-colors"
              >
                <span className="text-[9px] font-mono text-zinc-600">0{idx + 1}</span>
                <span className="text-[10px] font-bold text-zinc-300 whitespace-nowrap">
                  {phase}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Agent Execution Status & Strategy Card */}
      {state.goal && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main State Card */}
          <div className="lg:col-span-2 bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Current Autonomous Session</h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowJsonExportModal(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-mono uppercase"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  <span>JSON Stream</span>
                </button>
                <span className="text-xs font-mono text-zinc-500">
                  Iteration <span className="text-blue-400 font-bold">{state.iterationCount}</span> / {state.maxIterations}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#080808] border border-[#1e1e1e]">
              <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-blue-400 block mb-1">
                Active Goal
              </span>
              <p className="text-xs font-medium text-zinc-200 leading-relaxed font-mono">
                {state.goal}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-[#080808] border border-[#1e1e1e]">
                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-500 block mb-1">
                  Current Strategy (Attempt #{state.strategyAttemptCount})
                </span>
                <p className="text-xs font-semibold text-zinc-200">
                  {state.currentStrategy || 'Synthesizing strategy...'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#080808] border border-[#1e1e1e]">
                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-500 block mb-1">
                  Verification Status
                </span>
                <div className="flex items-center gap-2">
                  {state.validationStatus.isVerified ? (
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Passed Strict Verification
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-zinc-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-zinc-500" /> Pending Final Verification
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Stuck Diagnosis Warning */}
            {state.stuckDiagnosis?.isStuck && (
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 space-y-1">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">Loop Detector Alert: Stuck Condition Diagnosed</h4>
                </div>
                <p className="text-xs text-amber-200">{state.stuckDiagnosis.reason}</p>
                {state.stuckDiagnosis.suggestedAction && (
                  <p className="text-xs font-semibold text-amber-300 pt-1">
                    Pivot Strategy: {state.stuckDiagnosis.suggestedAction}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Quick Metrics & Artifacts Hub Preview */}
          <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Session Artifacts</h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#161616] border border-[#333] text-blue-400">
                  {state.artifacts.length} ready
                </span>
              </div>

              {state.artifacts.length === 0 ? (
                <div className="text-center py-6 text-zinc-500 text-xs">
                  <Layers className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
                  Artifacts will appear here once synthesized and verified.
                </div>
              ) : (
                <div className="space-y-2">
                  {state.artifacts.map((art, idx) => (
                    <div
                      key={idx}
                      onClick={() => onSelectTab('artifacts')}
                      className="p-3 rounded-xl bg-[#080808] border border-[#1e1e1e] hover:border-blue-500/50 hover:bg-[#111] cursor-pointer transition-all flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
                        <div className="truncate">
                          <p className="text-xs font-bold text-zinc-200 group-hover:text-white truncate">{art.filename}</p>
                          <span className="text-[10px] text-emerald-400 font-medium">Verified {art.type}</span>
                        </div>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400 shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[#1e1e1e] flex items-center justify-between text-xs">
              <span className="text-zinc-500 uppercase tracking-wider">Actions Taken:</span>
              <span className="font-mono font-bold text-blue-400">{state.completedActions.length}</span>
            </div>
          </div>
        </div>
      )}

      {/* JSON Export Modal */}
      {showJsonExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0c0c0c] rounded-2xl border border-[#333] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#222] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileJson className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white uppercase tracking-wider">
                  JSON Output & State Inspector
                </h3>
              </div>
              <button
                onClick={() => setShowJsonExportModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-[#1a1a1a]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Type Switcher */}
              <div className="flex items-center gap-2 bg-[#111] p-1 rounded-xl border border-[#222]">
                <button
                  onClick={() => setExportType('full_state')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    exportType === 'full_state'
                      ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.35)]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Full Execution State
                </button>
                <button
                  onClick={() => setExportType('artifacts_only')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    exportType === 'artifacts_only'
                      ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.35)]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Verified Artifacts
                </button>
                <button
                  onClick={() => setExportType('goal_spec')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    exportType === 'goal_spec'
                      ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.35)]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Goal & Plan Spec
                </button>
              </div>

              {/* JSON Display */}
              <div className="relative">
                <pre className="p-4 bg-[#050505] border border-[#222] rounded-xl text-xs text-zinc-200 overflow-x-auto max-h-[380px] font-mono leading-relaxed">
                  {JSON.stringify(getExportData(), null, 2)}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#222] bg-[#080808] flex items-center justify-between">
              <span className="text-xs text-zinc-500 font-sans">
                Valid UTF-8 formatted JSON output ready for deployment or external pipelines.
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyJson}
                  className="px-4 py-2 text-xs font-bold text-zinc-200 bg-[#161616] hover:bg-[#222] border border-[#333] rounded-xl transition-all flex items-center gap-1.5 uppercase tracking-wider"
                >
                  {copiedExport ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedExport ? 'Copied' : 'Copy JSON'}</span>
                </button>

                <button
                  onClick={handleDownloadJson}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all flex items-center gap-1.5 uppercase tracking-wider shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .json</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
