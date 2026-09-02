import React, { useState } from 'react';
import { 
  Activity, 
  ChevronDown, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Terminal, 
  AlertTriangle, 
  Search, 
  Filter,
  Layers,
  Sparkles
} from 'lucide-react';
import { AgentAction } from '../types';

interface ActivityFeedProps {
  actions: AgentAction[];
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ actions }) => {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredActions = actions.filter(action => {
    if (filterType !== 'all') {
      if (filterType === 'tools' && action.type !== 'tool_call') return false;
      if (filterType === 'errors' && action.status !== 'failed') return false;
      if (filterType === 'reasoning' && action.type !== 'reasoning') return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTool = action.tool?.toLowerCase().includes(q);
      const matchMsg = action.message?.toLowerCase().includes(q);
      const matchArgs = JSON.stringify(action.arguments || {}).toLowerCase().includes(q);
      const matchRes = JSON.stringify(action.result || {}).toLowerCase().includes(q);
      return matchTool || matchMsg || matchArgs || matchRes;
    }
    return true;
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto font-mono">
      {/* Header & Controls */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              Live Observability & Execution Stream
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              Real-time audit log of tool calls, inputs, outputs, errors, reasoning, and repairs.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search traces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-[#080808] border border-[#262626] text-zinc-200 placeholder:text-zinc-600 rounded-lg focus:outline-none focus:border-blue-500 w-44 sm:w-56 font-mono"
            />
          </div>

          <div className="flex items-center gap-1 bg-[#111] p-1 rounded-lg border border-[#222] text-xs">
            {['all', 'tools', 'reasoning', 'errors'].map((f) => (
              <button
                key={f}
                onClick={() => setFilterType(f)}
                className={`px-2.5 py-1 rounded-md capitalize font-mono text-[11px] font-bold tracking-wider transition-all ${
                  filterType === f
                    ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]'
                    : 'text-zinc-400 hover:text-white hover:bg-[#1a1a1a]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actions Timeline */}
      {filteredActions.length === 0 ? (
        <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 space-y-3 shadow-xl">
          <Layers className="w-10 h-10 mx-auto text-zinc-700" />
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">No Execution Events Yet</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto font-sans leading-relaxed">
            When you launch an autonomous goal, every thought, tool invocation, input payload, stdout, and error correction will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredActions.map((action, idx) => {
            const isExpanded = !expandedIds[action.id];
            const isTool = action.type === 'tool_call';
            const isReasoning = action.type === 'reasoning';
            const isSuccess = action.status === 'success';
            const isFailed = action.status === 'failed';

            return (
              <div
                key={action.id || idx}
                className={`bg-[#0c0c0c] rounded-xl border transition-all shadow-md ${
                  isFailed
                    ? 'border-rose-900/50 bg-[#160808]'
                    : isSuccess
                    ? 'border-[#222] hover:border-[#333]'
                    : 'border-[#222]'
                }`}
              >
                {/* Header Row */}
                <div
                  onClick={() => toggleExpand(action.id)}
                  className="p-3.5 flex items-center justify-between cursor-pointer select-none gap-3"
                >
                  <div className="flex items-center gap-3 truncate">
                    <button className="text-zinc-500 hover:text-zinc-300">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    {isReasoning ? (
                      <div className="flex items-center gap-2 truncate">
                        <span className="p-1 rounded bg-purple-950/60 text-purple-400 border border-purple-500/40">
                          <Sparkles className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-xs font-bold text-purple-300 tracking-wider">Agent Reasoning</span>
                      </div>
                    ) : isTool ? (
                      <div className="flex items-center gap-2 truncate">
                        <span className="p-1 rounded bg-blue-950/60 text-blue-400 border border-blue-500/40">
                          <Terminal className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-xs font-mono font-bold text-zinc-100 truncate">
                          {action.tool}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-zinc-200">{action.type}</span>
                    )}

                    {action.message && (
                      <span className="text-xs text-zinc-500 truncate hidden md:inline font-mono">
                        {action.message}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {action.duration_ms !== undefined && (
                      <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {action.duration_ms}ms
                      </span>
                    )}

                    {isSuccess && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/40">
                        <CheckCircle2 className="w-3 h-3" /> SUCCESS
                      </span>
                    )}

                    {isFailed && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/60 text-rose-400 border border-rose-500/40">
                        <XCircle className="w-3 h-3" /> FAILED
                      </span>
                    )}

                    {action.status === 'running' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/60 text-amber-400 border border-amber-500/40 animate-pulse">
                        EXECUTING...
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-[#1e1e1e] space-y-3 font-mono text-xs bg-[#080808] rounded-b-xl">
                    {/* If Reasoning message */}
                    {action.message && (
                      <div className="bg-[#050505] p-3.5 rounded-lg border border-[#1e1e1e] text-zinc-300 font-sans whitespace-pre-wrap leading-relaxed text-xs">
                        {action.message}
                      </div>
                    )}

                    {/* Tool Arguments */}
                    {action.arguments && Object.keys(action.arguments).length > 0 && (
                      <div>
                        <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block mb-1">
                          Arguments Payload
                        </span>
                        <pre className="bg-[#050505] text-zinc-200 border border-[#222] p-3 rounded-lg overflow-x-auto text-[11px] leading-snug">
                          {JSON.stringify(action.arguments, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Tool Result Data */}
                    {action.result && (
                      <div>
                        <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block mb-1">
                          Execution Output / Result
                        </span>
                        <pre className={`p-3 rounded-lg overflow-x-auto text-[11px] leading-snug border ${
                          action.result.success
                            ? 'bg-[#050505] text-zinc-200 border-[#222]'
                            : 'bg-rose-950/60 text-rose-200 border-rose-900/50'
                        }`}>
                          {JSON.stringify(action.result.data || action.result.error, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
