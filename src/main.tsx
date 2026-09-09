import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, MantineProvider, Stack, Title } from '@mantine/core';
import '@mantine/core/styles.css';
import './style.css';
import { broadcast } from './broadcast';
import { receive } from './receive';
import { readDevices, saveDevices, type Devices } from './devices';
import { Settings } from './Settings';
import { message } from './peer';
import { Share } from './Share';
import { Fullscreen } from './Fullscreen';
import { RoomCode } from './RoomCode';
import { StatsPanel } from './StatsPanel';

const audioPreference = 'room.audio-enabled';

function readAudioPreference() {
  try {
    return localStorage.getItem(audioPreference) === 'true';
  } catch {
    return false;
  }
}

function App({ source }: { source: boolean }) {
  const [devices, setDevices] = useState(readDevices);
  const [status, setStatus] = useState('Подключение к серверу…');
  const [error, setError] = useState('');
  const [hasAudio, setHasAudio] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(readAudioPreference);
  const audioAllowed = useRef(audioEnabled);
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
    // Reuse this video element and its audio permission across stream replacements.
    element.muted = source && !audioAllowed.current;
    const updateAudio = () => {
      setHasAudio(Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live')));
      if (!stream) return;
      void element.play().catch((error) => {
        if (cancelled) return;
        if (source && error.name === 'NotAllowedError') {
          // A saved preference cannot grant browser autoplay permission after a reload.
          audioAllowed.current = false;
          setAudioEnabled(false);
          element.muted = true;
          void element.play().catch((error) => {
            if (!cancelled) console.warn('Video autoplay was blocked:', error);
          });
        } else {
          console.warn('Audio/video playback failed:', error);
        }
      });
    };
    updateAudio();
    stream?.addEventListener('addtrack', updateAudio);
    stream?.addEventListener('removetrack', updateAudio);
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
    const currentStream = element.srcObject;
    setError('');
    audioAllowed.current = true;
    setAudioEnabled(true);
    element.muted = false;
    try {
      localStorage.setItem(audioPreference, 'true');
    } catch {
      // Keep the choice for this page even if persistent storage is unavailable.
    }
    // Call play directly from the click so Safari receives the user gesture.
    void element.play().catch((error) => {
      if (element.srcObject !== currentStream) return;
      audioAllowed.current = false;
      setAudioEnabled(false);
      element.muted = true;
      setError(message(error));
      void element.play().catch(() => {});
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
      {source && !stream && <RoomCode />}
      {!source && !stream && (
        <p className="connection-status" role="status">
          {status}
        </p>
      )}
      {!source && new URLSearchParams(location.search).get('stats') === '1' && (
        <aside className="stats-overlay">
          <StatsPanel expanded />
        </aside>
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

function Home() {
  return (
    <main className="screen home-screen">
      <Stack className="home-controls" gap="md">
        <Title order={1} ta="center" mb="md">
          Room
        </Title>
        <Button component="a" href="/tv.html" size="xl" variant="light">
          TV
        </Button>
        <Button component="a" href="/camera.html" size="xl" variant="light">
          Camera
        </Button>
        <Button component="a" href="/share.html" size="xl" variant="light">
          Share
        </Button>
      </Stack>
    </main>
  );
}

const page = location.pathname;

createRoot(document.getElementById('root')!).render(
  <MantineProvider forceColorScheme="dark">
    {page.endsWith('/tv.html') ? (
      <App source />
    ) : page.endsWith('/camera.html') || page.endsWith('/client.html') ? (
      <App source={false} />
    ) : page.endsWith('/share.html') ? (
      <Share />
    ) : (
      <Home />
    )}
  </MantineProvider>,
);
