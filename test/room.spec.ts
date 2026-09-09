import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    testCaptures: MediaStream[];
  }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.testCaptures = [];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      window.testCaptures.push(stream);
      return stream;
    };
  });
}

async function expectMedia(page: Page) {
  await expect
    .poll(() =>
      page.locator('video').evaluate((video: HTMLVideoElement) => {
        const stream = video.srcObject as MediaStream | null;
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          playing: video.currentTime > 0.3 && !video.paused,
          tracks: stream
            ?.getTracks()
            .map((track) => `${track.kind}:${track.readyState}`)
            .sort(),
        };
      }),
    )
    .toEqual({
      width: 3840,
      height: 2160,
      playing: true,
      tracks: ['audio:live', 'video:live'],
    });
}

test('late source, multiple viewers, release and reconnect', async ({ context, page: source }) => {
  await instrument(source);
  const viewer = await context.newPage();
  await instrument(viewer);
  await viewer.goto('/client.html');
  await expect(viewer.getByRole('status')).toBeVisible();
  await source.goto('/tv.html');
  await expectMedia(viewer);
  expect(await viewer.evaluate(() => window.testCaptures.length)).toBe(0);

  const second = await context.newPage();
  await second.goto('/client.html');
  await expectMedia(second);
  expect(await source.evaluate(() => window.testCaptures.length)).toBe(1);
  expect(
    await source.evaluate(() => {
      const track = window.testCaptures[0].getVideoTracks()[0];
      const { width, height, frameRate } = track.getSettings();
      const caps = track.getCapabilities();
      return (
        width === caps.width?.max &&
        height === caps.height?.max &&
        frameRate === caps.frameRate?.max
      );
    }),
  ).toBe(true);
  await viewer.close();
  await expectMedia(second);
  await second.close();
  await expect
    .poll(() =>
      source.evaluate(() =>
        window.testCaptures[0].getTracks().every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true);

  const next = await context.newPage();
  await next.goto('/client.html');
  await expectMedia(next);
  expect(await source.evaluate(() => window.testCaptures.length)).toBe(2);
  await source.reload();
  await expectMedia(next);
  await next.close();
});

test('settings persist and switching the camera restarts the stream', async ({
  context,
  page: source,
}) => {
  await instrument(source);
  await source.goto('/tv.html');
  await expect(source.getByRole('button', { name: 'Настройки' })).toBeVisible();
  expect(await source.evaluate(() => window.testCaptures.length)).toBe(0);
  const viewer = await context.newPage();
  await viewer.goto('/client.html');
  await expectMedia(viewer);

  const camera = await source.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices()).find(
      (device) => device.kind === 'videoinput',
    )!,
  );
  await source.getByRole('button', { name: 'Настройки' }).click();
  await source.getByRole('textbox', { name: 'Камера', exact: true }).click();
  await source.getByRole('option', { name: camera.label, exact: true }).click();
  await source.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect.poll(() => source.evaluate(() => window.testCaptures.length)).toBe(2);
  await expectMedia(viewer);
  expect(
    await source.evaluate(() =>
      window.testCaptures[0].getTracks().every((track) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  expect(
    await source.evaluate(() => JSON.parse(localStorage.getItem('room.devices')!).camera),
  ).toBe(camera.deviceId);
  await viewer.close();
  await source.reload();
  await source.getByRole('button', { name: 'Настройки' }).click();
  await expect(source.getByRole('textbox', { name: 'Камера', exact: true })).toHaveValue(
    camera.label,
  );
});
