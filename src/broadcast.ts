import { watchStats } from './stats';
import { type DataConnection, type MediaConnection } from 'peerjs';
import { capture, stop, type Devices } from './devices';
import { createPeer, message, preferVideoCodecs, ROOM_ID, videoBitrate } from './peer';

type Listener = { data: DataConnection; mode?: 'watch' | 'share'; call?: MediaConnection };

export function broadcast(
  initial: Devices,
  onStatus: (text: string) => void,
  onError: (text: string) => void,
  onScreen: (stream: MediaStream | null) => void,
) {
  const peer = createPeer(ROOM_ID);
  const listeners = new Set<Listener>();
  let devices = initial;
  let stream: MediaStream | undefined;
  let pending: Promise<MediaStream> | undefined;
  let shared: MediaConnection | undefined;
  let generation = 0;
  let destroyed = false;
  let reconnect: ReturnType<typeof setTimeout>;

  const watchers = () => [...listeners].filter((listener) => listener.mode === 'watch');
  function status() {
    onStatus(
      shared
        ? `Экран подключён · Зрителей: ${watchers().length}`
        : watchers().length
          ? `Зрителей: ${watchers().length}`
          : 'Ожидание подключения',
    );
  }
  function release() {
    generation++;
    stop(stream);
    stream = undefined;
    pending = undefined;
  }
  function getStream() {
    if (stream) return Promise.resolve(stream);
    if (!pending) {
      const current = generation;
      pending = Promise.resolve()
        .then(() => capture(devices))
        .then((captured) => {
          if (destroyed || current !== generation || !watchers().length) {
            stop(captured);
            throw new DOMException('Capture was cancelled', 'AbortError');
          }
          stream = captured;
          return captured;
        });
    }
    return pending;
  }
  function remove(listener: Listener) {
    if (!listeners.delete(listener)) return;
    listener.call?.close();
    listener.data.close();
    if (!watchers().length) release();
    status();
  }
  async function watch(listener: Listener) {
    try {
      const local = await getStream();
      if (!listeners.has(listener)) return;
      const call = peer.call(listener.data.peer, local, { sdpTransform: preferVideoCodecs });
      listener.call = call;
      videoBitrate(call);
      watchStats(call, 'Камера комнаты → клиент');
      call.on('close', () => remove(listener));
      call.on('error', () => remove(listener));
      onError('');
      status();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const text = message(error);
      if (listener.data.open) listener.data.send({ error: text });
      onError(text);
      remove(listener);
    }
  }

  peer.on('open', status);
  peer.on('disconnected', () => {
    onStatus('Переподключение к серверу…');
    reconnect = setTimeout(() => {
      if (!destroyed && peer.disconnected) peer.reconnect();
    }, 1500);
  });
  peer.on('error', (error) => {
    onError(
      error.type === 'unavailable-id'
        ? 'Главная страница комнаты уже открыта в другом окне.'
        : message(error),
    );
  });
  peer.on('connection', (data) => {
    const listener: Listener = { data };
    listeners.add(listener);
    data.on('close', () => remove(listener));
    data.on('error', () => remove(listener));
    data.on('data', (value) => {
      if (!value || typeof value !== 'object' || !('type' in value)) return;
      if (value.type === 'stop-share' && listener.mode === 'share') {
        listener.call?.close();
        return;
      }
      if (listener.mode) return;
      if (value.type === 'watch') {
        listener.mode = 'watch';
        void watch(listener);
      } else if (value.type === 'share') {
        listener.mode = 'share';
        data.send({ type: 'ready' });
      }
    });
  });
  peer.on('call', (incoming) => {
    const listener = [...listeners].find(
      (item) => item.data.peer === incoming.peer && item.mode === 'share' && item.data.open,
    );
    if (!listener || incoming.metadata?.type !== 'share') {
      incoming.close();
      return;
    }
    // The latest presentation replaces the previous one.
    const previous = shared;
    const previousOwner = [...listeners].find((item) => item.call === previous);
    if (previous && previousOwner?.data.open) previousOwner.data.send({ type: 'share-ended' });
    shared = incoming;
    listener.call = incoming;
    previous?.close();
    onScreen(null);
    incoming.on('stream', (remote) => {
      if (shared === incoming) onScreen(remote);
    });
    const ended = () => {
      if (listener.call === incoming) listener.call = undefined;
      if (shared === incoming) {
        shared = undefined;
        onScreen(null);
        status();
      }
    };
    incoming.on('close', ended);
    incoming.on('error', () => {
      incoming.close();
      ended();
    });
    incoming.answer(undefined, { sdpTransform: preferVideoCodecs });
    watchStats(incoming, 'Экран → ТВ');
    status();
  });

  return {
    setDevices(next: Devices) {
      const changed = next.camera !== devices.camera || next.microphone !== devices.microphone;
      devices = next;
      if (changed) {
        for (const listener of watchers()) remove(listener);
        release();
      }
    },
    close() {
      destroyed = true;
      clearTimeout(reconnect);
      for (const listener of listeners) remove(listener);
      release();
      peer.destroy();
    },
  };
}
