import { lazy } from 'react';

// Các hộp thoại / bảng nặng chỉ tải MÃ khi người dùng mở lần đầu (React.lazy), để không nằm trong gói JS ban đầu.
// Dùng kèm <Suspense fallback={<ModalLoading />}>. Nhiều nơi cùng import một module nên chỉ có một chunk.
export const CardModal = lazy(() => import('./CardModal'));
export const CreateBoardDialog = lazy(() => import('./CreateBoardDialog'));
export const AiGenerateBoardModal = lazy(() => import('./AiGenerateBoardModal'));
