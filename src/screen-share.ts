import { watchStats } from './stats';
import { type DataConnection, type MediaConnection } from 'peerjs';
import { stop } from './devices';
import { createPeer, message, preferVideoCodecs, ROOM_ID, videoBitrate } from './peer';

export function screenShare(
  onStatus: (text: string) => void,
  onReady: (ready: boolean) => void,
  onSharing: (sharing: boolean) => void,
) {
  const peer = createPeer();
  let data: DataConnection | undefined;
  let call: MediaConnection | undefined;
  let stream: MediaStream | undefined;
  let retry: ReturnType<typeof setTimeout>;
  let timeout: ReturnType<typeof setTimeout>;
  let ready = false;
  let destroyed = false;
  let generation = 0;

  function stopSharing() {
    generation++;
    const previous = call;
    call = undefined;
    if (stream && data?.open) data.send({ type: 'stop-share' });
    previous?.close();
    stop(stream);
    stream = undefined;
    onSharing(false);
    if (ready && !destroyed) onStatus('Готово к показу на ТВ');
  }
  function reset(text = 'Ожидание комнаты…') {
    clearTimeout(retry);
    clearTimeout(timeout);
    ready = false;
    onReady(false);
    const previous = data;
    data = undefined;
    previous?.close();
    stopSharing();
    onStatus(text);
    if (!destroyed) retry = setTimeout(connect, 2000);
  }
  function connect() {
    if (destroyed) return;
    if (!peer.open) {
      if (peer.disconnected && !peer.destroyed) peer.reconnect();
      retry = setTimeout(connect, 2000);
      return;
    }
    clearTimeout(retry);
    onStatus('Подключение…');
    const connection = peer.connect(ROOM_ID, { serialization: 'json' });
    data = connection;
    connection.on('open', () => connection.send({ type: 'share' }));
    connection.on('data', (value) => {
      if (data !== connection || !value || typeof value !== 'object' || !('type' in value)) return;
      if (value.type === 'share-ended') stopSharing();
      if (value.type === 'ready') {
        clearTimeout(timeout);
        ready = true;
        onReady(true);
        onStatus('Готово к показу на ТВ');
      }
    });
    connection.on('close', () => {
      if (data === connection) reset();
    });
    connection.on('error', () => {
      if (data === connection) reset();
    });
    timeout = setTimeout(() => reset(), 30_000);
  }
  peer.on('open', connect);
  peer.on('disconnected', () => reset('Переподключение к серверу…'));
  peer.on('error', (error) =>
    reset(error.type === 'peer-unavailable' ? 'Ожидание комнаты…' : message(error)),
  );
  // This page never receives camera/microphone streams.
  peer.on('call', (incoming) => incoming.close());

  return {
    async start() {
      if (!ready || destroyed) throw new Error('Сначала дождись подключения к ТВ.');
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Для показа экрана открой страницу через localhost или HTTPS.');
      }
      const current = ++generation;
      // Must run directly from the button click, before awaiting network operations.
      const options = {
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        windowAudio: 'system',
      };
      const captured = await navigator.mediaDevices.getDisplayMedia(options);
      if (destroyed || !ready || current !== generation) {
        stop(captured);
        return;
      }
      stream = captured;
      const [video] = captured.getVideoTracks();
      video.contentHint = 'detail';
      captured.getAudioTracks().forEach((audio) => {
        audio.contentHint = 'music';
      });
      video.addEventListener('ended', stopSharing, { once: true });
      try {
        const outgoing = peer.call(ROOM_ID, captured, {
          metadata: { type: 'share' },
          sdpTransform: preferVideoCodecs,
        });
        call = outgoing;
        videoBitrate(outgoing);
        watchStats(outgoing, 'Экран → ТВ');
        outgoing.on('close', () => {
          if (call === outgoing) stopSharing();
        });
        outgoing.on('error', () => {
          if (call === outgoing) stopSharing();
        });
        onSharing(true);
        onStatus(
          captured.getAudioTracks().length
            ? 'Видео и звук отправляются на ТВ'
            : 'Звуковая дорожка не получена. Перезапусти показ в Chrome и включи передачу звука в окне выбора.',
        );
      } catch (error) {
        stopSharing();
        throw error;
      }
    },
    stop: stopSharing,
    close() {
      destroyed = true;
      reset();
      peer.destroy();
    },
  };
}
