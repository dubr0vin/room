import { watchStats } from './stats';
import { type DataConnection, type MediaConnection } from 'peerjs';
import { createPeer, message, ROOM_ID } from './peer';

export function receive(
  onStream: (stream: MediaStream | null) => void,
  onStatus: (text: string) => void,
) {
  const peer = createPeer();
  let data: DataConnection | undefined;
  let call: MediaConnection | undefined;
  let retry: ReturnType<typeof setTimeout>;
  let timeout: ReturnType<typeof setTimeout>;
  let destroyed = false;

  function reset(status = 'Ожидание комнаты…') {
    clearTimeout(retry);
    clearTimeout(timeout);
    const previousData = data;
    const previousCall = call;
    data = undefined;
    call = undefined;
    previousData?.close();
    previousCall?.close();
    onStream(null);
    onStatus(status);
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
    connection.on('open', () => connection.send({ type: 'watch' }));
    connection.on('close', () => {
      if (data === connection) reset();
    });
    connection.on('error', () => {
      if (data === connection) reset();
    });
    connection.on('data', (value) => {
      if (value && typeof value === 'object' && 'error' in value) {
        onStatus(String(value.error));
      }
    });
    timeout = setTimeout(() => reset(), 30_000);
  }

  peer.on('open', connect);
  peer.on('disconnected', () => reset('Переподключение к серверу…'));
  peer.on('error', (error) => {
    reset(error.type === 'peer-unavailable' ? 'Ожидание комнаты…' : message(error));
  });
  peer.on('call', (incoming) => {
    if (destroyed || incoming.peer !== ROOM_ID || !data || call) {
      incoming.close();
      return;
    }
    call = incoming;
    incoming.on('stream', (stream) => {
      clearTimeout(timeout);
      onStream(stream);
      onStatus('Подключено');
    });
    incoming.on('close', () => {
      if (call === incoming) reset();
    });
    incoming.on('error', () => {
      if (call === incoming) reset();
    });
    incoming.answer();
    watchStats(incoming, 'Камера комнаты → клиент');
  });

  return () => {
    destroyed = true;
    reset();
    peer.destroy();
  };
}
