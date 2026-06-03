import React, { useState, useCallback } from 'react';
import { UploadCloud, Loader2, Sparkles, ArrowRight, RefreshCw, Eye, Trash2, X } from 'lucide-react';
import localforage from 'localforage';
import { analyzeImageAuto, calculateExchangePlan, type ParsedItem, type ExchangeStep } from './analyzer';

function App() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [exchangePlan, setExchangePlan] = useState<ExchangeStep[]>([]);
  const [debugUrl, setDebugUrl] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  React.useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  React.useEffect(() => {
    const loadState = async () => {
      try {
        const savedFile = await localforage.getItem<Blob>('savedImage');
        const savedParsedItems = await localforage.getItem<ParsedItem[]>('parsedItems');
        const savedDebugUrl = await localforage.getItem<string>('debugUrl');
        
        if (savedFile) {
          setImagePreview(URL.createObjectURL(savedFile));
        }
        if (savedParsedItems) {
          setParsedItems(savedParsedItems);
          setExchangePlan(calculateExchangePlan(savedParsedItems));
        }
        if (savedDebugUrl) {
          setDebugUrl(savedDebugUrl);
        }
      } catch (e) {
        console.error('Failed to load state from indexedDB', e);
      } finally {
        setIsInitializing(false);
      }
    };
    loadState();
  }, []);

  const handleImageUpload = async (file: File) => {
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    const objUrl = URL.createObjectURL(file);
    setImagePreview(objUrl);
    setIsAnalyzing(true);
    setProgressMsg('画像を読み込んでいます...');
    setParsedItems([]);
    setExchangePlan([]);
    setDebugUrl(null);
    setErrorMsg(null);
    setToastMsg(null);

    try {
      const result = await analyzeImageAuto(file, setProgressMsg);
      setParsedItems(result.items);
      const plan = calculateExchangePlan(result.items);
      setExchangePlan(plan);
      if (result.debugUrl) {
        setDebugUrl(result.debugUrl);
        await localforage.setItem('debugUrl', result.debugUrl);
      } else {
        await localforage.removeItem('debugUrl');
      }

      await localforage.setItem('savedImage', file);
      await localforage.setItem('parsedItems', result.items);

      setToastMsg("解析が完了しました！");
    } catch (e: any) {
      setErrorMsg(e.message || '解析に失敗しました');
    } finally {
      setIsAnalyzing(false);
      setProgressMsg('');
    }
  };

  const handleClear = () => {
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    setImagePreview(null);
    setParsedItems([]);
    setExchangePlan([]);
    setDebugUrl(null);
    setErrorMsg(null);
    setToastMsg(null);
    setIsPreviewModalOpen(false);

    localforage.removeItem('savedImage');
    localforage.removeItem('parsedItems');
    localforage.removeItem('debugUrl');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleItemCountChange = (index: number, newCount: number) => {
    const newItems = [...parsedItems];
    newItems[index].count = newCount;
    setParsedItems(newItems);
    setExchangePlan(calculateExchangePlan(newItems));
    localforage.setItem('parsedItems', newItems);
  };

  const getItemStyle = (name: string) => {
    if (name.includes('赤色')) return { color: '#ff6b6b' };
    if (name.includes('橙色')) return { color: '#fcc419' };
    if (name.includes('黄色')) return { color: '#ffd43b' };
    if (name.includes('緑色')) return { color: '#51cf66' };
    if (name.includes('青色')) return { color: '#339af0' };
    if (name.includes('紫色')) return { color: '#b197fc' };
    if (name.includes('銀色')) return { color: '#ced4da' };
    if (name.includes('虹色')) return {
      backgroundImage: 'linear-gradient(to right, #ff6b6b, #fcc419, #51cf66, #339af0, #b197fc)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      fontWeight: 'bold'
    };
    return { color: '#fff' };
  };

  if (isInitializing) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Loader2 className="spin" size={48} style={{ color: 'var(--accent-color)' }} />
      </div>
    );
  }

  return (
    <div 
      className="container"
      onPaste={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
              e.preventDefault();
              handleImageUpload(file);
              break;
            }
          }
        }
      }}
    >
      <main className="main-content">
        <header style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1><Sparkles className="inline-block mr-2 text-accent-hover" /> Item Balancer</h1>
          <p>画面全体のスクリーンショットを一括OCRで読み込みます</p>
        </header>

        <section className="glass-panel" style={{ marginBottom: '24px' }}>
          <input
            id="file-upload"
            type="file"
            accept="image/*"
            className="hidden"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleImageUpload(e.target.files[0]);
                e.target.value = '';
              }
            }}
          />

          {!imagePreview ? (
            <div
              className="upload-area"
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <UploadCloud size={48} style={{ margin: '0 auto 16px', color: 'var(--accent-color)' }} />
              <h3>クリック、ペースト、またはドラッグ＆ドロップで画像をアップロード</h3>
              <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: '8px' }}>
                （Ctrl+Vで直接貼り付け可能）
              </p>
            </div>
          ) : (
            <div style={{ marginBottom: '16px' }}>
              <div 
                style={{ 
                  position: 'relative', overflow: 'hidden', borderRadius: '8px', 
                  border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: '#0a0d14' 
                }}
                onClick={() => setIsPreviewModalOpen(true)}
              >
                <img
                  src={imagePreview}
                  alt="Preview Thumbnail"
                  style={{ 
                    width: '100%', maxHeight: '300px', objectFit: 'contain', 
                    display: 'block', transition: 'opacity 0.2s', opacity: 0.9
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '0.9'}
                />
                <div style={{ 
                  position: 'absolute', bottom: '12px', right: '12px', 
                  background: 'rgba(0,0,0,0.7)', padding: '6px 12px', 
                  borderRadius: '6px', fontSize: '0.9em', display: 'flex', alignItems: 'center', gap: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                }}>
                  <Eye size={16} /> クリックで拡大プレビュー
                </div>
              </div>

              {!isAnalyzing && (
                <div style={{ display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'center' }}>
                  <div className="btn" onClick={() => document.getElementById('file-upload')?.click()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UploadCloud size={18} /> 別の画像
                  </div>
                  <div className="btn" onClick={handleClear} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,107,107,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.3)' }}>
                    <Trash2 size={18} /> クリア
                  </div>
                </div>
              )}
            </div>
          )}

          {errorMsg && <p className="error-text" style={{ marginTop: '16px', color: 'var(--danger-color)' }}>{errorMsg}</p>}

          {isAnalyzing && (
            <div className="progress-container" style={{ marginTop: '16px' }}>
              <Loader2 className="spin" size={32} style={{ color: 'var(--accent-color)', margin: '0 auto 12px' }} />
              <div className="progress-text">{progressMsg}</div>
            </div>
          )}
        </section>

        {!isAnalyzing && debugUrl && (
          <details style={{ marginBottom: '24px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px' }}>
            <summary style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontWeight: 'bold' }}>
              デバッグ用: OCRが検出した枠とテキストを表示
            </summary>
            <div style={{ marginTop: '12px', overflow: 'auto', maxHeight: '600px' }}>
              <img src={debugUrl} alt="Debug View" style={{ width: '100%', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)' }} />
            </div>
          </details>
        )}

        {!isAnalyzing && parsedItems.length > 0 && (
          <div className="results-grid">
            <section className="glass-panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0 }}>
                現在の所持数 (自動抽出)
              </h3>
              <p style={{ fontSize: '0.85em', color: 'rgba(255,255,255,0.6)', marginBottom: '12px' }}>
                ※ 読み取りミスがある場合は手動で修正できます。
              </p>
              <ul className="item-list">
                {parsedItems.map((item, idx) => (
                  <li key={idx} className="item-row">
                    <span style={getItemStyle(item.name)}>{item.name.replace('(キャラ帰属)', '')}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="number"
                        min="0"
                        value={item.count || 0}
                        onChange={(e) => handleItemCountChange(idx, parseInt(e.target.value) || 0)}
                        style={{
                          width: '80px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(255,255,255,0.2)',
                          backgroundColor: 'rgba(0,0,0,0.3)',
                          color: '#fff',
                          textAlign: 'right'
                        }}
                      />
                      <span style={{ fontSize: '0.9em', color: 'rgba(255,255,255,0.6)' }}>個</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="glass-panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0 }}>
                <RefreshCw /> 交換手順 (目標: 各 {parsedItems.length > 0 ? Math.floor(parsedItems.reduce((acc, curr) => acc + curr.count, 0) / parsedItems.length) : 0} 個)
              </h3>
              {exchangePlan.length > 0 ? (
                <ul className="item-list">
                  {exchangePlan.map((step, idx) => (
                    <li key={idx} className="item-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                        <span style={getItemStyle(step.from)}>{step.from.replace('(キャラ帰属)', '')}</span>
                        <ArrowRight size={16} style={{ color: 'rgba(255,255,255,0.5)' }} />
                        <span style={getItemStyle(step.to)}>{step.to.replace('(キャラ帰属)', '')}</span>
                      </div>
                      <span style={{ fontWeight: 'bold' }}>{step.amount} 個</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '10px' }}>すべてのアイテムが平準化されています</p>
              )}
            </section>
          </div>
        )}
      </main>

      {/* プレビューモーダル */}
      {isPreviewModalOpen && imagePreview && (
        <div 
          style={{ 
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
            background: 'rgba(0,0,0,0.85)', zIndex: 10000, 
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' 
          }}
          onClick={() => setIsPreviewModalOpen(false)}
        >
          <div 
            style={{ 
              position: 'absolute', top: '24px', right: '24px', cursor: 'pointer', 
              background: 'rgba(255,255,255,0.1)', padding: '12px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <X size={28} />
          </div>
          <img 
            src={imagePreview} 
            alt="Full Preview" 
            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', boxShadow: '0 0 24px rgba(0,0,0,0.5)' }} 
            onClick={(e) => e.stopPropagation()} // 画像クリックでは閉じない
          />
        </div>
      )}

      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255, 255, 255, 0.95)', color: '#000', padding: '12px 24px',
          borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontWeight: 'bold', zIndex: 9999
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default App;
