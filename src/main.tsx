import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './style.css';
import { broadcast } from './broadcast';
import { receive } from './receive';
import { readDevices, saveDevices, type Devices } from './devices';
import { Settings } from './Settings';
import { message } from './peer';
import { Share } from './Share';
import { Fullscreen } from './Fullscreen';

const source = !location.pathname.endsWith('/client.html');

function App() {
  const [devices, setDevices] = useState(readDevices);
  const [status, setStatus] = useState('Подключение к серверу…');
  const [error, setError] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const host = useRef<ReturnType<typeof broadcast> | null>(null);

  useEffect(() => {
    const room = source ? broadcast(readDevices(), setStatus, setError, setStream) : null;
    host.current = room;
    const close = room ? room.close : receive(setStream, setStatus);
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
      host.current = null;
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    element.srcObject = stream;
    element.muted = source;
    if (stream) {
      void element.play().catch((error) => {
        if (!cancelled) console.warn('Audio/video autoplay was blocked:', error);
      });
    }
    return () => {
      cancelled = true;
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const element = video.current;
    if (element && 'setSinkId' in element) {
      void element.setSinkId(devices.speaker).catch((error) => setError(message(error)));
    }
  }, [devices.speaker]);

  function apply(next: Devices) {
    saveDevices(next);
    setDevices(next);
    host.current?.setDevices(next);
    setError('');
  }

  return (
    <main className="screen">
      <video
        ref={video}
        autoPlay
        playsInline
        className="remote-video"
        aria-label={source ? 'Экран на ТВ' : 'Видео комнаты'}
      />
      {!source && !stream && (
        <p className="connection-status" role="status">
          {status}
        </p>
      )}
      {source && (
        <>
          <Settings devices={devices} onChange={apply} source status={status} error={error} />
          <Fullscreen onError={setError} />
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <MantineProvider forceColorScheme="dark">
    {location.pathname.endsWith('/share.html') ? <Share /> : <App />}
  </MantineProvider>,
);
