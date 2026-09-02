import React, { useState, useEffect } from 'react';
import { 
  FolderTree, 
  Folder, 
  FileText, 
  FileCode, 
  RefreshCw, 
  ChevronRight, 
  Layers, 
  Download 
} from 'lucide-react';

export const FileExplorerView: React.FC = () => {
  const [currentDir, setCurrentDir] = useState<string>('');
  const [files, setFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<any | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const fetchFiles = async (dir: string = '') => {
    try {
      setLoading(true);
      const res = await fetch(`/api/workspace/files?dir=${encodeURIComponent(dir)}`);
      const data = await res.json();
      setFiles(data.files || []);
      setCurrentDir(dir);
    } catch (err) {
      console.error('Failed to load workspace files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles('');
  }, []);

  const handleSelectFile = async (file: any) => {
    if (file.isDirectory) {
      fetchFiles(file.path);
    } else {
      setSelectedFile(file);
      try {
        const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(file.path)}`);
        const data = await res.json();
        setFileContent(data.content || '');
      } catch (err) {
        console.error('Failed to read file:', err);
      }
    }
  };

  const handleGoUp = () => {
    if (!currentDir) return;
    const parts = currentDir.split('/').filter(Boolean);
    parts.pop();
    fetchFiles(parts.join('/'));
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-mono">
      {/* Top Bar */}
      <div className="bg-[#0c0c0c] rounded-2xl p-5 border border-[#222] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#111] border border-[#333] text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.25)]">
            <FolderTree className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-widest uppercase">
              Persistent Workspace File Explorer
            </h2>
            <p className="text-xs text-zinc-500 font-sans">
              Direct access to sandbox projects, custom tools registry, memory notes, and outputs.
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchFiles(currentDir)}
          className="p-2.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] text-zinc-400 hover:text-white border border-[#222] transition-colors"
          title="Refresh Workspace"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Path Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs font-mono bg-[#0c0c0c] p-3.5 rounded-xl border border-[#222] text-zinc-300">
        <button
          onClick={() => fetchFiles('')}
          className="text-blue-400 hover:text-blue-300 font-bold uppercase tracking-wider"
        >
          workspace
        </button>
        {currentDir && (
          <>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-300 font-mono">{currentDir}</span>
          </>
        )}
        {currentDir && (
          <button
            onClick={handleGoUp}
            className="ml-auto text-[11px] text-zinc-400 hover:text-white underline font-mono uppercase"
          >
            Go Up
          </button>
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* File List */}
        <div className="lg:col-span-5 space-y-2">
          {files.length === 0 ? (
            <div className="bg-[#0c0c0c] p-8 rounded-xl border border-[#222] text-center text-xs text-zinc-500">
              Empty directory.
            </div>
          ) : (
            files.map((f, idx) => (
              <div
                key={idx}
                onClick={() => handleSelectFile(f)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                  selectedFile?.path === f.path
                    ? 'border-blue-500 bg-[#111] text-white shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                    : 'border-[#222] bg-[#0c0c0c] hover:border-[#333] hover:bg-[#101010] text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  {f.isDirectory ? (
                    <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <FileCode className="w-4 h-4 text-zinc-500 shrink-0" />
                  )}
                  <span className="text-xs font-mono font-medium truncate">{f.name}</span>
                </div>
                {!f.isDirectory && (
                  <span className="text-[10px] font-mono text-zinc-500">
                    {(f.size / 1024).toFixed(1)} KB
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Content Preview */}
        <div className="lg:col-span-7">
          {selectedFile ? (
            <div className="bg-[#0c0c0c] rounded-2xl p-6 border border-[#222] shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#222] pb-3">
                <div>
                  <h3 className="text-xs font-bold font-mono text-white">{selectedFile.name}</h3>
                  <span className="text-[10px] text-zinc-500 font-mono">{selectedFile.path}</span>
                </div>
              </div>

              <pre className="bg-[#050505] text-zinc-200 border border-[#222] p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed max-h-[500px]">
                {fileContent}
              </pre>
            </div>
          ) : (
            <div className="bg-[#0c0c0c] rounded-2xl p-12 border border-[#222] text-center text-zinc-500 text-xs shadow-xl">
              Select a file from the workspace to preview its source.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
