// Barcode-Scanner über die Kamera. Safari hat keinen nativen BarcodeDetector,
// daher wird bei Bedarf die lokal mitgelieferte ZXing-Bibliothek (WebAssembly) geladen.
let detectorPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Scanner-Bibliothek konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

async function getDetector() {
  detectorPromise ??= (async () => {
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (formats.some(f => supported.includes(f))) return new window.BarcodeDetector({ formats: formats.filter(f => supported.includes(f)) });
      } catch { /* Fallback unten */ }
    }
    await loadScript('vendor/barcode-detector.js');
    const api = window.BarcodeDetectionAPI;
    api.setZXingModuleOverrides({ locateFile: (path, prefix) => (path.endsWith('.wasm') ? new URL('vendor/zxing_reader.wasm', location.href).href : prefix + path) });
    return new api.BarcodeDetector({ formats });
  })();
  try { return await detectorPromise; } catch (e) { detectorPromise = null; throw e; }
}

/**
 * Startet den Scanner in `video`. Ruft onCode(code) beim ersten Treffer auf.
 * Gibt eine stop()-Funktion zurück.
 */
export async function startScanner(video, onCode, onError) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Die Kamera ist in diesem Browser nicht verfügbar.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
  });
  let stopped = false;
  const stop = () => { stopped = true; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});
  let detector;
  try { detector = await getDetector(); } catch (e) { stop(); throw e; }
  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
        const hit = codes.find(c => /^\d{8,14}$/.test(c.rawValue));
        if (hit && !stopped) { stop(); onCode(hit.rawValue); return; }
      }
    } catch (e) { onError?.(e); }
    setTimeout(tick, 180);
  };
  tick();
  return stop;
}
