import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Search, 
  BookOpen, 
  FlaskConical, 
  Lightbulb, 
  Wrench, 
  Layers, 
  Clock, 
  Tag, 
  RefreshCw 
} from 'lucide-react';

export const KnowledgeVaultView: React.FC = () => {
  const [documents, setDocuments] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchMemory = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/memory?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setDocuments(data.documents || []);
      if (data.documents?.length > 0 && !selectedDoc) {
        setSelectedDoc(data.documents[0]);
      }
    } catch (err) {
      console.error('Failed to load memory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemory();
  }, [searchQuery]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-mono">
      {/* Top Bar */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              Agent Knowledge Vault & Long-Term Memory
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              Persistent memory of discoveries, tested strategies, protocol specs, and experiment results.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search knowledge..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-[#080808] border border-[#262626] text-zinc-200 placeholder:text-zinc-600 rounded-lg focus:outline-none focus:border-blue-500 w-48 sm:w-64 font-mono"
            />
          </div>

          <button
            onClick={fetchMemory}
            className="p-2.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] text-zinc-400 hover:text-white border border-[#222] transition-colors"
            title="Refresh Knowledge"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {documents.length === 0 ? (
        <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 space-y-3 shadow-xl">
          <Layers className="w-10 h-10 mx-auto text-zinc-700" />
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Knowledge Vault is Empty</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto font-sans leading-relaxed">
            When the Agent solves problems, conducts experiments, or discovers protocol fixes, it saves structured documentation and notes in persistent memory here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* List of Docs */}
          <div className="lg:col-span-5 space-y-2.5">
            {documents.map((item, idx) => {
              const isSelected = selectedDoc?.file === item.file;
              const title = item.data?.title || item.data?.goal || item.file.split('/').pop();
              const category = item.data?.category || (item.file.includes('experiments') ? 'experiment' : 'note');

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedDoc(item)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-[#111] text-white shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                      : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold truncate">{title}</span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize ${
                      isSelected ? 'bg-blue-950/80 text-blue-300 border border-blue-500/40' : 'bg-[#161616] text-zinc-400 border border-[#2a2a2a]'
                    }`}>
                      {category}
                    </span>
                  </div>

                  <p className={`text-xs font-sans line-clamp-2 ${isSelected ? 'text-zinc-300' : 'text-zinc-500'}`}>
                    {item.data?.content || item.data?.strategy || JSON.stringify(item.data)}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Doc Detail Viewer */}
          <div className="lg:col-span-7">
            {selectedDoc ? (
              <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-5">
                <div className="border-b border-[#222] pb-4">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                    {selectedDoc.file}
                  </span>
                  <h3 className="text-base font-bold text-white font-mono">
                    {selectedDoc.data?.title || selectedDoc.data?.goal || 'Memory Record'}
                  </h3>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Structured Memory Data
                  </h4>
                  <pre className="bg-[#050505] text-zinc-200 border border-[#222] p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed max-h-[500px]">
                    {JSON.stringify(selectedDoc.data, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 text-xs shadow-xl">
                Select a document to inspect memory payload.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
