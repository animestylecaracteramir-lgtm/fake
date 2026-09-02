import React, { useState, useEffect } from 'react';
import { 
  Wrench, 
  Plus, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Code2, 
  Layers, 
  Search, 
  Tag, 
  Terminal,
  FileCode,
  Sparkles,
  Info
} from 'lucide-react';
import { ToolMetadata, ToolResult } from '../types';

export const ToolRegistryView: React.FC = () => {
  const [tools, setTools] = useState<ToolMetadata[]>([]);
  const [selectedTool, setSelectedTool] = useState<ToolMetadata | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Tool Tester State
  const [testArgsJson, setTestArgsJson] = useState<string>('{}');
  const [testResult, setTestResult] = useState<ToolResult | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);

  // New Tool Form State
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newToolName, setNewToolName] = useState<string>('');
  const [newToolDesc, setNewToolDesc] = useState<string>('');
  const [newToolParams, setNewToolParams] = useState<string>(
    JSON.stringify({ type: 'object', properties: { input_val: { type: 'string' } }, required: ['input_val'] }, null, 2)
  );
  const [newToolCode, setNewToolCode] = useState<string>(`def calculate(input_val):\n    return f"Processed: {input_val}"\n`);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const fetchTools = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tools');
      const data = await res.json();
      setTools(data.tools || []);
      if (data.tools?.length > 0 && !selectedTool) {
        setSelectedTool(data.tools[0]);
      }
    } catch (err) {
      console.error('Failed to load tools:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  useEffect(() => {
    if (selectedTool) {
      // Build sample arguments from parameters
      const sample: Record<string, any> = {};
      const props = selectedTool.parameters?.properties || {};
      for (const [key, propDef] of Object.entries(props)) {
        const def = propDef as any;
        if (def.type === 'string') sample[key] = 'sample_value';
        else if (def.type === 'number') sample[key] = 443;
        else if (def.type === 'boolean') sample[key] = true;
        else if (def.type === 'array') sample[key] = ['item1'];
        else sample[key] = {};
      }
      setTestArgsJson(JSON.stringify(sample, null, 2));
      setTestResult(null);
    }
  }, [selectedTool]);

  const handleRunToolTest = async () => {
    if (!selectedTool) return;
    try {
      setIsTesting(true);
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(testArgsJson);
      } catch (e: any) {
        setTestResult({
          success: false,
          data: null,
          error: { type: 'JSON_SYNTAX_ERROR', message: `Invalid test JSON: ${e.message}` },
        });
        setIsTesting(false);
        return;
      }

      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedTool.name,
          args: parsedArgs,
        }),
      });

      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        data: null,
        error: { type: 'NETWORK_ERROR', message: err.message },
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCreateTool = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(newToolParams);
      } catch {
        setCreateMsg('Invalid JSON schema in parameters.');
        return;
      }

      const res = await fetch('/api/tools/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newToolName.trim(),
          description: newToolDesc.trim(),
          parameters: parsedParams,
          code: newToolCode,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCreateMsg(`Tool '${newToolName}' created and registered!`);
        setIsCreating(false);
        fetchTools();
      } else {
        setCreateMsg(`Error: ${data.error?.message || 'Creation failed'}`);
      }
    } catch (err: any) {
      setCreateMsg(`Error: ${err.message}`);
    }
  };

  const categories = ['all', 'web', 'python', 'environment', 'file', 'agent', 'memory', 'validation', 'v2ray', 'custom'];

  const filteredTools = tools.filter(t => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-mono">
      {/* Top Bar */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              Tools & Self-Extending Engine
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              {tools.length} active tools &middot; Autonomous execution & live sandboxed testing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-[#080808] border border-[#262626] text-zinc-200 placeholder:text-zinc-600 rounded-lg focus:outline-none focus:border-blue-500 w-44 sm:w-56 font-mono"
            />
          </div>

          <button
            onClick={() => setIsCreating(!isCreating)}
            className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all flex items-center gap-1.5 shadow-[0_0_10px_rgba(59,130,246,0.3)] uppercase tracking-wider"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Custom Tool</span>
          </button>
        </div>
      </div>

      {/* Categories Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-bold uppercase tracking-wider whitespace-nowrap transition-all border ${
              categoryFilter === cat
                ? 'bg-blue-600 text-white border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.35)]'
                : 'bg-[#0c0c0c] text-zinc-400 hover:text-white hover:bg-[#141414] border-[#222]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Create Custom Tool Modal / Collapsible Section */}
      {isCreating && (
        <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-blue-500/40 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-[#222] pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Synthesize New Custom Tool</h3>
            </div>
            <button
              onClick={() => setIsCreating(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300 uppercase tracking-wider"
            >
              Cancel
            </button>
          </div>

          {createMsg && (
            <div className="p-3 text-xs rounded-lg bg-[#080808] border border-[#333] text-zinc-300 font-mono">
              {createMsg}
            </div>
          )}

          <form onSubmit={handleCreateTool} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Tool Identifier</label>
                <input
                  type="text"
                  placeholder="e.g. calculate_entropy, parse_rfc_data"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-[#080808] border border-[#262626] text-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Description</label>
                <input
                  type="text"
                  placeholder="What the tool accomplishes"
                  value={newToolDesc}
                  onChange={(e) => setNewToolDesc(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-[#080808] border border-[#262626] text-zinc-200 rounded-lg focus:outline-none focus:border-blue-500 font-sans"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Parameters (JSON Schema)</label>
                <textarea
                  rows={6}
                  value={newToolParams}
                  onChange={(e) => setNewToolParams(e.target.value)}
                  className="w-full p-3 text-xs bg-[#050505] text-zinc-200 border border-[#222] font-mono rounded-lg focus:outline-none focus:border-blue-500 leading-snug"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Python Implementation Code</label>
                <textarea
                  rows={6}
                  value={newToolCode}
                  onChange={(e) => setNewToolCode(e.target.value)}
                  className="w-full p-3 text-xs bg-[#050505] text-emerald-400 border border-[#222] font-mono rounded-lg focus:outline-none focus:border-blue-500 leading-snug"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors uppercase tracking-wider shadow-[0_0_10px_rgba(59,130,246,0.3)]"
              >
                Register & Test Tool
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Grid: Tool List + Tool Inspector & Tester */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Tool Cards */}
        <div className="lg:col-span-5 space-y-2.5">
          {filteredTools.map((tool) => {
            const isSelected = selectedTool?.name === tool.name;
            return (
              <div
                key={tool.name}
                onClick={() => setSelectedTool(tool)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-blue-500 bg-[#111] text-white shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                    : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold truncate">{tool.name}</span>
                    {tool.is_custom && (
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                        isSelected ? 'bg-purple-950/80 text-purple-300 border border-purple-500/40' : 'bg-[#1a1020] text-purple-400 border border-purple-900/50'
                      }`}>
                        CUSTOM
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize ${
                    isSelected ? 'bg-blue-950/80 text-blue-300 border border-blue-500/40' : 'bg-[#161616] text-zinc-400 border border-[#2a2a2a]'
                  }`}>
                    {tool.category}
                  </span>
                </div>
                <p className={`text-xs font-sans line-clamp-2 ${isSelected ? 'text-zinc-300' : 'text-zinc-500'}`}>
                  {tool.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Right Column: Selected Tool Detail & Live Tester */}
        <div className="lg:col-span-7">
          {selectedTool ? (
            <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-6">
              {/* Tool Header */}
              <div className="flex items-start justify-between border-b border-[#222] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white font-mono">
                      {selectedTool.name}
                    </h3>
                    <span className="text-xs font-mono text-zinc-500">v{selectedTool.version}</span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed font-sans">
                    {selectedTool.description}
                  </p>
                </div>
                <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-[#161616] border border-[#333] text-blue-400 font-medium capitalize">
                  {selectedTool.category}
                </span>
              </div>

              {/* Parameters Schema Box */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                  Parameters Schema
                </h4>
                <pre className="bg-[#050505] text-zinc-200 border border-[#222] p-3.5 rounded-xl text-xs font-mono overflow-x-auto leading-snug">
                  {JSON.stringify(selectedTool.parameters, null, 2)}
                </pre>
              </div>

              {/* Code Viewer (if custom tool) */}
              {selectedTool.code && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Implementation Source
                  </h4>
                  <pre className="bg-[#050505] text-emerald-400 border border-[#222] p-3.5 rounded-xl text-xs font-mono overflow-x-auto leading-snug">
                    {selectedTool.code}
                  </pre>
                </div>
              )}

              {/* Interactive In-UI Tool Tester */}
              <div className="pt-2 border-t border-[#222] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-blue-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                      Live In-Browser Tool Tester
                    </h4>
                  </div>
                  <button
                    onClick={handleRunToolTest}
                    disabled={isTesting}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-[#1a1a1a] disabled:text-zinc-600 rounded-lg transition-colors flex items-center gap-1.5 shadow-[0_0_10px_rgba(59,130,246,0.3)] uppercase tracking-wider"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{isTesting ? 'Running...' : 'Execute Test'}</span>
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    Input Arguments (JSON)
                  </label>
                  <textarea
                    rows={4}
                    value={testArgsJson}
                    onChange={(e) => setTestArgsJson(e.target.value)}
                    className="w-full p-3 text-xs bg-[#050505] border border-[#262626] rounded-xl font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {testResult && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Execution Result</span>
                      {testResult.success ? (
                        <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASSED ({testResult.metadata?.duration_ms || 0}ms)
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-bold text-rose-400 flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> FAILED
                        </span>
                      )}
                    </div>
                    <pre className={`p-3 rounded-xl text-xs font-mono overflow-x-auto leading-snug border ${
                      testResult.success ? 'bg-[#050505] text-zinc-200 border-[#222]' : 'bg-rose-950/60 text-rose-200 border-rose-900/50'
                    }`}>
                      {JSON.stringify(testResult.data || testResult.error, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 text-xs shadow-xl">
              Select a tool to inspect parameters and run tests.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
