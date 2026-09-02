import React, { useState, useEffect } from 'react';
import { 
  FolderArchive, 
  FileCode, 
  Download, 
  Copy, 
  Check, 
  QrCode, 
  ShieldCheck, 
  RefreshCw, 
  Layers, 
  Eye, 
  Share2,
  ExternalLink
} from 'lucide-react';
import { ArtifactMetadata } from '../types';

export const ArtifactsHub: React.FC = () => {
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<any | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<any | null>(null);

  const fetchArtifacts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/outputs');
      const data = await res.json();
      setArtifacts(data.artifacts || []);
      if (data.artifacts?.length > 0 && !selectedArtifact) {
        handleSelectArtifact(data.artifacts[0]);
      }
    } catch (err) {
      console.error('Failed to load artifacts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArtifacts();
  }, []);

  const handleSelectArtifact = async (art: any) => {
    setSelectedArtifact(art);
    try {
      const res = await fetch(`/api/outputs/${encodeURIComponent(art.name)}`);
      const text = await res.text();
      setFileContent(text);

      // If json or v2ray, validate
      if (art.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.inbounds || parsed.outbounds) {
            const valRes = await fetch('/api/v2ray/validate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config: parsed }),
            });
            const valData = await valRes.json();
            setValidationResult(valData.validation);
          } else {
            setValidationResult(null);
          }
        } catch {
          setValidationResult(null);
        }
      } else {
        setValidationResult(null);
      }
    } catch (err) {
      console.error('Failed to read artifact content:', err);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!selectedArtifact || !fileContent) return;
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedArtifact.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-mono">
      {/* Top Bar */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <FolderArchive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              Outputs & Artifacts Hub
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              Verified configurations, synthesized Python scripts, research reports & share links.
            </p>
          </div>
        </div>

        <button
          onClick={fetchArtifacts}
          className="p-2.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] text-zinc-400 hover:text-white border border-[#222] transition-colors"
          title="Refresh Artifacts"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {artifacts.length === 0 ? (
        <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 space-y-3 shadow-xl">
          <Layers className="w-10 h-10 mx-auto text-zinc-700" />
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">No Exported Artifacts Yet</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto font-sans leading-relaxed">
            Launch a goal such as building a VLESS server or creating a script, and the validated output file will be saved and listed here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Artifacts List */}
          <div className="lg:col-span-4 space-y-2.5">
            {artifacts.map((art) => {
              const isSelected = selectedArtifact?.name === art.name;
              return (
                <div
                  key={art.name}
                  onClick={() => handleSelectArtifact(art)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-[#111] text-white shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                      : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-400' : 'text-zinc-500'}`} />
                      <span className="font-mono text-xs font-bold truncate">{art.name}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] pt-1">
                    <span className={isSelected ? 'text-zinc-400' : 'text-zinc-500'}>
                      {(art.size / 1024).toFixed(1)} KB
                    </span>
                    {art.meta?.validated && (
                      <span className="text-emerald-400 font-bold flex items-center gap-1 font-mono uppercase">
                        <ShieldCheck className="w-3 h-3" /> VERIFIED
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Artifact Details & Inspector */}
          <div className="lg:col-span-8">
            {selectedArtifact ? (
              <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-5">
                {/* Header with Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222] pb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white font-mono">
                      {selectedArtifact.name}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5 font-sans">
                      {selectedArtifact.meta?.goal || 'Autonomous Goal Output'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(fileContent)}
                      className="px-3 py-1.5 text-xs font-bold text-zinc-300 bg-[#141414] hover:bg-[#202020] border border-[#333] rounded-lg transition-colors flex items-center gap-1.5 uppercase tracking-wider"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      onClick={handleDownload}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-[0_0_10px_rgba(59,130,246,0.3)] uppercase tracking-wider"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                  </div>
                </div>

                {/* V2Ray Share Link Box (if available) */}
                {selectedArtifact.meta?.share_link && (
                  <div className="p-4 rounded-xl bg-[#080808] border border-[#222] text-white space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
                        <Share2 className="w-3.5 h-3.5 text-blue-400" /> Client Universal Share Link
                      </span>
                      <button
                        onClick={() => handleCopy(selectedArtifact.meta.share_link)}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 uppercase tracking-wider"
                      >
                        <Copy className="w-3 h-3" /> Copy Link
                      </button>
                    </div>
                    <p className="font-mono text-xs bg-[#050505] p-2.5 rounded-lg border border-[#222] break-all text-emerald-400 shadow-inner">
                      {selectedArtifact.meta.share_link}
                    </p>
                  </div>
                )}

                {/* Validation Badge */}
                {validationResult && (
                  <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold uppercase tracking-wider">V2Ray Semantic Validation: {validationResult.score}/100 Score</span>
                    </div>
                    <span className="text-xs text-emerald-400 font-mono uppercase font-bold">0 SYNTAX ERRORS</span>
                  </div>
                )}

                {/* File Content Preview */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Content Preview
                  </h4>
                  <pre className="bg-[#050505] text-zinc-200 border border-[#222] p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed max-h-[480px]">
                    {fileContent}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 text-xs shadow-xl">
                Select an artifact to view content and download.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
