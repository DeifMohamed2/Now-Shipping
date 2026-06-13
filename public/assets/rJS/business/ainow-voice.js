/**
 * AINOW professional voice recorder — pause/resume, waveform analyser, session API.
 */
(function (window) {
  'use strict';

  let mediaRecorder = null;
  let audioChunks = [];
  let stream = null;
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let state = 'idle'; // idle | recording | paused
  let startTime = 0;
  let pausedTotalMs = 0;
  let pauseStartedAt = 0;
  let mimeType = 'audio/webm';
  let pauseSupported = true;

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function pickMimeType() {
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
    return 'audio/webm';
  }

  function setupAnalyser(mediaStream) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioContext = new Ctx();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.75;
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    sourceNode.connect(analyser);
  }

  function teardownAnalyser() {
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch (e) { /* ignore */ }
      sourceNode = null;
    }
    analyser = null;
    if (audioContext) {
      audioContext.close().catch(function () {});
      audioContext = null;
    }
  }

  function releaseStream() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
  }

  function createRecorder() {
    mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
  }

  async function startSession() {
    if (state !== 'idle') await cancel();

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mimeType = pickMimeType();
    audioChunks = [];
    setupAnalyser(stream);
    createRecorder();

    pauseSupported = typeof mediaRecorder.pause === 'function';
    mediaRecorder.start(200);
    state = 'recording';
    startTime = Date.now();
    pausedTotalMs = 0;
    pauseStartedAt = 0;
  }

  function pause() {
    if (state !== 'recording' || !mediaRecorder) return;
    if (pauseSupported) {
      mediaRecorder.pause();
    } else {
      mediaRecorder.stop();
      mediaRecorder = null;
    }
    pauseStartedAt = Date.now();
    state = 'paused';
  }

  function resume() {
    if (state !== 'paused' || !stream) return;
    if (pauseStartedAt) {
      pausedTotalMs += Date.now() - pauseStartedAt;
      pauseStartedAt = 0;
    }
    if (pauseSupported && mediaRecorder) {
      mediaRecorder.resume();
    } else {
      createRecorder();
      mediaRecorder.start(200);
    }
    state = 'recording';
  }

  function getElapsedMs() {
    if (state === 'idle') return 0;
    let elapsed = Date.now() - startTime - pausedTotalMs;
    if (state === 'paused' && pauseStartedAt) {
      elapsed -= Date.now() - pauseStartedAt;
    }
    return Math.max(0, elapsed);
  }

  function getFrequencyData() {
    if (!analyser) return new Uint8Array(16).fill(0);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    return buf;
  }

  function getState() {
    return state;
  }

  function stopAndGetBlob() {
    return new Promise(function (resolve, reject) {
      if (state === 'idle' || !mediaRecorder) {
        reject(new Error('Not recording'));
        return;
      }

      if (state === 'paused') resume();

      mediaRecorder.onstop = function () {
        const blob = new Blob(audioChunks, { type: mimeType.split(';')[0] || 'audio/webm' });
        releaseStream();
        teardownAnalyser();
        mediaRecorder = null;
        audioChunks = [];
        state = 'idle';
        resolve(blob);
      };

      try {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        else mediaRecorder.onstop();
      } catch (err) {
        releaseStream();
        teardownAnalyser();
        state = 'idle';
        reject(err);
      }
    });
  }

  async function cancel() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
    }
    releaseStream();
    teardownAnalyser();
    mediaRecorder = null;
    audioChunks = [];
    state = 'idle';
    startTime = 0;
    pausedTotalMs = 0;
    pauseStartedAt = 0;
  }

  window.AinowVoice = {
    isSupported: isSupported,
    startSession: startSession,
    pause: pause,
    resume: resume,
    stopAndGetBlob: stopAndGetBlob,
    cancel: cancel,
    getFrequencyData: getFrequencyData,
    getElapsedMs: getElapsedMs,
    getState: getState,
  };
})(window);
