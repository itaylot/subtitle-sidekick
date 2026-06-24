// offscreen.js — לב מסלול האודיו + חיבור WebSocket עם reconnection.
//
// מקבל streamId → MediaStream → AudioContext + AudioWorklet → PCM → WebSocket → טקסט.
// האודיו מוקם פעם אחת ונשאר חי גם אם ה-WebSocket מתנתק; הניתוק מטופל ב-reconnection.
//
// ⚠️ ה-offscreen לא נוגע ב-DOM של הדף. טקסט/סטטוס חוזרים דרך ה-service worker.

let audioContext = null;
let workletNode = null;
let sourceNode = null;
let ws = null;
let mediaStream = null;

let currentConfig = null;
let currentTabId = null;
let stopping = false;
let endedReported = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT = 5;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'START') {
    start(msg.streamId, msg.config).catch((e) => {
      console.error('[offscreen] start failed:', e);
      sendStatus('error', 'שגיאה בהפעלת הלכידה: ' + e.message);
      reportEnded('error');
    });
  } else if (msg.type === 'STOP') {
    stop();
    reportEnded('stopped');
  }
});

async function start(streamId, config) {
  currentConfig = config;
  currentTabId = config.tabId;
  stopping = false;
  endedReported = false;
  reconnectAttempts = 0;

  // 1. MediaStream מתוך ה-streamId (tab capture)
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    },
    video: false,
  });

  // 2. AudioContext ב-16kHz (בלי resampling ידני)
  audioContext = new AudioContext({ sampleRate: 16000 });
  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  // 3. AudioWorklet (קובץ נפרד, נטען דרך getURL)
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL('pcm-processor.js'));
  workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

  // 4. source → worklet (PCM) + source → destination (שמיעה! קריטי)
  sourceNode.connect(workletNode);
  sourceNode.connect(audioContext.destination);

  // 5. PCM מה-worklet → WebSocket (בזמן ניתוק ה-frame פשוט נזרק)
  workletNode.port.onmessage = (e) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
  };

  console.log('[offscreen] audio ready @', audioContext.sampleRate, 'Hz');
  connectWs();
}

// ── חיבור WebSocket (עם reconnection) ─────────────────────
function connectWs() {
  sendStatus('connecting', reconnectAttempts ? 'מתחבר מחדש…' : 'מתחבר לשרת התמלול…');
  try {
    ws = new WebSocket(currentConfig.endpoint);
  } catch (e) {
    console.error('[offscreen] ws ctor failed:', e);
    scheduleReconnect();
    return;
  }
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    reconnectAttempts = 0;
    ws.send(JSON.stringify({
      language: currentConfig.language,
      sample_rate: currentConfig.sampleRate,
      encoding: currentConfig.encoding,
    }));
    sendStatus('connected', ''); // טקסט ריק → ה-content מסתיר את ההודעה
    console.log('[offscreen] ws connected →', currentConfig.endpoint);
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (typeof data.text !== 'string') return;
    const isFinal = data.type === 'final' || data.is_final === true; // חוזה B
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPT',
      from: 'offscreen',
      tabId: currentTabId,
      text: data.text,
      isFinal,
    });
  };

  ws.onerror = () => {
    /* onclose יטפל בלוגיקת ההתאוששות */
  };
  ws.onclose = () => {
    if (stopping) return; // סגירה יזומה — לא לנסות שוב
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (stopping) return;
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT) {
    sendStatus('error', 'שרת התמלול לא זמין. בדוק שהשרת פועל ונסה שוב.');
    stop();
    reportEnded('server-unavailable');
    return;
  }
  // backoff מדורג: 1, 2, 4, 8, 8 שניות
  const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 8000);
  sendStatus('reconnecting', `החיבור נפל — מנסה להתחבר מחדש (${reconnectAttempts}/${MAX_RECONNECT})…`);
  reconnectTimer = setTimeout(connectWs, delay);
}

function stop() {
  stopping = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
  }
  if (sourceNode) sourceNode.disconnect();
  if (ws) {
    ws.onclose = null; // שלא יפעיל reconnect
    try {
      ws.close();
    } catch {}
  }
  if (audioContext) audioContext.close().catch(() => {});
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  audioContext = workletNode = sourceNode = ws = mediaStream = null;
}

// סטטוס חיבור → ה-SW → ה-content (להצגת הודעה למשתמש)
function sendStatus(status, message) {
  chrome.runtime.sendMessage({
    type: 'CAPTURE_STATUS',
    from: 'offscreen',
    tabId: currentTabId,
    status, // 'connecting' | 'connected' | 'reconnecting' | 'error'
    message,
  });
}

// מודיע ל-SW שהלכידה הסתיימה (לעדכון מצב הכפתור). פעם אחת.
function reportEnded(reason) {
  if (endedReported) return;
  endedReported = true;
  chrome.runtime.sendMessage({
    type: 'CAPTURE_ENDED',
    from: 'offscreen',
    tabId: currentTabId,
    reason,
  });
}
