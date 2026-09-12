// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../app/page';

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(App)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!button) throw new Error('Missing button: ' + text);
  await act(async () => button.click());
}
it('mounts the complete app and modal provider without configured cloud credentials', () => {
  expect(host.textContent).toContain('广播服务尚未配置');
  expect(host.querySelectorAll('.class-card')).toHaveLength(6);
  expect(Array.from(host.querySelectorAll('.class-status')).every(e => e.textContent === '状态待确认')).toBe(true);
  const send = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === '发送广播');
  expect(send?.disabled).toBe(true);
});
it('selects and deselects all classrooms in the real React component', async () => {
  await click('全选'); expect(host.querySelectorAll('.class-card[aria-pressed="true"]')).toHaveLength(6);
  await click('取消全选'); expect(host.querySelectorAll('.class-card[aria-pressed="true"]')).toHaveLength(0);
  await act(async () => (host.querySelector('.class-card') as HTMLButtonElement).click());
  expect(host.querySelectorAll('.class-card[aria-pressed="true"]')).toHaveLength(1);
  expect(host.querySelector('.selected-count')?.textContent).toContain('1');
});
it('opens history without presenting fabricated records', async () => {
  await click('广播历史'); expect(host.textContent).toContain('连接后查看广播历史');
  expect(host.querySelectorAll('.history-card')).toHaveLength(0);
  await click('发广播'); expect(host.querySelector('textarea')).not.toBeNull();
});
it('plays the selected voice from the published static samples', async () => {
  const play = vi.fn().mockResolvedValue(undefined);
  const Audio = vi.fn(function (this: { play: typeof play; pause: () => void }, source: string) {
    expect(source).toBe('/voice-previews/101001.wav');
    this.play = play; this.pause = vi.fn();
  });
  vi.stubGlobal('Audio', Audio);
  await click('试听');
  expect(Audio).toHaveBeenCalledOnce(); expect(play).toHaveBeenCalledOnce();
});
