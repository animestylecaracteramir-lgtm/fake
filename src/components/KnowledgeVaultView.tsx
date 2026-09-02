import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Search, 
  BookOpen, 
  AlertTriangle, 
  Compass, 
  CheckCircle2, 
  Layers, 
  Clock, 
  Tag, 
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  Award,
  Zap
} from 'lucide-react';
import { ExperienceRecord, NegativeKnowledge, StrategyDefinition, EvaluationReport } from '../types';

export const KnowledgeVaultView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'experiences' | 'negative' | 'strategies' | 'evaluations' | 'raw'>('experiences');
  const [experiences, setExperiences] = useState<ExperienceRecord[]>([]);
  const [negativeKnowledge, setNegativeKnowledge] = useState<NegativeKnowledge[]>([]);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationReport[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [diagRes, expRes, stratRes, evalRes] = await Promise.all([
        fetch('/api/knowledge/diagnostics').then(r => r.json()).catch(() => null),
        fetch('/api/knowledge/experiences').then(r => r.json()).catch(() => ({ experiences: [] })),
        fetch('/api/knowledge/strategies').then(r => r.json()).catch(() => ({ strategies: [] })),
        fetch('/api/knowledge/evaluations').then(r => r.json()).catch(() => ({ evaluations: [] })),
      ]);

      if (diagRes) setDiagnostics(diagRes);
      if (expRes?.experiences) setExperiences(expRes.experiences);
      if (stratRes?.strategies) setStrategies(stratRes.strategies);
      if (evalRes?.evaluations) setEvaluations(evalRes.evaluations);

      // Extract negative knowledge from memory API
      const memRes = await fetch('/api/memory').then(r => r.json()).catch(() => ({ documents: [] }));
      const negDocs: NegativeKnowledge[] = [];
      memRes.documents?.forEach((d: any) => {
        if (d.file?.includes('negative_knowledge') && d.data) {
          negDocs.push(d.data);
        }
      });
      setNegativeKnowledge(negDocs);
    } catch (err) {
      console.error('Failed to load memory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getPromotionBadge = (level?: string) => {
    switch (level) {
      case 'trusted':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 uppercase tracking-wider flex items-center gap-1"><Award className="w-3 h-3" /> Trusted</span>;
      case 'confirmed':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-950 text-blue-300 border border-blue-500/40 uppercase tracking-wider flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Confirmed</span>;
      case 'repeated':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-purple-950 text-purple-300 border border-purple-500/40 uppercase tracking-wider flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Repeated</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-zinc-900 text-zinc-400 border border-zinc-700 uppercase tracking-wider">Observed</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-mono">
      {/* Top Header & Diagnostics Metric Strip */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              Persistent Knowledge & Self-Evolving Memory
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              Dynamic repository of reinforced experiences, failure avoidance rules, ranked strategies, and evaluation proofs.
            </p>
          </div>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] text-zinc-400 hover:text-white border border-[#222] transition-colors flex items-center gap-2 text-xs"
          title="Refresh Knowledge"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          <span>Sync Memory</span>
        </button>
      </div>

      {/* Diagnostics Cards */}
      {diagnostics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#0c0c0c] border border-[#222]">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Total Experiences</span>
            <div className="text-xl font-bold text-white flex items-baseline gap-2">
              {diagnostics.totalExperiences || experiences.length}
              <span className="text-[10px] text-emerald-400 font-normal">Reinforced</span>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[#0c0c0c] border border-[#222]">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Trusted Patterns</span>
            <div className="text-xl font-bold text-emerald-400 flex items-baseline gap-2">
              {diagnostics.trustedCount || 0}
              <span className="text-[10px] text-zinc-500 font-normal">Score ≥85%</span>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[#0c0c0c] border border-[#222]">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Failure Records</span>
            <div className="text-xl font-bold text-amber-400 flex items-baseline gap-2">
              {diagnostics.negativeKnowledgeCount || negativeKnowledge.length}
              <span className="text-[10px] text-zinc-500 font-normal">Avoided</span>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[#0c0c0c] border border-[#222]">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Strategies Catalog</span>
            <div className="text-xl font-bold text-blue-400 flex items-baseline gap-2">
              {diagnostics.activeStrategiesCount || strategies.length}
              <span className="text-[10px] text-zinc-500 font-normal">Ranked</span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#222] pb-2 overflow-x-auto">
        <button
          onClick={() => { setActiveTab('experiences'); setSelectedItem(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'experiences'
              ? 'bg-[#1a1a1a] text-white border border-[#333]'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 text-blue-400" />
          <span>Experience Ledger ({experiences.length})</span>
        </button>

        <button
          onClick={() => { setActiveTab('negative'); setSelectedItem(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'negative'
              ? 'bg-[#1a1a1a] text-white border border-[#333]'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span>Negative Knowledge ({negativeKnowledge.length})</span>
        </button>

        <button
          onClick={() => { setActiveTab('strategies'); setSelectedItem(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'strategies'
              ? 'bg-[#1a1a1a] text-white border border-[#333]'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-purple-400" />
          <span>Ranked Strategies ({strategies.length})</span>
        </button>

        <button
          onClick={() => { setActiveTab('evaluations'); setSelectedItem(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'evaluations'
              ? 'bg-[#1a1a1a] text-white border border-[#333]'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Autonomous Evaluations ({evaluations.length})</span>
        </button>
      </div>

      {/* Main Tab Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: List */}
        <div className="lg:col-span-5 space-y-3">
          {activeTab === 'experiences' && (
            experiences.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#0c0c0c] border border-[#222] text-center text-zinc-500 text-xs">
                No experiences stored yet. Execute tasks to build persistent memory.
              </div>
            ) : (
              experiences.map((exp) => {
                const isSelected = selectedItem?.id === exp.id;
                return (
                  <div
                    key={exp.id}
                    onClick={() => setSelectedItem(exp)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-blue-500 bg-[#111] text-white shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                        : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold truncate max-w-[200px]">{exp.taskType}</span>
                      {getPromotionBadge(exp.promotionLevel)}
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 mb-2 font-sans">{exp.lesson || exp.goal}</p>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span>Occurrences: {exp.occurrences}</span>
                      <span className="text-emerald-400 font-bold">Score: {(exp.evaluationScore * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })
            )
          )}

          {activeTab === 'negative' && (
            negativeKnowledge.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#0c0c0c] border border-[#222] text-center text-zinc-500 text-xs">
                No failure patterns registered yet.
              </div>
            ) : (
              negativeKnowledge.map((neg) => {
                const isSelected = selectedItem?.id === neg.id;
                return (
                  <div
                    key={neg.id}
                    onClick={() => setSelectedItem(neg)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-amber-500 bg-[#111] text-white shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                        : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-amber-400">{neg.strategyOrTool}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40">
                        {neg.failureType}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 mb-2 font-sans">{neg.reason}</p>
                    <div className="text-[10px] text-zinc-500">
                      Avoided {neg.observedCount} time(s)
                    </div>
                  </div>
                );
              })
            )
          )}

          {activeTab === 'strategies' && (
            strategies.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#0c0c0c] border border-[#222] text-center text-zinc-500 text-xs">
                No strategies configured.
              </div>
            ) : (
              strategies.map((strat) => {
                const isSelected = selectedItem?.id === strat.id;
                return (
                  <div
                    key={strat.id}
                    onClick={() => setSelectedItem(strat)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-purple-500 bg-[#111] text-white shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                        : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-purple-300">{strat.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-500/40 capitalize">
                        {strat.status}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 mb-2 font-sans">{strat.description}</p>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span>Win Rate: {strat.successCount}/{strat.successCount + strat.failureCount}</span>
                      <span className="text-purple-400 font-bold">Score: {(strat.avgEvaluationScore * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })
            )
          )}

          {activeTab === 'evaluations' && (
            evaluations.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#0c0c0c] border border-[#222] text-center text-zinc-500 text-xs">
                No evaluation proofs registered yet.
              </div>
            ) : (
              evaluations.map((ev) => {
                const isSelected = selectedItem?.id === ev.id;
                return (
                  <div
                    key={ev.id}
                    onClick={() => setSelectedItem(ev)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-emerald-500 bg-[#111] text-white shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                        : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold">{ev.targetId}</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                        ev.passed ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-red-950 text-red-300 border border-red-500/40'
                      }`}>
                        {ev.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 mb-2 font-sans">{ev.summary}</p>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span>Target: {ev.targetType}</span>
                      <span className="text-emerald-400 font-bold">Score: {(ev.overallScore * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>

        {/* Right Column: Detail Inspector */}
        <div className="lg:col-span-7">
          {selectedItem ? (
            <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-5">
              <div className="border-b border-[#222] pb-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                    {selectedItem.id || 'Record Details'}
                  </span>
                  <h3 className="text-base font-bold text-white font-mono">
                    {selectedItem.taskType || selectedItem.name || selectedItem.strategyOrTool || selectedItem.targetId}
                  </h3>
                </div>
                {selectedItem.promotionLevel && getPromotionBadge(selectedItem.promotionLevel)}
              </div>

              {/* JSON preview */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                  Verified Structured Record
                </h4>
                <pre className="p-4 rounded-xl bg-[#080808] border border-[#222] text-zinc-300 text-xs font-mono overflow-x-auto max-h-[420px] leading-relaxed">
                  {JSON.stringify(selectedItem, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 space-y-3">
              <Layers className="w-10 h-10 mx-auto text-zinc-700" />
              <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Select a Record to Inspect</h3>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto font-sans">
                Inspect proven execution evidence, multi-layer evaluation scores, and failure avoidance patterns.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
