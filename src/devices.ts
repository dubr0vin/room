export type Devices = { camera: string; microphone: string; speaker: string };
const key = 'room.devices';
const nativeResolution = { resizeMode: 'none' };

export function readDevices(): Devices {
  const defaults: Devices = { camera: '', microphone: '', speaker: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    for (const name of Object.keys(defaults) as (keyof Devices)[]) {
      if (typeof saved?.[name] === 'string') defaults[name] = saved[name];
    }
  } catch {
    // Device preferences are optional when storage is unavailable.
  }
  return defaults;
}

export function saveDevices(devices: Devices) {
  try {
    localStorage.setItem(key, JSON.stringify(devices));
  } catch {
    // The current session still uses the selected devices.
  }
}

export async function capture(devices: Devices) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Открой главную страницу через localhost на ТВ-маке или через HTTPS.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: devices.camera ? { exact: devices.camera } : undefined,
      ...nativeResolution,
    },
    audio: {
      deviceId: devices.microphone ? { exact: devices.microphone } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  try {
    const [video] = stream.getVideoTracks();
    const capabilities = video.getCapabilities();
    video.contentHint = 'detail';
    // Choose the largest native image first; maximize FPS within that resolution.
    await video.applyConstraints({
      width: capabilities.width ? { ideal: capabilities.width.max } : undefined,
      height: capabilities.height ? { ideal: capabilities.height.max } : undefined,
      ...nativeResolution,
    });
    const { width, height } = video.getSettings();
    await video.applyConstraints({
      width: width ? { exact: width } : undefined,
      height: height ? { exact: height } : undefined,
      frameRate: capabilities.frameRate ? { ideal: capabilities.frameRate.max } : undefined,
      ...nativeResolution,
    });
    return stream;
  } catch (error) {
    stop(stream);
    throw error;
  }
}

export function stop(stream?: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
