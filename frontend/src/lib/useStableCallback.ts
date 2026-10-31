import { useCallback, useRef } from 'react';

/**
 * Tra ve MOT ham co dinh (khong doi qua cac lan render) nhung luon goi ban MOI NHAT cua `fn`.
 * Dung de truyen xu ly su kien xuong component da `memo`: ham tao lai moi lan render cha se lam memo
 * mat tac dung (vd moi lan the doi cot khi keo tha, ca 5 cot va ~75 the ve lai).
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
