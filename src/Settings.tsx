import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Button, Modal, Select, Stack, Text } from '@mantine/core';
import { capture, stop, type Devices } from './devices';
import { message } from './peer';

type Props = {
  devices: Devices;
  onChange: (devices: Devices) => void;
  source: boolean;
  status: string;
  error?: string;
};

export function Settings({ devices, onChange, source, status, error }: Props) {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState(devices);
  const [available, setAvailable] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const outputSupported = 'setSinkId' in HTMLMediaElement.prototype;

  async function refresh() {
    try {
      setAvailable((await navigator.mediaDevices?.enumerateDevices()) ?? []);
    } catch (error) {
      setDeviceError(message(error));
    }
  }

  useEffect(() => {
    if (opened) {
      setDraft(devices);
      void refresh();
    }
  }, [opened, devices]);
  useEffect(() => {
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, []);

  async function allow() {
    setBusy(true);
    try {
      const stream = await capture({ ...draft, camera: '', microphone: '' });
      stop(stream);
      await refresh();
      setDeviceError('');
    } catch (error) {
      setDeviceError(message(error));
    } finally {
      setBusy(false);
    }
  }

  function options(kind: MediaDeviceKind, selected: string) {
    const list = [
      { value: '', label: 'Системное устройство' },
      ...available
        .filter(
          (device) => device.kind === kind && device.deviceId && device.deviceId !== 'default',
        )
        .map((device, index) => ({
          value: device.deviceId,
          label: device.label || `Устройство ${index + 1}`,
        })),
    ];
    if (selected && !list.some((option) => option.value === selected)) {
      list.push({ value: selected, label: 'Сохранённое устройство (недоступно)' });
    }
    return list;
  }

  return (
    <>
      <ActionIcon
        className="settings-button"
        aria-label="Настройки"
        variant="subtle"
        color="gray"
        size={48}
        radius="xl"
        onClick={() => setOpened(true)}
      >
        <span aria-hidden="true" className="gear">
          ⚙
        </span>
      </ActionIcon>
      {error && !opened && (
        <button className="notice" onClick={() => setOpened(true)}>
          {error}
        </button>
      )}
      <Modal opened={opened} onClose={() => setOpened(false)} title="Настройки" centered>
        <Stack>
          <Text size="sm" c="dimmed" role="status">
            {status}
          </Text>
          {(error || deviceError) && <Alert color="red">{deviceError || error}</Alert>}
          {source && (
            <>
              <Select
                label="Камера"
                data={options('videoinput', draft.camera)}
                value={draft.camera}
                allowDeselect={false}
                onChange={(value) => setDraft({ ...draft, camera: value ?? '' })}
              />
              <Select
                label="Микрофон"
                data={options('audioinput', draft.microphone)}
                value={draft.microphone}
                allowDeselect={false}
                onChange={(value) => setDraft({ ...draft, microphone: value ?? '' })}
              />
              <Button variant="light" loading={busy} onClick={() => void allow()}>
                Разрешить доступ к устройствам
              </Button>
            </>
          )}
          <Select
            label="Аудиовыход"
            data={options('audiooutput', draft.speaker)}
            value={draft.speaker}
            disabled={!outputSupported}
            allowDeselect={false}
            onChange={(value) => setDraft({ ...draft, speaker: value ?? '' })}
          />
          {!outputSupported && (
            <Text size="xs" c="dimmed">
              В этом браузере аудиовыход выбирается в настройках macOS.
            </Text>
          )}
          {source && (
            <Text size="xs" c="dimmed">
              Видео: максимум камеры · до 100 Мбит/с
            </Text>
          )}
          <Button
            onClick={() => {
              onChange(draft);
              setOpened(false);
            }}
            disabled={busy}
          >
            Применить
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
