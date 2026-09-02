import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { AgentDashboard } from './components/AgentDashboard';
import { ActivityFeed } from './components/ActivityFeed';
import { ToolRegistryView } from './components/ToolRegistryView';
import { ArtifactsHub } from './components/ArtifactsHub';
import { KnowledgeVaultView } from './components/KnowledgeVaultView';
import { TestSuiteView } from './components/TestSuiteView';
import { FileExplorerView } from './components/FileExplorerView';
import { SettingsView } from './components/SettingsView';
import { AgentState } from './types';

const STORAGE_KEY = 'autonomous_agent_state_persistence_v2';
const TAB_STORAGE_KEY = 'autonomous_agent_active_tab_v2';

const DEFAULT_STATE: AgentState = {
  goal: '',
  status: 'idle',
  currentObjective: '',
  currentPlan: [],
  currentStrategy: 'Initial Strategy Formulation',
  strategyAttemptCount: 1,
  completedActions: [],
  pendingActions: [],
  iterationCount: 0,
  maxIterations: 25,
  toolHistory: [],
  errors: [],
  experiments: [],
  artifacts: [],
  validationStatus: {
    isVerified: false,
  },
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const savedTab = localStorage.getItem(TAB_STORAGE_KEY);
      if (savedTab) return savedTab;
    } catch {}
    return 'dashboard';
  });

  const [isConnected, setIsConnected] = useState<boolean>(false);

  const [state, setState] = useState<AgentState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_STATE,
            ...parsed,
            completedActions: Array.isArray(parsed.completedActions) ? parsed.completedActions : [],
          };
        }
      }
    } catch {}
    return DEFAULT_STATE;
  });

  // Persist activeTab on change
  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {}
  }, [activeTab]);

  // Persist state on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  // Helper to merge action lists deduplicating by ID
  const mergeActions = (existing: any[], incoming: any[]) => {
    const map = new Map<string, any>();
    existing.forEach(a => { if (a && a.id) map.set(a.id, a); });
    incoming.forEach(a => { if (a && a.id) map.set(a.id, { ...map.get(a.id), ...a }); });
    return Array.from(map.values());
  };

  // Setup EventSource for SSE live streaming
  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource('/api/agent/stream');

        eventSource.onopen = () => {
          setIsConnected(true);
        };

        eventSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            handleAgentEvent(data);
          } catch (err) {
            console.error('Error parsing SSE event:', err);
          }
        };

        eventSource.onerror = () => {
          setIsConnected(false);
          eventSource?.close();
          // Retry connection after 3s
          setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        setIsConnected(false);
      }
    };

    connectSSE();

    // Also fetch initial state once to sync with disk
    fetch('/api/agent/state')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setState(prev => {
            const serverActions = Array.isArray(data.completedActions) ? data.completedActions : [];
            const merged = mergeActions(prev.completedActions, serverActions);
            return {
              ...prev,
              ...data,
              completedActions: merged.length > 0 ? merged : prev.completedActions,
            };
          });
        }
      })
      .catch(() => {});

    return () => {
      eventSource?.close();
    };
  }, []);

  const handleAgentEvent = (event: { type: string; payload: any }) => {
    switch (event.type) {
      case 'initial_state':
        setState(prev => {
          const incomingActions = Array.isArray(event.payload?.completedActions) ? event.payload.completedActions : [];
          const merged = mergeActions(prev.completedActions, incomingActions);
          return {
            ...prev,
            ...event.payload,
            completedActions: merged.length > 0 ? merged : prev.completedActions,
          };
        });
        break;

      case 'agent_started':
        setState(prev => ({
          ...prev,
          goal: event.payload.goal,
          status: 'running',
          startTime: event.payload.startTime,
          completedActions: [],
          artifacts: [],
          validationStatus: { isVerified: false },
          iterationCount: 0,
        }));
        break;

      case 'status_change':
        setState(prev => ({ ...prev, status: event.payload.status }));
        break;

      case 'state_reset':
        setState(event.payload);
        break;

      case 'iteration_start':
        setState(prev => ({
          ...prev,
          iterationCount: event.payload.iteration,
          currentStrategy: event.payload.strategy || prev.currentStrategy,
        }));
        break;

      case 'agent_reasoning':
        setState(prev => {
          const newAction = {
            id: `act_${Date.now()}_reason`,
            timestamp: new Date().toISOString(),
            type: 'reasoning' as const,
            message: event.payload.content,
            status: 'info' as const,
          };
          return {
            ...prev,
            completedActions: [...prev.completedActions, newAction],
          };
        });
        break;

      case 'tool_execution_start':
        setState(prev => {
          const actionId = event.payload.actionId;
          const exists = prev.completedActions.some(a => a.id === actionId);
          if (exists) return prev;

          const newAction = {
            id: actionId,
            timestamp: new Date().toISOString(),
            type: 'tool_call' as const,
            tool: event.payload.tool,
            arguments: event.payload.arguments,
            status: 'running' as const,
          };
          return {
            ...prev,
            completedActions: [...prev.completedActions, newAction],
          };
        });
        break;

      case 'tool_execution_end':
        setState(prev => {
          const updated = prev.completedActions.map(a => {
            if (a.id === event.payload.actionId) {
              return {
                ...a,
                status: event.payload.success ? 'success' as const : 'failed' as const,
                result: event.payload.result,
                duration_ms: event.payload.durationMs,
              };
            }
            return a;
          });
          return {
            ...prev,
            completedActions: updated,
          };
        });
        break;

      case 'artifact_created':
        setState(prev => ({
          ...prev,
          artifacts: [...prev.artifacts.filter(a => a.filename !== event.payload.filename), event.payload],
        }));
        break;

      case 'validation_success':
        setState(prev => ({
          ...prev,
          validationStatus: {
            isVerified: true,
            verificationCriteria: `Passed ${event.payload.tool}`,
            verificationOutput: JSON.stringify(event.payload.data),
            timestamp: new Date().toISOString(),
          },
        }));
        break;

      case 'api_retry':
        setState(prev => ({
          ...prev,
          completedActions: [
            ...prev.completedActions,
            {
              id: `act_${Date.now()}_retry_${event.payload.attempt}`,
              timestamp: new Date().toISOString(),
              type: 'repair',
              message: `[API Retry ${event.payload.attempt}/${event.payload.maxAttempts}] ${event.payload.provider} (Retrying in ${event.payload.delayMs}ms): ${event.payload.error}`,
              status: 'info',
            },
          ],
        }));
        break;

      case 'loop_detected':
        setState(prev => ({
          ...prev,
          stuckDiagnosis: {
            isStuck: true,
            reason: event.payload.message,
            suggestedAction: event.payload.recommendedPivot,
          },
        }));
        break;

      case 'goal_completed':
        setState(prev => ({
          ...prev,
          status: 'completed',
          endTime: new Date().toISOString(),
          validationStatus: { isVerified: true },
        }));
        break;

      case 'agent_finished':
        setState(prev => {
          const incomingActions = Array.isArray(event.payload?.completedActions) ? event.payload.completedActions : [];
          const merged = mergeActions(prev.completedActions, incomingActions);
          return {
            ...prev,
            ...event.payload,
            completedActions: merged.length > 0 ? merged : prev.completedActions,
          };
        });
        break;

      default:
        break;
    }
  };

  const handleStartAgent = async (goal: string) => {
    try {
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      if (res.ok) {
        setActiveTab('activity');
      }
    } catch (err) {
      console.error('Failed to start agent:', err);
    }
  };

  const handlePause = async () => {
    await fetch('/api/agent/pause', { method: 'POST' });
  };

  const handleResume = async () => {
    await fetch('/api/agent/resume', { method: 'POST' });
  };

  const handleStop = async () => {
    await fetch('/api/agent/stop', { method: 'POST' });
  };

  const handleClear = async () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setState(DEFAULT_STATE);
    await fetch('/api/agent/clear', { method: 'POST' });
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        state={state}
        isConnected={isConnected}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onClear={handleClear}
      />

      {/* Main Content View */}
      <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto">
        {activeTab === 'dashboard' && (
          <AgentDashboard
            state={state}
            onStartAgent={handleStartAgent}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            onSelectTab={setActiveTab}
          />
        )}

        {activeTab === 'activity' && (
          <ActivityFeed actions={state.completedActions} />
        )}

        {activeTab === 'tools' && <ToolRegistryView />}

        {activeTab === 'artifacts' && <ArtifactsHub />}

        {activeTab === 'memory' && <KnowledgeVaultView />}

        {activeTab === 'tests' && <TestSuiteView />}

        {activeTab === 'files' && <FileExplorerView />}

        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Immersive HUD Footer */}
      <footer className="border-t border-[#222] bg-[#0c0c0c] py-3 text-center text-xs text-zinc-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-blue-400 font-bold uppercase tracking-wider text-[11px]">SYS_KERNEL ACTIVE</span>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-400 text-[11px]">Autonomous Free Agent &middot; Dynamic Tool Synthesis</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-zinc-500">
            <span className="text-zinc-400">RUNTIME: Python 3.10+ / Node.js</span>
            <span className="text-emerald-500 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              SANDBOX READY
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
export default App;
