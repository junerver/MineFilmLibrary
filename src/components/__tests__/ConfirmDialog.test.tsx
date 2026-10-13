import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from '../ConfirmDialog';

// 承载一次 confirm() 调用的探针组件：把 Promise 结果写到-result-节点上。
function Probe({ opts }: { opts: Parameters<ReturnType<typeof useConfirm>>[0] }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={() => void confirm(opts).then(v => {
        document.body.setAttribute('data-result', String(v));
      })}
    >
      open
    </button>
  );
}

function renderProbe(opts: Parameters<ReturnType<typeof useConfirm>>[0]) {
  return render(
    <ConfirmProvider>
      <Probe opts={opts} />
    </ConfirmProvider>,
  );
}

describe('ConfirmDialog', () => {
  it('确认按钮 resolve true 并关闭弹窗', async () => {
    renderProbe({ title: '删除演员', message: '确定删除？', confirmText: '删除', danger: true });
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // 多行正文原样展示
    expect(screen.getByText('确定删除？')).toBeInTheDocument();
    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('true'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('取消按钮 resolve false', async () => {
    renderProbe({ message: '继续吗？' });
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByText('取消'));
    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('false'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape 取消、遮罩点击取消', async () => {
    renderProbe({ message: 'a' });
    fireEvent.click(screen.getByText('open'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('false'));

    document.body.removeAttribute('data-result');
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('dialog').then(d => d.parentElement!));
    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('false'));
  });

  it('danger 弹窗初始焦点落在取消按钮（防回车误触）', async () => {
    renderProbe({ message: '危险', danger: true });
    fireEvent.click(screen.getByText('open'));
    await screen.findByRole('dialog');
    expect(document.activeElement).toBe(screen.getByText('取消'));
  });
});
