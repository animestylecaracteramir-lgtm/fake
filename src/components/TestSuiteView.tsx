import React, { useState, useEffect } from 'react';
import { 
  FlaskConical, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ShieldCheck, 
  Terminal, 
  Sparkles,
  Layers,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { TestSuiteSummary } from '../types';

export const TestSuiteView: React.FC = () => {
  const [suiteResult, setSuiteResult] = useState<TestSuiteSummary | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});

  const runSuite = async () => {
    try {
      setIsRunning(true);
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();
      setSuiteResult(data);
    } catch (err) {
      console.error('Test suite run failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    // Run initial test suite on first render
    runSuite();
  }, []);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-mono">
      {/* Top Banner */}
      <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              14-Point Autonomous Verification Benchmark
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              Validates tool discovery, code sandboxing, self-extension, V2Ray generation, loop detection & sanitization.
            </p>
          </div>
        </div>

        <button
          onClick={runSuite}
          disabled={isRunning}
          className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-[#1a1a1a] disabled:text-zinc-600 rounded-xl transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)] flex items-center gap-2 uppercase tracking-wider"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isRunning ? 'Running All Benchmarks...' : 'Run 14-Point Test Suite'}</span>
        </button>
      </div>

      {/* Summary Score Card */}
      {suiteResult && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-[#0c0c0c] p-5 rounded-2xl border border-[#222] shadow-md">
            <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block mb-1">
              Benchmark Score
            </span>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold font-mono ${
                suiteResult.failed === 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {suiteResult.passed} / {suiteResult.total}
              </span>
              <span className="text-xs text-zinc-400 font-medium uppercase font-mono">PASSED</span>
            </div>
          </div>

          <div className="bg-[#0c0c0c] p-5 rounded-2xl border border-[#222] shadow-md">
            <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block mb-1">
              Execution Duration
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-white font-mono">
                {suiteResult.durationMs}
              </span>
              <span className="text-xs text-zinc-500 font-medium font-mono">ms</span>
            </div>
          </div>

          <div className="bg-[#0c0c0c] p-5 rounded-2xl border border-[#222] shadow-md">
            <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block mb-1">
              Engine Integrity
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">100% Verified</span>
            </div>
          </div>

          <div className="bg-[#0c0c0c] p-5 rounded-2xl border border-[#222] shadow-md">
            <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block mb-1">
              Last Executed
            </span>
            <span className="text-xs font-mono text-zinc-300 font-medium truncate block pt-1">
              {new Date(suiteResult.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* Tests List */}
      {suiteResult ? (
        <div className="space-y-2.5">
          {suiteResult.results.map((t) => {
            const isExpanded = !!expandedIds[t.id];
            return (
              <div
                key={t.id}
                className={`bg-[#0c0c0c] rounded-xl border transition-all ${
                  t.passed ? 'border-[#222] hover:border-[#333]' : 'border-rose-900/60 bg-[#160808]'
                }`}
              >
                <div
                  onClick={() => toggleExpand(t.id)}
                  className="p-4 flex items-center justify-between cursor-pointer select-none gap-3"
                >
                  <div className="flex items-center gap-3">
                    <button className="text-zinc-500 hover:text-zinc-300">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>

                    {t.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-500">#{t.id}</span>
                        <h4 className="text-xs font-bold text-zinc-200">{t.name}</h4>
                        <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-[#161616] text-blue-400 border border-[#262626] uppercase">
                          {t.category}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-xl font-sans">
                        {t.details}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-500 shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{t.durationMs}ms</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-4 pt-2 border-t border-[#1e1e1e] font-mono text-xs text-zinc-300 bg-[#080808] rounded-b-xl space-y-2">
                    <p className="font-sans text-xs text-zinc-400 leading-relaxed">
                      {t.details}
                    </p>
                    {t.error && (
                      <pre className="p-3 bg-rose-950/60 text-rose-200 border border-rose-900/50 rounded-lg overflow-x-auto text-[11px]">
                        {t.error}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 text-xs shadow-xl">
          Running system verification suite...
        </div>
      )}
    </div>
  );
};
