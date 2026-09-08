import { type DataConnection, type MediaConnection } from 'peerjs';
import { capture, stop, type Devices } from './devices';
import { createPeer, message, ROOM_ID, videoBitrate } from './peer';

type Listener = { data: DataConnection; call?: MediaConnection };

export function broadcast(
  initial: Devices,
  onStatus: (text: string) => void,
  onError: (text: string) => void,
) {
  const peer = createPeer(ROOM_ID);
  const listeners = new Set<Listener>();
  let devices = initial;
  let stream: MediaStream | undefined;
  let pending: Promise<MediaStream> | undefined;
  let generation = 0;
  let destroyed = false;
  let reconnect: ReturnType<typeof setTimeout>;

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
          if (destroyed || current !== generation || !listeners.size) {
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
    if (!listeners.size) release();
    onStatus(listeners.size ? `Зрителей: ${listeners.size}` : 'Ожидание подключения');
  }

  peer.on('open', () => onStatus('Ожидание подключения'));
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
    data.on('open', async () => {
      try {
        const local = await getStream();
        if (!listeners.has(listener)) return;
        const call = peer.call(data.peer, local);
        listener.call = call;
        videoBitrate(call);
        call.on('close', () => remove(listener));
        call.on('error', () => remove(listener));
        onError('');
        onStatus(`Зрителей: ${listeners.size}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const text = message(error);
        if (data.open) data.send({ error: text });
        onError(text);
        remove(listener);
      }
    });
  });

  return {
    setDevices(next: Devices) {
      const changed = next.camera !== devices.camera || next.microphone !== devices.microphone;
      devices = next;
      if (changed) {
        for (const listener of listeners) remove(listener);
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
