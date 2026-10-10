import { useEffect, useState, type DragEvent } from 'react';
import { api } from './api';

/**
 * 카드 배치 개인화: 끌어서 놓기로 바꾼 카드 순서를 사용자별로 DB에 저장
 * - 저장된 순서에 없는 카드(새 프로젝트 등)는 기본 정렬대로 뒤에 붙음
 * - 화면에 없는 카드의 순서는 지우지 않고 유지 (다른 주차에서 다시 보일 때 사용)
 */
export function useCardOrder(key: string) {
  const url = `/auth/me/prefs/cardOrder:${key}`;
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ value: unknown }>(url)
      .then((r) => alive && setOrder(Array.isArray(r.value) ? r.value.map(String) : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);

  const save = (next: string[] | null) => {
    setOrder(next);
    api.put(url, { value: next }).catch(() => {});
  };

  /** 저장된 순서대로 정렬 (기본 정렬 순서가 동률 처리 기준) */
  const arrange = <T,>(list: T[], idOf: (t: T) => string): T[] => {
    if (!order) return list;
    const pos = new Map(order.map((k, i) => [k, i]));
    return list
      .map((t, i) => ({ t, k: pos.get(idOf(t)) ?? order.length + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.t);
  };

  /** 화면에 보이는 순서(visible)에서 from 카드를 to 카드 자리로 옮김 */
  const move = (visible: string[], from: string, to: string) => {
    if (from === to) return;
    const fi = visible.indexOf(from);
    const ti = visible.indexOf(to);
    if (fi < 0 || ti < 0) return;
    const next = visible.filter((k) => k !== from);
    next.splice(ti, 0, from); // 앞으로 옮기면 대상 앞, 뒤로 옮기면 대상 뒤
    save([...next, ...(order ?? []).filter((k) => !visible.includes(k))]);
  };

  /** 카드에 붙이는 끌어서 놓기 속성 */
  const dragProps = (id: string, visible: string[]) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      (document.activeElement as HTMLElement | null)?.blur();
      setDragId(id);
    },
    onDragOver: (e: DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overId !== id) setOverId(id);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragId) move(visible, dragId, id);
      setDragId(null);
      setOverId(null);
    },
    onDragEnd: () => {
      setDragId(null);
      setOverId(null);
    },
  });

  /** 카드 상태 클래스: 끌고 있는 카드 / 놓일 자리 */
  const dragClass = (id: string) => (dragId === id ? 'dnd-dragging' : dragId && overId === id ? 'dnd-over' : '');

  return { arrange, dragProps, dragClass, dragging: !!dragId, customized: !!order?.length, reset: () => save(null) };
}
