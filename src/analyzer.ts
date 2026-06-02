import Tesseract from "tesseract.js";

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ParsedItem {
  name: string;
  count: number;
  bbox?: BBox;
}

export interface AnalyzeResult {
  items: ParsedItem[];
  debugUrl?: string;
  extractedUrls?: string[];
}

export interface ExchangeStep {
  from: string;
  to: string;
  amount: number;
}

const EXPECTED_ITEMS = [
  "赤色のキューブ(キャラ帰属)",
  "橙色のキューブ(キャラ帰属)",
  "黄色のキューブ(キャラ帰属)",
  "緑色のキューブ(キャラ帰属)",
  "青色のキューブ(キャラ帰属)",
  "紫色のキューブ(キャラ帰属)",
  "銀色のキューブ(キャラ帰属)",
  "虹色のキューブ(キャラ帰属)"
];

export interface CalibrationData {
  startX1: number; // 左ブロック開始X（左外）
  startX2: number; // 右ブロック開始X（右内）
  startY: number;
  stepX: number;
  stepY: number;
  cropW: number;
  cropH: number;
}

// ユーザー環境: 中央に大きな盾があるため、等間隔の4列ではない。
// 左ブロック(col=0, 1) と 右ブロック(col=2, 3) に分かれている。
const GRID_MAPPING = [
  { col: 0, row: 0, targetIndex: 0 }, // 左上外: 赤
  { col: 1, row: 0, targetIndex: 2 }, // 左上内: 黄
  { col: 0, row: 1, targetIndex: 1 }, // 左下外: 橙
  { col: 1, row: 1, targetIndex: 3 }, // 左下内: 緑
  { col: 2, row: 0, targetIndex: 4 }, // 右上内: 青
  { col: 3, row: 0, targetIndex: 6 }, // 右上外: 銀
  { col: 2, row: 1, targetIndex: 5 }, // 右下内: 紫
  { col: 3, row: 1, targetIndex: 7 }  // 右下外: 虹
];

export async function extractNumberAreasWithCalibration(file: File, calib: CalibrationData): Promise<{ urls: string[], debugUrl: string, orderedTargets: typeof GRID_MAPPING }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Canvas ctx not found'));

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const debugCanvas = document.createElement('canvas');
      debugCanvas.width = canvas.width;
      debugCanvas.height = canvas.height;
      const dCtx = debugCanvas.getContext('2d')!;
      dCtx.drawImage(canvas, 0, 0);
      // 背景を暗くして、切り抜き部分を目立たせる
      dCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      dCtx.fillRect(0, 0, canvas.width, canvas.height);
      
      dCtx.strokeStyle = 'red';
      dCtx.lineWidth = 4;

      const resultUrls: string[] = [];

      for (const grid of GRID_MAPPING) {
        // 左グループ（col: 0, 1）か右グループ（col: 2, 3）かで基準Xを切り替える
        const baseX = grid.col < 2 ? calib.startX1 : calib.startX2;
        // グループ内でのインデックス（0 または 1）
        const subCol = grid.col % 2;
        
        const startX = Math.max(0, baseX + calib.stepX * subCol);
        const startY = Math.max(0, calib.startY + calib.stepY * grid.row);

        const cropCanvas = document.createElement('canvas');
        const scale = 3.0;
        cropCanvas.width = calib.cropW * scale;
        cropCanvas.height = calib.cropH * scale;
        const cCtx = cropCanvas.getContext('2d')!;
        
        // 拡大時に画像がぼやけて文字の色が薄まるのを防ぐ
        cCtx.imageSmoothingEnabled = false;
        
        cCtx.fillStyle = 'white';
        cCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
        cCtx.drawImage(canvas, startX, startY, calib.cropW, calib.cropH, 0, 0, cropCanvas.width, cropCanvas.height);

        const cropData = cCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
        for (let j = 0; j < cropData.data.length; j += 4) {
          const r = cropData.data[j];
          const g = cropData.data[j+1];
          const b = cropData.data[j+2];
          
          const maxColor = Math.max(r, g, b);
          const minColor = Math.min(r, g, b);
          
          // 白っぽい文字（グレーでも残すように閾値を下げる）
          const isWhiteText = r > 100 && g > 100 && b > 100 && (maxColor - minColor < 50);
          // 赤文字
          const isRedText = r > 100 && g < 80 && b < 80;
          
          if (isWhiteText || isRedText) {
            // 文字を黒(0)にする
            cropData.data[j] = 0;
            cropData.data[j+1] = 0;
            cropData.data[j+2] = 0;
          } else {
            // 背景やノイズを白(255)にする
            cropData.data[j] = 255;
            cropData.data[j+1] = 255;
            cropData.data[j+2] = 255;
          }
        }
        cCtx.putImageData(cropData, 0, 0);

        // デバッグキャンバスに、白黒反転した画像を実寸で描き戻す
        dCtx.drawImage(cropCanvas, 0, 0, cropCanvas.width, cropCanvas.height, startX, startY, calib.cropW, calib.cropH);
        
        // AIが読み取る枠をそのまま描画
        dCtx.strokeStyle = 'red';
        dCtx.strokeRect(startX, startY, calib.cropW, calib.cropH);

        resultUrls.push(cropCanvas.toDataURL('image/png'));
      }

      resolve({ urls: resultUrls, debugUrl: debugCanvas.toDataURL('image/png'), orderedTargets: GRID_MAPPING });
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = url;
  });
}

export async function analyzeImageAuto(
  file: File, 
  calib: CalibrationData,
  onProgress?: (msg: string) => void
): Promise<AnalyzeResult> {
  onProgress?.('指定された座標で画像をクロップしています...');
  const { urls, debugUrl, orderedTargets } = await extractNumberAreasWithCalibration(file, calib);

  onProgress?.('OCRワーカーを初期化中...');
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: m => {
      if (m.status === "recognizing text") {
        onProgress?.(`OCR解析中... ${Math.round(m.progress * 100)}%`);
      }
    }
  });

  await worker.setParameters({
    tessedit_char_whitelist: '0123456789/',
  });

  const parsedItems: ParsedItem[] = EXPECTED_ITEMS.map(name => ({ name, count: 0 }));

  for (let i = 0; i < urls.length; i++) {
    const targetIndex = orderedTargets[i].targetIndex;
    const targetName = EXPECTED_ITEMS[targetIndex];
    
    onProgress?.(`${targetName} の数字を解析中... (${i+1}/8)`);
    const { data } = await worker.recognize(urls[i]);
    
    // 空白や改行で単語ごとに分割
    const chunks = data.text.trim().split(/\s+/);
    
    // ユーザー様の「最後は必ず/1」という仕様と、Tesseractの「改行で区切る」性質を利用し、
    // 画像内の日本語が化けた巨大なノイズ（上の行）を無視して、一番最後のチャンク（一番下の行）だけを採用します。
    let reliableText = "";
    if (chunks.length > 0) {
       reliableText = chunks[chunks.length - 1];
    } else {
       reliableText = data.text.replace(/\s/g, '');
    }
    
    console.log(`OCR ${i+1} (${targetName}): ${reliableText}`);

    let count = 0;
    
    // 信頼できる文字だけが抽出された状態なら、ノイズの「7」は分離されているはず。
    const match = reliableText.match(/(\d+)[\/\]]*[1IlI]?$/);
    
    if (match) {
      count = parseInt(match[1], 10);
    } else {
      const fallback = reliableText.match(/(\d+)/);
      if (fallback) {
        count = parseInt(fallback[1], 10);
      }
    }

    parsedItems[targetIndex].count = count;
  }

  await worker.terminate();
  onProgress?.(`解析完了`);
  return { items: parsedItems, debugUrl };
}

export function calculateExchangePlan(items: ParsedItem[]): ExchangeStep[] {
  if (items.length === 0) return [];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const target = Math.floor(total / items.length);

  const surplus: { name: string; amount: number }[] = [];
  const deficit: { name: string; amount: number }[] = [];

  for (const item of items) {
    if (item.count > target) {
      surplus.push({ name: item.name, amount: item.count - target });
    } else if (item.count < target) {
      deficit.push({ name: item.name, amount: target - item.count });
    }
  }

  // 多い順、足りない順に処理して交換回数を減らす
  surplus.sort((a, b) => b.amount - a.amount);
  deficit.sort((a, b) => b.amount - a.amount);

  const steps: ExchangeStep[] = [];
  let sIdx = 0;
  let dIdx = 0;

  while (sIdx < surplus.length && dIdx < deficit.length) {
    const sItem = surplus[sIdx];
    const dItem = deficit[dIdx];

    const amount = Math.min(sItem.amount, dItem.amount);
    
    if (amount > 0) {
      steps.push({
        from: sItem.name,
        to: dItem.name,
        amount
      });
    }

    sItem.amount -= amount;
    dItem.amount -= amount;

    if (sItem.amount === 0) sIdx++;
    if (dItem.amount === 0) dIdx++;
  }

  return steps;
}
