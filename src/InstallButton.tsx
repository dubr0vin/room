import { useEffect, useState } from 'react';
import { Button } from '@mantine/core';

type InstallPrompt = Event & {
  prompt(): Promise<unknown>;
};

export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!prompt) return null;

  function install() {
    if (!prompt) return;
    // An install prompt can only be used once, including when it is dismissed.
    const pending = prompt.prompt();
    setPrompt(null);
    void pending.catch((error) => console.warn('Room installation failed:', error));
  }

  return (
    <Button variant="subtle" onClick={install}>
      Установить Room
    </Button>
  );
}
