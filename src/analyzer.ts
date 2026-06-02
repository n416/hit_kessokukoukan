import Tesseract from "tesseract.js";

export interface ParsedItem {
  name: string;
  count: number;
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

/**
 * 結束の証明画面から、8つのアイテム領域の正確な比率を計算して個別にクロップする
 */
async function preprocessImages(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Canvas ctx not found'));

      const results: string[] = [];

      const positions = [
        [0.13, 0.34], // 1. 赤 (左端 上)
        [0.13, 0.47], // 2. 橙 (左端 下)
        [0.26, 0.34], // 3. 黄 (左中央 上)
        [0.26, 0.47], // 4. 緑 (左中央 下)
        [0.74, 0.34], // 5. 青 (右中央 上)
        [0.74, 0.47], // 6. 紫 (右中央 下)
        [0.86, 0.34], // 7. 銀 (右端 上)
        [0.86, 0.47]  // 8. 虹 (右端 下)
      ];

      // 8分割用に戻す。高さは半分に
      const cropW = img.width * 0.12;
      const cropH = img.height * 0.14;

      // 高解像度環境対応: クロップ後の幅が小さい場合のみ拡大
      const scale = cropW < 250 ? 2.5 : 1.5;

      for (let i = 0; i < 8; i++) {
        const [cx, cy] = positions[i];
        const startX = Math.max(0, img.width * cx - cropW / 2);
        const startY = Math.max(0, img.height * cy - cropH / 2);

        canvas.width = cropW * scale;
        canvas.height = cropH * scale;

        ctx.fillStyle = "white"; // 背景を白で初期化
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(img, startX, startY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        // 白黒反転（明るい文字を黒、暗い背景を白に）
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let j = 0; j < data.length; j += 4) {
          const r = data[j];
          const g = data[j + 1];
          const b = data[j + 2];
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          
          // 赤い文字（所持数0などの警告色）は輝度(gray)が低く背景の暗さと同化して飛んでしまう。
          // そのため、R成分が他の成分より突出して高い場合は「赤文字」として特別に救済する。
          const isRed = (r - g > 40) && (r - b > 40) && r > 100;
          
          // 緑や白の文字は輝度が高い(gray>90)ので拾う。赤文字はisRedで拾う。
          const v = (gray > 90 || isRed) ? 0 : 255;
          data[j] = v;
          data[j + 1] = v;
          data[j + 2] = v;
        }
        ctx.putImageData(imageData, 0, 0);

        results.push(canvas.toDataURL('image/png'));
      }

      resolve(results);
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = url;
  });
}

/**
 * 8枚の画像それぞれに対して個別にOCRを実行し、個数を抽出する
 */
export async function analyzeImage(
  imageFile: File,
  onProgress: (msg: string) => void,
  onDebugImages?: (urls: string[]) => void
): Promise<ParsedItem[]> {
  onProgress("画像を8つのアイテム領域に分割しています...");
  let imageList: string[] = [];
  try {
    imageList = await preprocessImages(imageFile);
    if (onDebugImages) onDebugImages(imageList);
  } catch (e) {
    console.error("画像分割に失敗", e);
    throw e;
  }

  onProgress("OCRエンジンを準備しています...");
  const worker = await Tesseract.createWorker("jpn", 1, {
    logger: m => {
      if (m.status === "recognizing text") {
        onProgress(`OCR実行中... ${Math.round(m.progress * 100)}%`);
      }
    }
  });

  const parsedItems: ParsedItem[] = [];

  for (let i = 0; i < imageList.length; i++) {
    onProgress(`${EXPECTED_ITEMS[i]} を読み取っています... (${i + 1}/8)`);
    const tesseractResult = await worker.recognize(imageList[i]);
    const text = tesseractResult.data.text;
    console.log(`OCR Result ${i + 1}:`, text);

    // "32/1" などの文字列から最初の数字（所持数）を抽出
    const match = text.match(/(\d+)\s*\/\s*[1I]/);
    let count = 0;
    if (match) {
      count = parseInt(match[1], 10);
    } else {
      // もし赤い文字が飛んだり認識に失敗して「/1」だけが残った場合、所持数0とする安全策
      if (text.match(/\/\s*[1I]/)) {
        count = 0;
      } else {
        const fallbackMatch = text.match(/\d+/);
        count = fallbackMatch ? parseInt(fallbackMatch[0], 10) : 0;
      }
    }

    parsedItems.push({
      name: EXPECTED_ITEMS[i],
      count
    });
  }

  await worker.terminate();
  return parsedItems;
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
