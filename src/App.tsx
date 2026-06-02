import React, { useState, useCallback } from 'react';
import { UploadCloud, Loader2, Sparkles, AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { analyzeImage, calculateExchangePlan, type ParsedItem, type ExchangeStep } from './analyzer';
import './index.css';

const getItemStyle = (name: string): React.CSSProperties => {
  if (name.includes('赤色')) return { color: '#ff6b6b' };
  if (name.includes('橙色')) return { color: '#ff922b' };
  if (name.includes('黄色')) return { color: '#fcc419' };
  if (name.includes('緑色')) return { color: '#51cf66' };
  if (name.includes('青色')) return { color: '#339af0' };
  if (name.includes('紫色')) return { color: '#b197fc' };
  if (name.includes('銀色')) return { color: '#ced4da' };
  if (name.includes('虹色')) return { 
    backgroundImage: 'linear-gradient(to right, #ff6b6b, #fcc419, #51cf66, #339af0, #b197fc)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent'
  };
  return { color: '#fff' };
};

function App() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [debugImageUrls, setDebugImageUrls] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [exchangePlan, setExchangePlan] = useState<ExchangeStep[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleImageUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('画像ファイル(BMP/PNG/JPG)を選択してください。');
      return;
    }

    setErrorMsg(null);
    setImagePreview(URL.createObjectURL(file));
    setDebugImageUrls([]);
    setIsAnalyzing(true);
    setProgressMsg('処理を開始します...');

    try {
      const items = await analyzeImage(file, setProgressMsg, setDebugImageUrls);
      setParsedItems(items);
      const plan = calculateExchangePlan(items);
      setExchangePlan(plan);
    } catch (error) {
      console.error(error);
      setErrorMsg('解析中にエラーが発生しました。');
    } finally {
      setIsAnalyzing(false);
      setProgressMsg('');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageUpload(e.dataTransfer.files[0]);
    }
  }, [handleImageUpload]);

  const handleItemCountChange = useCallback((index: number, newCount: number) => {
    setParsedItems(prev => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], count: Math.max(0, newCount) };
      setExchangePlan(calculateExchangePlan(newItems));
      return newItems;
    });
  }, []);

  return (
    <div className="app-container">
      <header className="header">
        <h1><Sparkles className="inline-block mr-2 text-accent-hover" /> Item Balancer</h1>
        <p>画像を読み込んで、アイテムの1:1平準化交換を計算します</p>
      </header>

      <main>
        <section className="glass-panel" style={{ marginBottom: '24px' }}>
          <input 
            id="file-upload" 
            type="file" 
            accept="image/*" 
            className="hidden" 
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && handleImageUpload(e.target.files[0])}
          />

          {!imagePreview ? (
            <div 
              className="upload-area"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <UploadCloud size={48} className="upload-icon" />
              <h3>画像をアップロード</h3>
              <p>クリックまたはドラッグ＆ドロップで画像を選択</p>
            </div>
          ) : (
            <div 
              className="upload-area"
              style={{ padding: 0, position: 'relative', overflow: 'hidden', border: 'none', background: '#1a1f2e' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <img 
                src={imagePreview} 
                alt="Preview" 
                style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', opacity: 0.5, display: 'block' }} 
              />
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                <div className="btn" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '1.1em', pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                  <UploadCloud size={24} />
                  別の画像をアップロード
                </div>
              </div>
            </div>
          )}
          
          {debugImageUrls.length > 0 && (
            <details style={{ marginTop: '16px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px' }}>
              <summary style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontWeight: 'bold' }}>
                デバッグ用: 分割画像 (8枠) を表示
              </summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', backgroundColor: '#fff', padding: '12px', borderRadius: '4px', justifyContent: 'center', marginTop: '12px' }}>
                {debugImageUrls.map((url, i) => (
                  <div key={i} style={{ width: '23%', minWidth: '80px' }}>
                    <img src={url} alt={`Debug Preview ${i}`} style={{ width: '100%', border: '1px solid #ccc' }} />
                  </div>
                ))}
              </div>
            </details>
          )}

          {errorMsg && <p className="error-text" style={{ marginTop: '16px', color: 'var(--danger-color)' }}>{errorMsg}</p>}
          
          {isAnalyzing && (
            <div className="progress-container" style={{ marginTop: '16px' }}>
              <Loader2 className="spin" size={32} style={{ color: 'var(--accent-color)', margin: '0 auto 12px' }} />
              <div className="progress-text">{progressMsg}</div>
            </div>
          )}
        </section>

        {!isAnalyzing && parsedItems.length > 0 && (
          <div className="results-grid">
            <section className="glass-panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0 }}>
                現在の所持数 (手動修正可能)
              </h3>
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
    </div>
  );
}

export default App;
