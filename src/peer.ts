import Peer, { type MediaConnection } from 'peerjs';

export const ROOM_ID = 'room';

export function createPeer(id?: string, address?: string) {
  const server = address ? new URL(address.includes('://') ? address : `http://${address}`) : null;
  if (server && !['http:', 'https:', 'ws:', 'wss:'].includes(server.protocol)) {
    throw new Error('Укажи IP или адрес PeerServer, например 192.168.0.17:9000.');
  }
  const secure = server
    ? ['https:', 'wss:'].includes(server.protocol)
    : location.protocol === 'https:';
  const options = {
    host: server?.hostname || import.meta.env.VITE_PEER_HOST || location.hostname,
    port: Number(
      server ? server.port || (secure ? 443 : 9000) : import.meta.env.VITE_PEER_PORT || 9000,
    ),
    path: '/room',
    secure,
    config: { iceServers: [] },
  };
  return id ? new Peer(id, options) : new Peer(options);
}

// PeerJS creates offers before call() returns. Its SDP hook runs before either
// offer or answer is applied, so codec order is set before negotiation on both ends.
export function preferH264(sdp: string): string {
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith('m=video ')) return section;
      const h264 = new Set(
        [...section.matchAll(/^a=rtpmap:(\d+) H264\/90000\r?$/gim)].map((match) => match[1]),
      );
      if (!h264.size) return section;
      // Only reorder payload IDs. Keep every codec, profile, RTX mapping and FEC entry.
      return section.replace(/^m=video ([^\r\n]+)/, (_line, value: string) => {
        const [port, transport, ...payloads] = value.split(/\s+/);
        const ordered = [
          ...payloads.filter((id) => h264.has(id)),
          ...payloads.filter((id) => !h264.has(id)),
        ];
        return `m=video ${port} ${transport} ${ordered.join(' ')}`;
      });
    })
    .join('');
}

export function videoBitrate(call: MediaConnection) {
  const connection = call.peerConnection;
  const apply = async () => {
    if (connection.signalingState !== 'stable') return;
    for (const sender of connection.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) continue;
      parameters.encodings[0].maxBitrate = 100_000_000;
      parameters.encodings[0].scaleResolutionDownBy = 1;
      parameters.degradationPreference = 'maintain-resolution';
      try {
        await sender.setParameters(parameters);
      } catch (error) {
        console.warn('The browser could not apply the video bitrate limit:', error);
      }
    }
  };
  connection.addEventListener('signalingstatechange', () => void apply());
  void apply();
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
