import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Text, TextInput } from '@mantine/core';
import { screenShare } from './screen-share';
import { message } from './peer';
import { StatsPanel } from './StatsPanel';

export function Share() {
  const [address, setAddress] = useState(() => {
    if (location.protocol === 'https:') return location.origin;
    try {
      return localStorage.getItem('room.share-server') ?? '';
    } catch {
      return '';
    }
  });
  const [status, setStatus] = useState('Укажи адрес ТВ-мака');
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connection = useRef<ReturnType<typeof screenShare> | null>(null);

  useEffect(() => {
    const close = () => connection.current?.close();
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  }, []);

  function connect() {
    connection.current?.close();
    connection.current = null;
    setReady(false);
    setError('');
    try {
      const server = address.trim();
      if (!server) throw new Error('Введи адрес ТВ-мака.');
      connection.current = screenShare(server, setStatus, setReady, setSharing);
      setStatus('Подключение…');
      try {
        localStorage.setItem('room.share-server', server);
      } catch {
        /* Optional preference. */
      }
    } catch (error) {
      setError(message(error));
    }
  }

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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            connect();
          }}
        >
          <Stack>
            <TextInput
              label="Адрес ТВ"
              placeholder="192.168.0.16 или https://toccata-and-fugue.duckdns.org"
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
              disabled={sharing || busy}
              autoComplete="off"
            />
            <Button type="submit" variant="light" disabled={!address.trim() || sharing || busy}>
              Подключиться
            </Button>
          </Stack>
        </form>
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
        <StatsPanel />
      </Stack>
    </main>
  );
}
