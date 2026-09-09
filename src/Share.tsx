import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { screenShare } from './screen-share';
import { message } from './peer';
import { StatsPanel } from './StatsPanel';

export function Share() {
  const [status, setStatus] = useState('Подключение…');
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connection = useRef<ReturnType<typeof screenShare> | null>(null);

  useEffect(() => {
    try {
      connection.current = screenShare(setStatus, setReady, setSharing);
    } catch (error) {
      setError(message(error));
    }
    const close = () => {
      connection.current?.close();
      connection.current = null;
    };
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  }, []);

  async function start() {
    setError('');
    setBusy(true);
    try {
      await connection.current?.start();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen share-screen">
      <Stack className="share-controls">
        <Text size="lg" ta="center">
          {sharing ? 'Экран показывается на ТВ' : 'Показать экран на ТВ'}
        </Text>
        <Text size="sm" c="dimmed" role="status" ta="center">
          {status}
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {sharing ? (
          <Button color="red" variant="light" onClick={() => connection.current?.stop()}>
            Остановить показ
          </Button>
        ) : (
          <Button disabled={!ready} loading={busy} onClick={() => void start()}>
            Выбрать экран или окно
          </Button>
        )}
        <Text
          component="code"
          size="xs"
          c="dimmed"
          ta="center"
          style={{ overflowWrap: 'anywhere', userSelect: 'text' }}
        >
          chrome://flags/#use-sc-content-sharing-picker → Enabled
        </Text>
        <StatsPanel />
      </Stack>
    </main>
  );
}
