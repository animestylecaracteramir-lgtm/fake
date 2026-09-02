import React from 'react';
import { 
  Bot, 
  Activity, 
  Wrench, 
  Database, 
  FolderArchive, 
  FlaskConical, 
  FolderTree, 
  Settings as SettingsIcon,
  Play, 
  Pause, 
  Square, 
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Radio
} from 'lucide-react';
import { AgentState } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  state: AgentState;
  isConnected: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onClear: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  state,
  isConnected,
  onPause,
  onResume,
  onStop,
  onClear,
}) => {
  const getStatusBadge = () => {
    switch (state.status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-bold bg-blue-950/60 text-blue-400 border border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]">
            <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6] animate-pulse"></span>
            KERNEL_ACTIVE // EXECUTING
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-amber-950/60 text-amber-400 border border-amber-500/40">
            <Pause className="w-3 h-3 text-amber-400" />
            SYS_PAUSED
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-500/40">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            GOAL_VERIFIED // COMPLETE
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-rose-950/60 text-rose-400 border border-rose-500/40">
            <AlertTriangle className="w-3 h-3 text-rose-400" />
            EXECUTION_FAILED
          </span>
        );
      case 'stopped':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-[#161616] text-zinc-400 border border-[#333]">
            <Square className="w-3 h-3 text-zinc-400" />
            HALTED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-[#111] text-zinc-400 border border-[#222]">
            <span className="w-2 h-2 rounded-full bg-blue-500/70"></span>
            SYS_READY // IDLE
          </span>
        );
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Agent Command', icon: Bot },
    { id: 'activity', label: 'Live Stream', icon: Activity, count: state.completedActions.length },
    { id: 'tools', label: 'Tool Registry', icon: Wrench },
    { id: 'artifacts', label: 'Outputs & Configs', icon: FolderArchive, count: state.artifacts.length },
    { id: 'memory', label: 'Knowledge Vault', icon: Database },
    { id: 'tests', label: 'Verification Suite', icon: FlaskConical },
    { id: 'files', label: 'Workspace Files', icon: FolderTree },
    { id: 'settings', label: 'LLM & Runtime', icon: SettingsIcon },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0c0c0c]/95 backdrop-blur border-b border-[#222] text-[#e0e0e0] shadow-2xl font-mono">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#111] border border-[#333] flex items-center justify-center text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white tracking-widest text-sm sm:text-base">
                  AUTONOMOUS AGENT
                </span>
                <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-blue-950/60 text-blue-400 border border-blue-500/40">
                  V2.8 // KERNEL
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 hidden sm:block">
                Goal-Oriented Autonomous Loop &middot; Free-First Architecture
              </p>
            </div>
          </div>

          {/* Center Agent Status & Telemetry */}
          <div className="hidden md:flex items-center gap-3">
            {getStatusBadge()}

            {state.status === 'running' && (
              <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 bg-[#111] px-3 py-1 rounded-md border border-[#262626]">
                <span className="text-blue-400 font-bold">Iter {state.iterationCount}/{state.maxIterations}</span>
                <span className="text-zinc-600">|</span>
                <span className="truncate max-w-[160px] text-zinc-300">{state.currentStrategy}</span>
              </div>
            )}
          </div>

          {/* Quick Controls & Connection Indicator */}
          <div className="flex items-center gap-2">
            {state.status === 'running' && (
              <>
                <button
                  onClick={onPause}
                  className="p-2 text-zinc-400 hover:text-white hover:bg-[#1a1a1a] border border-[#333] rounded-lg transition-colors"
                  title="Pause Agent"
                >
                  <Pause className="w-4 h-4" />
                </button>
                <button
                  onClick={onStop}
                  className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 border border-rose-900/50 rounded-lg transition-colors"
                  title="Stop Execution"
                >
                  <Square className="w-4 h-4" />
                </button>
              </>
            )}

            {state.status === 'paused' && (
              <button
                onClick={onResume}
                className="px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/60 hover:bg-emerald-900/80 rounded-lg border border-emerald-500/40 transition-colors flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Resume
              </button>
            )}

            {state.status !== 'idle' && (
              <button
                onClick={onClear}
                className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a] border border-[#222] rounded-lg transition-colors"
                title="Reset State"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}

            <div className="h-4 w-px bg-[#262626] mx-1 hidden sm:block" />

            <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-zinc-600'}`} />
              <span className="hidden lg:inline text-[11px] uppercase tracking-wider">{isConnected ? 'LIVE SSE' : 'OFFLINE'}</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none border-t border-[#222] py-2">
          {navItems.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-medium whitespace-nowrap transition-all border ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.35)]'
                    : 'bg-[#080808] border-[#1e1e1e] text-zinc-400 hover:text-zinc-200 hover:bg-[#141414]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      isActive ? 'bg-blue-800 text-white' : 'bg-[#1a1a1a] text-zinc-300 border border-[#333]'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
