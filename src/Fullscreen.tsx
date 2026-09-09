import { useEffect, useState } from 'react';
import { ActionIcon } from '@mantine/core';
import { message } from './peer';

export function Fullscreen({ onError }: { onError: (text: string) => void }) {
  const [active, setActive] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const changed = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      onError(message(error));
    }
  }
  return (
    <ActionIcon
      className="fullscreen-button"
      variant="subtle"
      color="gray"
      size={48}
      aria-label={active ? 'Выйти из полноэкранного режима' : 'На весь экран'}
      onClick={() => void toggle()}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path
          d={
            active
              ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5'
              : 'M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5'
          }
        />
      </svg>
    </ActionIcon>
  );
}
