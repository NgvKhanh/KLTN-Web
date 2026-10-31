import { useEffect, useMemo, useState } from 'react';
import { fetchCvAccess } from './api/assign';
import { logError } from './logError';

// Hook cho nut "Xem CV" o danh sach thanh vien (bang / khong gian): hoi may chu MOT lan cho ca danh sach xem nguoi xem tai duoc CV
// cua ai. May chu quyet dinh quyen (chu / quan tri bang chung, tep con) - giao dien chi hien nut cho dung nhung nguoi do.

const NONE: ReadonlySet<string> = new Set();

/**
 * Tap `userId` ma nguoi dang xem tai duoc CV. `enabled = false` (vd danh sach chua mo) -> khong goi may chu. Ket qua cua danh sach CU
 * (doi danh sach khi yeu cau truoc chua ve) bi bo. Loi -> coi nhu khong ai (chi ghi log, khong lam vo danh sach).
 */
export function useCvAccess(userIds: readonly string[], enabled = true): ReadonlySet<string> {
  const key = useMemo(() => [...new Set(userIds)].sort().join(','), [userIds]);
  const [state, setState] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: '', ids: NONE });

  useEffect(() => {
    if (!enabled || key === '') return;
    let alive = true;
    fetchCvAccess(key.split(','))
      .then((ids) => {
        if (alive) setState({ key, ids: new Set(ids) });
      })
      .catch(logError('useCvAccess'));
    return () => {
      alive = false;
    };
  }, [key, enabled]);

  // Ket qua cua danh sach khac (chua tai xong danh sach moi) coi nhu chua co ai
  return enabled && state.key === key ? state.ids : NONE;
}
