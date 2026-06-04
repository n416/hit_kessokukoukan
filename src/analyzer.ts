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

  // ========== 新しい数理計算的アプローチ（地点ベース） ==========
  
  // 1. アイテム候補地を探す
  // 「色」「帰属」「/1」「キュ」などのキーワードを少しでも含むブロックを抽出
  // これにより、画面上部のダイヤや下部のポイントなどの無関係な数字を排除する
  const candidateBlocks = itemsWithCenter.filter(item => 
    /色|帰属|\/1|キュ/.test(item.text)
  );

  let isGridBasedSuccess = false;

  if (candidateBlocks.length > 0) {
    console.log(`[Grid] 候補ブロックを ${candidateBlocks.length} 個検出しました。`);
    
    // 2. Y座標でクラスタリングして行（Row）を特定する
    const sortedByY = [...candidateBlocks].sort((a, b) => a.cy - b.cy);
    
    let maxGap = 0;
    let splitIdx = Math.floor(sortedByY.length / 2); // デフォルトは半分
    // 行間のギャップを探す
    for (let i = 1; i < sortedByY.length; i++) {
      const gap = sortedByY[i].cy - sortedByY[i-1].cy;
      // 候補数が多い場合、少なくとも各行に数個（たとえば3〜4個）はあると想定
      if (gap > maxGap && i >= 3 && sortedByY.length - i >= 3) {
        maxGap = gap;
        splitIdx = i;
      }
    }

    const topRowBlocks = sortedByY.slice(0, splitIdx);
    const bottomRowBlocks = sortedByY.slice(splitIdx);

    // 3. 各行をX座標でクラスタリングして列（Column）を特定する
    topRowBlocks.sort((a, b) => a.cx - b.cx);
    bottomRowBlocks.sort((a, b) => a.cx - b.cx);

    const groupToColumns = (blocks: typeof itemsWithCenter) => {
      const columns: (typeof itemsWithCenter)[] = [];
      if (blocks.length === 0) return columns;
      
      let currentColumn = [blocks[0]];
      for (let i = 1; i < blocks.length; i++) {
        // X座標が近ければ（150px以内）同じカラムとみなす
        if (Math.abs(blocks[i].cx - currentColumn[0].cx) < 150) {
          currentColumn.push(blocks[i]);
        } else {
          columns.push(currentColumn);
          currentColumn = [blocks[i]];
        }
      }
      columns.push(currentColumn);
      return columns;
    };

    const topColumns = groupToColumns(topRowBlocks);
    const bottomColumns = groupToColumns(bottomRowBlocks);

    console.log(`[Grid] クラスタリング結果: 上段 ${topColumns.length} 列, 下段 ${bottomColumns.length} 列`);

    // 4. 8箇所の地点（top: 4, bottom: 4）が確定したら、それぞれの地点から数字を抜き出す
    if (topColumns.length >= 4 && bottomColumns.length >= 4) {
      console.log("[Grid] 8箇所のグリッド（地点）の特定に成功しました。数値を抽出します。");
      
      // 左から4つずつ取得（もし余分なノイズ列があれば捨てる）
      const grid = [
        ...topColumns.slice(0, 4),    // 0:赤, 1:黄, 2:青, 3:銀
        ...bottomColumns.slice(0, 4)  // 4:橙, 5:緑, 6:紫, 7:虹
      ];
      
      // 画面の配置仕様（左から 赤・黄・青・銀 / 橙・緑・紫・虹）
      const mapGridToIndex = [0, 2, 4, 6, 1, 3, 5, 7];

      for (let i = 0; i < 8; i++) {
        const columnBlocks = grid[i]; // 同じ地点にあるブロックの配列
        let count = -1;

        // カラム内のすべてのテキストを結合して数字を探す
        const combinedText = columnBlocks.map(b => b.text).join('');
        // 「数字 + /1」のパターンを探す
        const match = combinedText.replace(/\s/g, '').match(/(\d+)[\/\]]+[1IlI]/);
        
        if (match) {
          count = parseInt(match[1], 10);
        } else {
          // もし /1 が見つからなかったら、純粋な数字らしき文字列を探す
          const fallbackMatch = combinedText.replace(/\s/g, '').match(/(\d+)/);
          if (fallbackMatch) {
            count = parseInt(fallbackMatch[1], 10);
          }
        }

        if (count !== -1) {
          const targetIndex = mapGridToIndex[i];
          parsedItems[targetIndex].count = count;
          console.log(`[Grid] 地点 ${i} -> ${EXPECTED_ITEMS[targetIndex]}: ${count} (source text: ${combinedText})`);
        } else {
          console.log(`[Grid] 地点 ${i} から数値を抽出できませんでした (source text: ${combinedText})`);
        }
      }
      isGridBasedSuccess = true;
    } else {
      console.log("[Grid] 8箇所の特定に失敗しました（列数が足りません）。フォールバックが必要です。");
    }
  }

  // 5. グリッドの特定に失敗した場合のフォールバック（旧キーワード方式の強化版）
  if (!isGridBasedSuccess) {
    console.log(`[KeywordFallback] グリッドベースでの割り当てができないため、キーワードベースの推測に切り替えます。`);
    
    const numberItems = itemsWithCenter.filter(item => {
      const t = item.text.replace(/\s/g, '');
      return /\d/.test(t) && !/[あ-んア-ンa-zA-Z]/.test(t.replace(/[lI]/g, ''));
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

    for (let i = 0; i < EXPECTED_ITEMS.length; i++) {
      const keywords = ITEM_KEYWORDS[i];
      const labelItem = itemsWithCenter.find(it => keywords.some(kw => it.text.includes(kw)));
      
      if (labelItem) {
        let count = -1;

        // まず、ラベルテキスト自身の中に数字（例: "28/1"）が埋め込まれていないかチェック
        const textNoSpace = labelItem.text.replace(/\s/g, '');
        const selfMatch = textNoSpace.match(/(\d+)[\/\]]+[1IlI]/);
        if (selfMatch) {
          count = parseInt(selfMatch[1], 10);
        }

        if (count === -1) {
          const candidateNumbers = numberItems.filter(num => 
            num.cy > labelItem.cy - 10 && 
            Math.abs(num.cx - labelItem.cx) < labelItem.w
          ).sort((a, b) => a.cy - b.cy);

          if (candidateNumbers.length > 0) {
            count = candidateNumbers[0].count;
          }
        }

        if (count !== -1) {
          parsedItems[i].count = count;
          console.log(`[KeywordFallback] ${EXPECTED_ITEMS[i]} -> ${count} (text: ${labelItem.text})`);
        }
      }
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
