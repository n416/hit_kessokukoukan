import { PaddleOCR } from "@paddleocr/paddleocr-js";

export interface ParsedItem {
  name: string;
  count: number;
}

export interface AnalyzeResult {
  items: ParsedItem[];
  debugUrl?: string;
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

// アイテムを検索するためのキーワード（短縮形）
const ITEM_KEYWORDS = [
  ["赤色", "赤"],
  ["橙色", "橙"],
  ["黄色", "黄"],
  ["緑色", "緑"],
  ["青色", "青"],
  ["紫色", "紫"],
  ["銀色", "銀"],
  ["虹色", "虹"]
];

async function loadImageAndCreateCanvas(file: File): Promise<{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      resolve({ canvas, ctx });
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = url;
  });
}

export async function analyzeImageAuto(
  file: File, 
  onProgress?: (msg: string) => void
): Promise<AnalyzeResult> {
  onProgress?.('OCRワーカーを初期化中...');
  const ocr = await PaddleOCR.create({
    lang: "en", // 日本語（アイテム名）も読むなら "ch" の方が精度が良い場合があるが、まずはデフォルト
    ocrVersion: "PP-OCRv5",
    worker: true,
    ortOptions: {
      backend: "wasm",
      wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/"
    }
  });

  onProgress?.('画像の前処理（二値化）を行っています...');
  const { canvas, ctx } = await loadImageAndCreateCanvas(file);
  
  // 元実装の白黒二値化処理（白と赤の文字のみを残す）
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i+1];
    const b = data[i+2];
    
    const maxColor = Math.max(r, g, b);
    const minColor = Math.min(r, g, b);
    
    // 白っぽい文字（グレーでも残すように閾値を下げる）
    const isWhiteText = r > 100 && g > 100 && b > 100 && (maxColor - minColor < 50);
    // 赤文字
    const isRedText = r > 100 && g < 80 && b < 80;
    // (任意で黄色なども残せますが、まずは元実装に忠実に白と赤のみとします)
    
    if (isWhiteText || isRedText) {
      data[i] = 0;
      data[i+1] = 0;
      data[i+2] = 0;
    } else {
      data[i] = 255;
      data[i+1] = 255;
      data[i+2] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const processedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas to Blob failed"));
    }, 'image/png');
  });

  onProgress?.('画像全体を解析中...');
  const [result] = await ocr.predict(processedBlob);

  ctx.lineWidth = 2;
  ctx.font = '20px Arial';

  // すべての検出領域をデバッグキャンバスに描画
  for (const item of (result?.items || [])) {
    // 枠を赤で描画
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.moveTo(item.poly[0][0], item.poly[0][1]);
    ctx.lineTo(item.poly[1][0], item.poly[1][1]);
    ctx.lineTo(item.poly[2][0], item.poly[2][1]);
    ctx.lineTo(item.poly[3][0], item.poly[3][1]);
    ctx.closePath();
    ctx.stroke();

    // テキストを黄色の文字で描画（背景を半透明の黒にして見やすく）
    const textW = ctx.measureText(item.text).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(item.poly[0][0], item.poly[0][1] - 22, textW + 4, 24);
    ctx.fillStyle = '#ffff00';
    ctx.fillText(item.text, item.poly[0][0] + 2, item.poly[0][1] - 4);
  }

  const parsedItems: ParsedItem[] = EXPECTED_ITEMS.map(name => ({ name, count: 0 }));

  // 各テキスト領域の中心座標を計算しておく
  const itemsWithCenter = (result?.items || []).map(item => {
    const xs = item.poly.map(p => p[0]);
    const ys = item.poly.map(p => p[1]);
    return {
      ...item,
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  });

  // 個数らしいテキスト（数字と/）を持つ要素を抽出
  const numberItems = itemsWithCenter.filter(item => {
    const t = item.text.replace(/\s/g, '');
    // 最低限数字が含まれていること
    return /\d/.test(t) && !/[あ-んア-ンa-zA-Z]/.test(t.replace(/[lI]/g, '')); // lやIは1の誤認識として許容
  }).map(item => {
    let count = 0;
    const t = item.text.replace(/\s/g, '');
    const match = t.match(/(\d+)[\/\]]*[1IlI]?$/);
    if (match) {
      count = parseInt(match[1], 10);
    } else {
      const fallback = t.match(/(\d+)/);
      if (fallback) {
        count = parseInt(fallback[1], 10);
      }
    }
    return { ...item, count, cleanText: t };
  });

  // 1. キーワードベースでの紐付けを試みる
  let foundByKeyword = 0;
  for (let i = 0; i < EXPECTED_ITEMS.length; i++) {
    const keywords = ITEM_KEYWORDS[i];
    const labelItem = itemsWithCenter.find(it => keywords.some(kw => it.text.includes(kw)));
    
    if (labelItem) {
      // ラベルの「すぐ下」にある数字を探す
      // X座標が近く（ラベルの幅の半分以内）、Y座標がラベルより大きいもの
      const candidateNumbers = numberItems.filter(num => 
        num.cy > labelItem.cy && 
        Math.abs(num.cx - labelItem.cx) < labelItem.w
      ).sort((a, b) => a.cy - b.cy); // 最もYが近いもの

      if (candidateNumbers.length > 0) {
        parsedItems[i].count = candidateNumbers[0].count;
        foundByKeyword++;
        console.log(`[Keyword] ${EXPECTED_ITEMS[i]} -> ${candidateNumbers[0].count} (text: ${candidateNumbers[0].cleanText})`);
      }
    }
  }

  // もしキーワードで全然見つからなかった場合（PaddleOCR(en)で日本語が読めなかった場合など）、座標ベースの推測を行う
  if (foundByKeyword < 4 && numberItems.length >= 8) {
    console.log(`[Fallback] 座標ベースの推測に切り替えます。`);
    // 画面内の数字をY座標でソート
    const sortedByY = [...numberItems].sort((a, b) => a.cy - b.cy);
    
    // Y座標のギャップが大きいところで上段と下段に分ける
    let maxGap = 0;
    let splitIndex = 4; // デフォルトは4個/4個
    for (let i = 1; i < sortedByY.length; i++) {
      const gap = sortedByY[i].cy - sortedByY[i-1].cy;
      if (gap > maxGap && i >= 4 && sortedByY.length - i >= 4) {
        maxGap = gap;
        splitIndex = i;
      }
    }

    const topRow = sortedByY.slice(0, splitIndex).sort((a, b) => a.cx - b.cx).slice(0, 4); // 上段をXでソート
    const bottomRow = sortedByY.slice(splitIndex).sort((a, b) => a.cx - b.cx).slice(0, 4); // 下段をXでソート

    // 画面の配置仕様（左から 赤・黄・青・銀 / 橙・緑・紫・虹）
    // targetIndex: 
    // 上段: 0(赤), 2(黄), 4(青), 6(銀)
    // 下段: 1(橙), 3(緑), 5(紫), 7(虹)
    if (topRow.length === 4 && bottomRow.length === 4) {
      parsedItems[0].count = topRow[0].count;
      parsedItems[2].count = topRow[1].count;
      parsedItems[4].count = topRow[2].count;
      parsedItems[6].count = topRow[3].count;

      parsedItems[1].count = bottomRow[0].count;
      parsedItems[3].count = bottomRow[1].count;
      parsedItems[5].count = bottomRow[2].count;
      parsedItems[7].count = bottomRow[3].count;
      
      console.log(`[Fallback] 座標ベースの割り当てが完了しました。`);
    }
  }

  await ocr.dispose();
  onProgress?.(`解析完了`);
  return { items: parsedItems, debugUrl: canvas.toDataURL('image/png') };
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
