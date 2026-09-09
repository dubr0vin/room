import { type MediaConnection } from 'peerjs';

// Optional fields vary between browsers. Missing values must not become zeroes.
type Stat = RTCStats & Record<string, unknown>;
type Metric = { label: string; value: string | number | null; unit?: string };
export type CallStats = {
  id: string;
  label: string;
  peer: string;
  state: string;
  updatedAt: string;
  metrics: Metric[];
  tracks: { id: string; label: string; metrics: Metric[] }[];
  error?: string;
};

const calls = new Map<string, CallStats>();
const listeners = new Set<() => void>();
let snapshot: CallStats[] = [];

function publish() {
  snapshot = [...calls.values()];
  listeners.forEach((listener) => listener());
}

export const statsStore = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

function number(stat: Stat | undefined, key: string): number | null {
  const value = stat?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function string(stat: Stat | undefined, key: string): string | null {
  return typeof stat?.[key] === 'string' ? (stat[key] as string) : null;
}

function delta(now: Stat, before: Stat | undefined, key: string): number | null {
  const a = number(now, key);
  const b = number(before, key);
  return a !== null && b !== null && a >= b ? a - b : null;
}

function divide(a: number | null, b: number | null, scale = 1): number | null {
  return a !== null && b !== null && b > 0 ? (a / b) * scale : null;
}

function metric(label: string, value: Metric['value'], unit?: string): Metric {
  return { label, value, unit };
}

export function readStats(
  report: RTCStatsReport,
  previous: RTCStatsReport | undefined,
  connection: RTCPeerConnection,
): Pick<CallStats, 'metrics' | 'tracks'> {
  const all = [...report.values()] as Stat[];
  const linked = (stat: Stat | undefined, key: string): Stat | undefined => {
    const id = string(stat, key);
    return id ? report.get(id) : undefined;
  };
  const transport = all.find((stat) => stat.type === 'transport' && stat.selectedCandidatePairId);
  const pair = linked(transport, 'selectedCandidatePairId');
  const candidate = linked(pair, 'localCandidateId');
  const size = (width: unknown, height: unknown) =>
    typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
      ? `${width} × ${height}`
      : null;

  return {
    metrics: [
      metric('Транспорт', string(candidate, 'protocol')),
      metric(
        'RTT сети (туда-обратно)',
        divide(number(pair, 'currentRoundTripTime'), 1, 1000),
        'мс',
      ),
      metric(
        'Доступно для отправки (оценка)',
        divide(number(pair, 'availableOutgoingBitrate'), 1_000_000),
        'Мбит/с',
      ),
    ],
    tracks: all
      .filter(
        (stat) =>
          (stat.type === 'outbound-rtp' || stat.type === 'inbound-rtp') &&
          (stat.kind === 'video' || stat.kind === 'audio'),
      )
      .map((stat) => {
        const before = previous?.get(stat.id) as Stat | undefined;
        const elapsed = delta(stat, before, 'timestamp');
        const sent = stat.type === 'outbound-rtp';
        const video = stat.kind === 'video';
        const codec = linked(stat, 'codecId');
        const remote = linked(stat, 'remoteId');
        const average = (total: string, count: string) =>
          divide(delta(stat, before, total), delta(stat, before, count), 1000);
        const sender = sent
          ? connection.getSenders().find((item) => item.track?.kind === stat.kind)
          : undefined;
        const capture = sender?.track?.getSettings();
        const source = linked(stat, 'mediaSourceId');
        const metrics = [
          metric('Кодек', string(codec, 'mimeType')),
          metric(
            'Битрейт',
            divide(delta(stat, before, sent ? 'bytesSent' : 'bytesReceived'), elapsed, 0.008),
            'Мбит/с',
          ),
        ];
        if (video) {
          metrics.push(
            metric(
              sent ? 'Отправляемый кадр' : 'Принимаемый кадр',
              size(stat.frameWidth, stat.frameHeight),
            ),
            metric(
              sent ? 'FPS кодирования' : 'FPS декодирования',
              divide(delta(stat, before, sent ? 'framesEncoded' : 'framesDecoded'), elapsed, 1000),
            ),
            metric(
              sent ? 'Кодирование кадра' : 'Декодирование кадра',
              average(
                sent ? 'totalEncodeTime' : 'totalDecodeTime',
                sent ? 'framesEncoded' : 'framesDecoded',
              ),
              'мс',
            ),
            metric(
              sent ? 'Кодировщик' : 'Декодировщик',
              string(stat, sent ? 'encoderImplementation' : 'decoderImplementation'),
            ),
          );
        }
        if (sent) {
          metrics.push(
            metric(
              'Очередь отправки / пакет',
              average('totalPacketSendDelay', 'packetsSent'),
              'мс',
            ),
            metric(
              'Целевой битрейт кодировщика',
              divide(number(stat, 'targetBitrate'), 1_000_000),
              'Мбит/с',
            ),
            metric(
              'Потери по последнему RTCP',
              divide(number(remote, 'fractionLost'), 1, 100),
              '%',
            ),
          );
          if (video)
            metrics.push(
              metric('Захват до кодирования', size(capture?.width, capture?.height)),
              metric('FPS источника', number(source, 'framesPerSecond')),
              metric('FPS захвата (настройка)', capture?.frameRate ?? null),
              metric('Ограничение качества', string(stat, 'qualityLimitationReason')),
            );
        } else {
          metrics.push(
            metric('Буфер приёма', average('jitterBufferDelay', 'jitterBufferEmittedCount'), 'мс'),
            metric(
              'Цель буфера',
              average('jitterBufferTargetDelay', 'jitterBufferEmittedCount'),
              'мс',
            ),
            metric(
              'Минимум буфера',
              average('jitterBufferMinimumDelay', 'jitterBufferEmittedCount'),
              'мс',
            ),
            metric('Джиттер сети', divide(number(stat, 'jitter'), 1, 1000), 'мс'),
            metric('Потери пакетов, всего', number(stat, 'packetsLost')),
          );
          if (video)
            metrics.push(
              metric(
                'От первого пакета до декодированного кадра',
                average('totalProcessingDelay', 'framesDecoded'),
                'мс',
              ),
              metric('Отброшено кадров за интервал', delta(stat, before, 'framesDropped')),
              metric('Замирания, всего', number(stat, 'freezeCount')),
            );
        }
        return {
          id: stat.id,
          label: `${sent ? '↑ Отправка' : '↓ Приём'} · ${video ? 'Видео' : 'Аудио'}`,
          metrics,
        };
      }),
  };
}

export function watchStats(call: MediaConnection, label: string) {
  const connection = call.peerConnection;
  const id = call.connectionId;
  let previous: RTCStatsReport | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function close() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    call.off('close', close);
    call.off('error', close);
    connection.removeEventListener('connectionstatechange', stateChanged);
    calls.delete(id);
    publish();
  }
  function stateChanged() {
    if (connection.connectionState === 'closed') close();
  }
  async function poll() {
    try {
      const report = await connection.getStats();
      if (stopped) return;
      calls.set(id, {
        id,
        label,
        peer: call.peer,
        state: connection.connectionState,
        updatedAt: new Date().toISOString(),
        ...readStats(report, previous, connection),
      });
      previous = report;
      publish();
    } catch (error) {
      if (stopped) return;
      previous = undefined;
      calls.set(id, {
        id,
        label,
        peer: call.peer,
        state: connection.connectionState,
        updatedAt: new Date().toISOString(),
        metrics: [],
        tracks: [],
        error: error instanceof Error ? error.message : String(error),
      });
      publish();
    }
    if (!stopped) timer = setTimeout(() => void poll(), 1000);
  }
  call.on('close', close);
  call.on('error', close);
  connection.addEventListener('connectionstatechange', stateChanged);
  if (connection.connectionState === 'closed') close();
  else void poll();
}
