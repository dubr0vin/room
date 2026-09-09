import { useState, useSyncExternalStore } from 'react';
import { Accordion, Alert, Button, Group, Paper, Stack, Table, Text } from '@mantine/core';
import { statsStore, type CallStats } from './stats';

function Metrics({ metrics }: { metrics: CallStats['metrics'] }) {
  return (
    <Table className="stats-table" fz="xs" verticalSpacing={4}>
      <Table.Tbody>
        {metrics.map(({ label, value, unit }) => (
          <Table.Tr key={label}>
            <Table.Td c="dimmed">{label}</Table.Td>
            <Table.Td ta="right">
              {value === null
                ? '—'
                : `${typeof value === 'number' ? Number(value.toFixed(2)) : value}${unit ? ` ${unit}` : ''}`}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function StatsPanel({ expanded = false }: { expanded?: boolean }) {
  const calls = useSyncExternalStore(statsStore.subscribe, statsStore.getSnapshot);
  const [copyStatus, setCopyStatus] = useState('');
  const exportJSON = () =>
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        page: location.pathname,
        browser: navigator.userAgent,
        note: 'Rates and averages use the last sampling interval. Null means unavailable. Receiver processing includes buffering and decoding; these values must not be summed. RTT is round-trip, not end-to-end video latency.',
        calls,
      },
      null,
      2,
    );

  async function copy() {
    try {
      await navigator.clipboard.writeText(exportJSON());
      setCopyStatus('Скопировано');
    } catch {
      setCopyStatus('Буфер обмена недоступен — скачай JSON.');
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `room-stats-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Accordion variant="contained" defaultValue={expanded ? 'stats' : null}>
      <Accordion.Item value="stats">
        <Accordion.Control>Статистика WebRTC · {calls.length}</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              Обновление раз в секунду. «—» — данных ещё нет или браузер их не предоставляет. Это
              отдельные этапы, а не полная задержка до экрана ТВ. Время от первого пакета до
              готового кадра уже включает буфер и декодирование — складывать их нельзя.
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="light" onClick={() => void copy()}>
                Скопировать
              </Button>
              <Button size="xs" variant="subtle" onClick={download}>
                Скачать JSON
              </Button>
            </Group>
            {copyStatus && (
              <Text size="xs" role="status">
                {copyStatus}
              </Text>
            )}
            {!calls.length && (
              <Text size="sm" c="dimmed">
                Нет активных медиасоединений
              </Text>
            )}
            {calls.map((call) => (
              <Paper key={call.id} withBorder p="xs">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    {call.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {call.state} · пир {call.peer.slice(0, 12)} ·{' '}
                    {new Date(call.updatedAt).toLocaleTimeString()}
                  </Text>
                  {call.error && <Alert color="yellow">getStats(): {call.error}</Alert>}
                  <Metrics metrics={call.metrics} />
                  {call.tracks.map((track) => (
                    <div key={track.id}>
                      <Text size="sm" fw={500} mt="xs">
                        {track.label}
                      </Text>
                      <Metrics metrics={track.metrics} />
                    </div>
                  ))}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
