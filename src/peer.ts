import Peer, { type MediaConnection } from 'peerjs';

export const ROOM_ID = 'room';

export function createPeer(id?: string) {
  const secure = location.protocol === 'https:';
  const options = {
    host: import.meta.env.VITE_PEER_HOST || location.hostname,
    port: Number(import.meta.env.VITE_PEER_PORT || (secure ? location.port || 443 : 9000)),
    path: '/room',
    secure,
    config: { iceServers: [] },
  };
  return id ? new Peer(id, options) : new Peer(options);
}

// PeerJS creates offers before call() returns. Its SDP hook runs before either
// offer or answer is applied, so codec order is set before negotiation on both ends.
export function preferVideoCodecs(sdp: string): string {
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith('m=video ')) return section;
      // Prefer AVC for stable hardware encoding; keep other advertised codecs as fallbacks.
      const priority = new Map(
        [...section.matchAll(/^a=rtpmap:(\d+) H264\/90000\r?$/gim)].map((match) => [match[1], 0]),
      );
      if (!priority.size) return section;
      // Only reorder payload IDs. Keep every codec, profile, RTX mapping and FEC entry.
      return section.replace(/^m=video ([^\r\n]+)/, (_line, value: string) => {
        const [port, transport, ...payloads] = value.split(/\s+/);
        payloads.sort((a, b) => (priority.get(a) ?? 2) - (priority.get(b) ?? 2));
        return `m=video ${port} ${transport} ${payloads.join(' ')}`;
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
