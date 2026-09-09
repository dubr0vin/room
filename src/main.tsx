import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './style.css';
import { broadcast } from './broadcast';
import { receive } from './receive';
import { readDevices, saveDevices, type Devices } from './devices';
import { Settings } from './Settings';
import { message } from './peer';
import { Share } from './Share';
import { Fullscreen } from './Fullscreen';
import { StarVortex } from './StarVortex';

const source = !location.pathname.endsWith('/client.html');

function App() {
  const [devices, setDevices] = useState(readDevices);
  const [status, setStatus] = useState('Подключение к серверу…');
  const [error, setError] = useState('');
  const [hasAudio, setHasAudio] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
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
    setAudioEnabled(false);
    const updateAudio = () =>
      setHasAudio(Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live')));
    updateAudio();
    stream?.addEventListener('addtrack', updateAudio);
    stream?.addEventListener('removetrack', updateAudio);
    if (stream) {
      void element.play().catch((error) => {
        if (!cancelled) console.warn('Audio/video autoplay was blocked:', error);
      });
    }
    return () => {
      cancelled = true;
      stream?.removeEventListener('addtrack', updateAudio);
      stream?.removeEventListener('removetrack', updateAudio);
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  function enableAudio() {
    const element = video.current;
    if (!element) return;
    setError('');
    element.muted = false;
    void element
      .play()
      .then(() => setAudioEnabled(true))
      .catch((error) => {
        element.muted = true;
        setError(message(error));
      });
  }

  function apply(next: Devices) {
    setError('');
    const element = video.current;
    // Safari requires a user gesture even when selecting the default audio output.
    if (element && 'setSinkId' in element && element.sinkId !== next.speaker) {
      void element.setSinkId(next.speaker).catch((error) => setError(message(error)));
    }
    saveDevices(next);
    setDevices(next);
    host.current?.setDevices(next);
  }

  return (
    <main className="screen">
      <video
        ref={video}
        autoPlay
        muted={source && !audioEnabled}
        playsInline
        className="remote-video"
        aria-label={source ? 'Экран на ТВ' : 'Видео комнаты'}
      />
      {source && !stream && <StarVortex />}
      {!source && !stream && (
        <p className="connection-status" role="status">
          {status}
        </p>
      )}
      {source && (
        <>
          {hasAudio && !audioEnabled && (
            <Button className="audio-button" onClick={enableAudio}>
              Разрешить звук
            </Button>
          )}
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
