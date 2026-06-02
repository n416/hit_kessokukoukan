import React, { useState, useCallback, useRef } from 'react';
import { UploadCloud, Loader2, Sparkles, ArrowRight, RefreshCw, Settings, Download, Upload, X } from 'lucide-react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { analyzeImageAuto, calculateExchangePlan, type ParsedItem, type ExchangeStep, type CalibrationData } from './analyzer';

const DEVICE_PRESETS: Record<string, CalibrationData> = {
  'PC': {
    startX1: 139.61668701171874,
    startX2: 1244.15,
    startY: 368.9,
    stepX: 234.66662597656256,
    stepY: 136.666748046875,
    cropW: 210,
    cropH: 51.3333740234375
  },
  'iPad': {
    startX1: 78.79999999999995,
    startX2: 1046.933251953125,
    startY: 353.59999999999997,
    stepX: 240.66656494140625,
    stepY: 144,
    cropW: 223.99993896484375,
    cropH: 65.33331298828125
  },
  'iPhone15': {
    startX1: 194.2,
    startX2: 1122.7333129882813,
    startY: 219.86668701171874,
    stepX: 220.66662597656256,
    stepY: 126.00006103515625,
    cropW: 207.33331298828125,
    cropH: 52.66668701171875
  },
};

function guessDevice(width: number, height: number): string | null {
  const aspect = width / height;
  if (aspect > 2.0) return 'iPhone15'; // 例: 2556/1179 = 2.16
  if (aspect > 1.6 && aspect < 1.9) return 'PC'; // 例: 1920/1080 = 1.77
  if (aspect > 1.3 && aspect <= 1.5) return 'iPad'; // 例: 2388/1668 = 1.43
  return null;
}

function App() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [exchangePlan, setExchangePlan] = useState<ExchangeStep[]>([]);
  const [debugUrl, setDebugUrl] = useState<string | null>(null);

  const [deviceConfirm, setDeviceConfirm] = useState<{ file: File, deviceName: string, calibPreset: CalibrationData } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importText, setImportText] = useState('');

  // ウィザード状態: 0=完了, 1=赤(左上外), 2=黄(左上内), 3=青(右上内), 4=橙(左下外)
  const [calibration, setCalibration] = useState<CalibrationData | null>(() => {
    const saved = localStorage.getItem('calibration_data');
    return saved ? JSON.parse(saved) : null;
  });
  const [wizardStep, setWizardStep] = useState<number>(0);

  // react-image-crop states
  // 初期枠は少し大きめに（大体数字が入りそうなサイズ）
  const [crop, setCrop] = useState<Crop>({
    unit: 'px',
    x: 0,
    y: 0,
    width: 250,
    height: 100
  });
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [tempPoints, setTempPoints] = useState<{ p1?: PixelCrop, p2?: PixelCrop, p3?: PixelCrop }>({});

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- ドラッグスクロール（パン）用ステート ---
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const onPanStart = (e: React.MouseEvent | React.TouchEvent) => {
    // 枠内（クロップ操作やリサイズ）のクリックならパンしない
    const target = e.target as HTMLElement;
    if (target.closest('.ReactCrop__crop-selection') || target.closest('.ReactCrop__drag-handle')) {
      return;
    }
    
    // マウスの場合、左クリック以外は無視
    if (e.type === 'mousedown' && (e as React.MouseEvent).button !== 0) return;

    if (containerRef.current) {
      isPanning.current = true;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      
      panStart.current = {
        x: clientX,
        y: clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop
      };
      containerRef.current.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      
      // ReactCropによる新規枠作成や、ブラウザの画像ドラッグを防ぐ
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
    }
  };

  const onPanMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isPanning.current || !containerRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
    
    const dx = clientX - panStart.current.x;
    const dy = clientY - panStart.current.y;
    
    containerRef.current.scrollLeft = panStart.current.scrollLeft - dx;
    containerRef.current.scrollTop = panStart.current.scrollTop - dy;
  }, []);

  const onPanEnd = useCallback(() => {
    if (isPanning.current && containerRef.current) {
      isPanning.current = false;
      containerRef.current.style.cursor = 'grab';
      document.body.style.userSelect = '';
    }
  }, []);

  React.useEffect(() => {
    document.addEventListener('mousemove', onPanMove, { passive: false });
    document.addEventListener('mouseup', onPanEnd);
    document.addEventListener('touchmove', onPanMove, { passive: false });
    document.addEventListener('touchend', onPanEnd);
    return () => {
      document.removeEventListener('mousemove', onPanMove);
      document.removeEventListener('mouseup', onPanEnd);
      document.removeEventListener('touchmove', onPanMove);
      document.removeEventListener('touchend', onPanEnd);
    };
  }, [onPanMove, onPanEnd]);

  React.useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  const startAnalyze = useCallback(async (file: File, calib: CalibrationData) => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      const result = await analyzeImageAuto(file, calib, setProgressMsg);
      setParsedItems(result.items);
      const plan = calculateExchangePlan(result.items);
      setExchangePlan(plan);
      if (result.debugUrl) {
        setDebugUrl(result.debugUrl);
      }
    } catch (e: any) {
      setErrorMsg(e.message || '解析に失敗しました');
    } finally {
      setIsAnalyzing(false);
      setProgressMsg('');
    }
  }, []);

  const handleImageUpload = async (file: File) => {
    const objUrl = URL.createObjectURL(file);
    setImagePreview(objUrl);
    setParsedItems([]);
    setExchangePlan([]);
    setDebugUrl(null);

    // ウィザードか解析か
    if (!calibration) {
      const img = new Image();
      img.onload = () => {
        const device = guessDevice(img.width, img.height);
        if (device && DEVICE_PRESETS[device]) {
          setDeviceConfirm({ file, deviceName: device, calibPreset: DEVICE_PRESETS[device] });
        } else {
          startWizard();
        }
      };
      img.src = objUrl;
    } else {
      startAnalyze(file, calibration);
    }
  };

  const startWizard = () => {
    setWizardStep(1);
    setCrop({ unit: 'px', x: 0, y: 0, width: 250, height: 100 });
    setCompletedCrop(null);
  };

  const handleConfirmDevice = (confirmed: boolean) => {
    if (!deviceConfirm) return;
    if (confirmed) {
      const calib = deviceConfirm.calibPreset;
      localStorage.setItem('calibration_data', JSON.stringify(calib));
      setCalibration(calib);
      setWizardStep(0);
      startAnalyze(deviceConfirm.file, calib);
    } else {
      setToastMsg("開発者にスクリーンショットをお送りください。手動でクロップ枠を設定します。");
      startWizard();
    }
    setDeviceConfirm(null);
  };

  const handleExport = () => {
    if (calibration) {
      navigator.clipboard.writeText(JSON.stringify(calibration, null, 2))
        .then(() => setToastMsg("クロップ設定をクリップボードにコピーしました！"))
        .catch(() => setToastMsg("コピーに失敗しました。"));
    }
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (parsed && typeof parsed.startX1 === 'number') {
        localStorage.setItem('calibration_data', JSON.stringify(parsed));
        setCalibration(parsed);
        setShowImportDialog(false);
        setImportText('');
        setToastMsg("クロップ設定をインポートしました。");
        setWizardStep(0);
      } else {
        setToastMsg("不正なフォーマットです。");
      }
    } catch (e) {
      setToastMsg("JSONのパースに失敗しました。");
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageUpload(e.dataTransfer.files[0]);
    }
  }, [calibration, startAnalyze]);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (wizardStep === 1 && containerRef.current) {
      // 初期スクロール位置（画面の左端から15%、上から30%付近）
      const scrollX = Math.max(0, img.width * 0.15 - containerRef.current.clientWidth / 2);
      const scrollY = Math.max(0, img.height * 0.30 - containerRef.current.clientHeight / 2);
      
      containerRef.current.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });

      // 初期クロップ枠の位置もターゲット付近に合わせる
      setCrop({
        unit: 'px',
        x: img.width * 0.15,
        y: img.height * 0.30,
        width: 250,
        height: 100
      });
    }
  }, [wizardStep]);

  const handleCropChange = (newCrop: Crop) => {
    if (wizardStep > 1 && tempPoints.p1) {
      // サイズは1個目と同じに固定
      newCrop.width = tempPoints.p1.width;
      newCrop.height = tempPoints.p1.height;
      
      if (wizardStep === 2 || wizardStep === 3) {
        // Y軸固定（横移動のみ）
        newCrop.y = tempPoints.p1.y;
      } else if (wizardStep === 4) {
        // X軸固定（縦移動のみ）
        newCrop.x = tempPoints.p1.x;
      }
    }
    setCrop(newCrop);
  };

  const handleNextWizard = () => {
    if (!completedCrop) return;

    if (wizardStep === 1) {
      setTempPoints({ p1: completedCrop });
      setWizardStep(2);
      // 黄色（右隣）へ枠を少しずらす
      setCrop(prev => ({ ...prev, x: prev.x + completedCrop.width * 2 }));
    } else if (wizardStep === 2) {
      setTempPoints(prev => ({ ...prev, p2: completedCrop }));
      setWizardStep(3);
      // 青色（盾を挟んで右側）へ枠を大きくずらす
      if (containerRef.current && imgRef.current) {
        containerRef.current.scrollBy({ left: imgRef.current.width * 0.4, behavior: 'smooth' });
      }
      setCrop(prev => ({ ...prev, x: prev.x + imgRef.current!.width * 0.4 }));
    } else if (wizardStep === 3) {
      setTempPoints(prev => ({ ...prev, p3: completedCrop }));
      setWizardStep(4);
      // 橙色（最初の赤の真下）へ枠をずらす
      if (containerRef.current && imgRef.current) {
        const p1 = tempPoints.p1!;
        containerRef.current.scrollTo({ left: Math.max(0, p1.x - containerRef.current.clientWidth / 2), behavior: 'smooth' });
        setCrop(prev => ({ ...prev, x: p1.x, y: prev.y + completedCrop.height * 2 }));
      }
    } else if (wizardStep === 4) {
      const p1 = tempPoints.p1!;
      const p2 = tempPoints.p2!;
      const p3 = tempPoints.p3!;
      const p4 = completedCrop;

      const calib: CalibrationData = {
        startX1: p1.x,
        startX2: p3.x,
        startY: p1.y,
        stepX: p2.x - p1.x,
        stepY: p4.y - p1.y,
        cropW: p1.width,
        cropH: p1.height
      };

      localStorage.setItem('calibration_data', JSON.stringify(calib));
      setCalibration(calib);
      setWizardStep(0);

      // 解析開始
      fetch(imagePreview!).then(r => r.blob()).then(blob => {
        startAnalyze(new File([blob], "image.png", { type: "image/png" }), calib);
      });
    }
  };

  const handlePrevWizard = () => {
    if (wizardStep === 2) {
      setCrop(tempPoints.p1 as Crop);
      setWizardStep(1);
    } else if (wizardStep === 3) {
      setCrop(tempPoints.p2 as Crop);
      setWizardStep(2);
    } else if (wizardStep === 4) {
      setCrop(tempPoints.p3 as Crop);
      setWizardStep(3);
    }
  };

  const resetCalibration = () => {
    localStorage.removeItem('calibration_data');
    setCalibration(null);
    const selectedFile = (document.getElementById('file-upload') as HTMLInputElement)?.files?.[0];
    if (selectedFile) {
      startWizard();
    }
  };

  const handleItemCountChange = (index: number, newCount: number) => {
    const newItems = [...parsedItems];
    newItems[index].count = newCount;
    setParsedItems(newItems);
    setExchangePlan(calculateExchangePlan(newItems));
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

  return (
    <div className="container">
      <main className="main-content">
        <header style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1><Sparkles className="inline-block mr-2 text-accent-hover" /> Item Balancer</h1>
          <p>画像を読み込んで、アイテムの1:1平準化交換を計算します</p>
          {calibration && !isAnalyzing && wizardStep === 0 && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={resetCalibration} className="btn" style={{ fontSize: '0.9em', padding: '6px 12px' }}>
                <Settings size={16} style={{ display: 'inline', marginRight: '4px' }} />
                再設定
              </button>
              <button onClick={handleExport} className="btn" style={{ fontSize: '0.9em', padding: '6px 12px', background: 'rgba(51, 154, 240, 0.2)', borderColor: '#339af0' }}>
                <Upload size={16} style={{ display: 'inline', marginRight: '4px' }} />
                エクスポート
              </button>
              <button onClick={() => setShowImportDialog(true)} className="btn" style={{ fontSize: '0.9em', padding: '6px 12px', background: 'rgba(81, 207, 102, 0.2)', borderColor: '#51cf66' }}>
                <Download size={16} style={{ display: 'inline', marginRight: '4px' }} />
                インポート
              </button>
            </div>
          )}
        </header>

        <section className="glass-panel" style={{ marginBottom: '24px' }}>
          <input
            id="file-upload"
            type="file"
            accept="image/*"
            className="hidden"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) handleImageUpload(e.target.files[0]);
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
              <h3>クリックまたはドラッグ＆ドロップで画像をアップロード</h3>
              <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: '8px' }}>
                画面全体のスクリーンショットに対応しています
              </p>
            </div>
          ) : wizardStep > 0 ? (
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ marginTop: 0 }}>
                <Settings size={20} className="inline-block mr-2" />
                初期設定 ({wizardStep}/4)
              </h3>
              <p style={{ marginBottom: '16px', fontWeight: 'bold' }}>
                {wizardStep === 1 && "左端（1個目: 赤）の数字を囲んでください。"}
                {wizardStep === 2 && "隣（2個目: 黄）の数字を囲んでください。"}
                {wizardStep === 3 && "盾を挟んだ右側（3個目: 青）の数字を囲んでください。"}
                {wizardStep === 4 && "最初の下（5個目: 橙）の数字を囲んでください。"}
              </p>

              <div style={{ padding: '12px', background: 'rgba(50, 150, 255, 0.1)', border: '1px solid #339af0', borderRadius: '8px', marginBottom: '16px', display: 'inline-block', textAlign: 'left', maxWidth: '600px' }}>
                <strong style={{ color: '#66b2ff', display: 'block', marginBottom: '4px' }}>💡 【ポイント】 日本語やアイコンが多少入っても大丈夫です</strong>
                <p style={{ margin: 0, fontSize: '0.9em', lineHeight: '1.5' }}>
                  プログラム側で自動的に数字だけを綺麗に抽出するようになっています。<br/>
                  神経質にならず、数字（0/1 など）がすっぽり入るように、<b>少し大きめにザックリと枠を引いてください</b>。<br/>
                  画像が見切れている場合は、<b>スクロールバー</b>を使って移動できます。
                </p>
              </div>

              <div 
                ref={containerRef}
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: '1200px',
                  maxHeight: '60vh',
                  border: '2px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  backgroundColor: '#111',
                  margin: '0 auto',
                  overflow: 'auto',
                  cursor: 'grab'
                }}
                onMouseDownCapture={onPanStart}
                onTouchStartCapture={onPanStart}
              >
                <div style={{ position: 'relative', display: 'inline-block', minWidth: 'max-content' }}>
                  <ReactCrop
                    crop={crop}
                    onChange={handleCropChange}
                    onComplete={(c) => setCompletedCrop(c)}
                    locked={wizardStep > 1}
                  >
                    <img 
                      ref={imgRef} 
                      src={imagePreview} 
                      onLoad={onImageLoad}
                      draggable={false}
                      style={{ maxWidth: 'none', display: 'block', pointerEvents: 'none' }} // 原寸大表示、ポインターイベントは外側の枠で受ける
                      alt="Crop area" 
                    />
                  </ReactCrop>
                  
                  {/* ガイド線と過去の枠のオーバーレイ */}
                  {wizardStep > 1 && tempPoints.p1 && (
                    <>
                      {/* 1個目（赤）の枠 */}
                      <div style={{ position: 'absolute', top: tempPoints.p1.y, left: tempPoints.p1.x, width: tempPoints.p1.width, height: tempPoints.p1.height, border: '2px solid rgba(255, 107, 107, 0.7)', backgroundColor: 'rgba(255, 107, 107, 0.1)', pointerEvents: 'none' }} />
                      
                      {/* 横方向のガイドレール */}
                      {(wizardStep === 2 || wizardStep === 3) && (
                        <div style={{ position: 'absolute', top: tempPoints.p1.y + tempPoints.p1.height / 2, left: tempPoints.p1.x, right: 0, height: '1px', borderTop: '2px dashed rgba(255, 255, 255, 0.6)', pointerEvents: 'none' }} />
                      )}
                      
                      {/* 縦方向のガイドレール */}
                      {wizardStep === 4 && (
                        <div style={{ position: 'absolute', top: tempPoints.p1.y, bottom: 0, left: tempPoints.p1.x + tempPoints.p1.width / 2, width: '1px', borderLeft: '2px dashed rgba(255, 255, 255, 0.6)', pointerEvents: 'none' }} />
                      )}
                    </>
                  )}
                  {wizardStep > 2 && tempPoints.p2 && (
                    <div style={{ position: 'absolute', top: tempPoints.p2.y, left: tempPoints.p2.x, width: tempPoints.p2.width, height: tempPoints.p2.height, border: '2px solid rgba(255, 212, 59, 0.7)', backgroundColor: 'rgba(255, 212, 59, 0.1)', pointerEvents: 'none' }} />
                  )}
                  {wizardStep > 3 && tempPoints.p3 && (
                    <div style={{ position: 'absolute', top: tempPoints.p3.y, left: tempPoints.p3.x, width: tempPoints.p3.width, height: tempPoints.p3.height, border: '2px solid rgba(51, 154, 240, 0.7)', backgroundColor: 'rgba(51, 154, 240, 0.1)', pointerEvents: 'none' }} />
                  )}
                </div>
              </div>

              <div style={{ 
                position: 'fixed',
                bottom: '32px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                background: 'rgba(26, 31, 46, 0.85)',
                padding: '12px 24px',
                borderRadius: '16px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                gap: '16px',
                alignItems: 'center'
              }}>
                {wizardStep > 1 && (
                  <button
                    className="btn"
                    onClick={handlePrevWizard}
                    style={{ 
                      minWidth: '120px',
                      fontSize: '1.1em',
                      fontWeight: 'bold',
                      padding: '12px 24px',
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.8)',
                    }}
                  >
                    前に戻る
                  </button>
                )}
                <button
                  className="btn"
                  disabled={!completedCrop || completedCrop.width === 0}
                  onClick={handleNextWizard}
                  style={{ 
                    opacity: (!completedCrop || completedCrop.width === 0) ? 0.5 : 1, 
                    minWidth: '200px',
                    fontSize: '1.1em',
                    fontWeight: 'bold',
                    padding: '12px 32px'
                  }}
                >
                  {wizardStep === 4 ? "設定完了" : "次へ"}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="upload-area"
              style={{ padding: 0, position: 'relative', overflow: 'hidden', border: 'none', background: '#1a1f2e' }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
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

          {!isAnalyzing && debugUrl && wizardStep === 0 && (
            <details style={{ marginTop: '16px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px' }}>
              <summary style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontWeight: 'bold' }}>
                ▼ デバッグ用: AIに渡された前処理済み画像 (白黒反転)
              </summary>
              <div style={{ marginTop: '12px' }}>
                <img src={debugUrl} alt="Debug View" style={{ width: '100%', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)' }} />
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

        {!isAnalyzing && parsedItems.length > 0 && wizardStep === 0 && (
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

      {/* 端末確認モーダル */}
      {deviceConfirm && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="glass-panel" style={{ padding: '24px', maxWidth: '400px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, marginBottom: '16px' }}>端末の確認</h3>
            <p style={{ marginBottom: '24px' }}>
              あなたが使用しているのは <strong>{deviceConfirm.deviceName}</strong> ですか？
            </p>
            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
              <button className="btn" onClick={() => handleConfirmDevice(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }}>
                いいえ
              </button>
              <button className="btn" onClick={() => handleConfirmDevice(true)} style={{ flex: 1, background: 'var(--accent-color)', color: '#fff' }}>
                はい
              </button>
            </div>
          </div>
        </div>
      )}

      {/* インポートモーダル */}
      {showImportDialog && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="glass-panel" style={{ padding: '24px', width: '100%', maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>設定のインポート</h3>
              <button onClick={() => setShowImportDialog(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            <p style={{ fontSize: '0.9em', color: 'rgba(255,255,255,0.7)', marginBottom: '12px' }}>
              エクスポートしたJSONデータを貼り付けてください。
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              style={{
                width: '100%', height: '150px', padding: '12px',
                background: 'rgba(0,0,0,0.3)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px',
                fontFamily: 'monospace', resize: 'vertical', marginBottom: '16px'
              }}
              placeholder='{"startX1": ...}'
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn" onClick={() => setShowImportDialog(false)} style={{ background: 'rgba(255,255,255,0.1)' }}>
                キャンセル
              </button>
              <button className="btn" onClick={handleImport} style={{ background: '#51cf66', color: '#111', fontWeight: 'bold' }}>
                インポート実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* トースト通知 */}
      {toastMsg && (
        <div style={{
          position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30, 30, 40, 0.95)', border: '1px solid var(--accent-color)',
          padding: '12px 24px', borderRadius: '30px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 3000, color: '#fff', fontWeight: 'bold', animation: 'fadeInDown 0.3s ease-out'
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default App;
