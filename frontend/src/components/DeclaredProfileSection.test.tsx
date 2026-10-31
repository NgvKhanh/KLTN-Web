import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeclaredCvUploadResult, DeclaredProfile } from '../types/assign';
import DeclaredProfileSection from './DeclaredProfileSection';

// Mục "Hồ sơ kỹ năng" ở trang Hồ sơ: mock lớp gọi API (đã có test riêng ở lib/api/assign.test.ts) và kiểm HÀNH VI: tải, sửa, lưu
// đúng thân yêu cầu, tải CV lên (máy chủ đọc thẳng nội dung tệp, KHÔNG có ô sửa chữ CV; phần đang sửa dở giữ nguyên),
// xoá CV có xác nhận, lỗi hiện rõ.

const mocks = vi.hoisted(() => ({
  fetchDeclaredProfile: vi.fn(),
  saveDeclaredProfile: vi.fn(),
  uploadDeclaredCv: vi.fn(),
  deleteDeclaredCv: vi.fn(),
}));
vi.mock('../lib/api/assign', () => ({
  fetchDeclaredProfile: mocks.fetchDeclaredProfile,
  saveDeclaredProfile: mocks.saveDeclaredProfile,
  uploadDeclaredCv: mocks.uploadDeclaredCv,
  deleteDeclaredCv: mocks.deleteDeclaredCv,
  myCvUrl: () => 'http://api.test/me/assign-profile/cv',
}));

const EMPTY: DeclaredProfile = { useForAssign: true, cvShared: false, skillsText: '', workItems: [], cv: null, cvText: null };
const FILLED: DeclaredProfile = {
  useForAssign: true,
  cvShared: false,
  skillsText: 'React, SQL',
  workItems: [{ id: 'a1', title: 'Trang quản trị', description: 'Dashboard' }],
  cv: { fileName: 'CV Lan.pdf', size: 153_600, uploadedAt: '2026-09-20T05:00:00.000Z' },
  cvText: 'Kinh nghiệm React 2 năm',
};

async function setup(p: DeclaredProfile = EMPTY) {
  mocks.fetchDeclaredProfile.mockResolvedValue(p);
  const utils = render(<DeclaredProfileSection />);
  await screen.findByRole('button', { name: 'Lưu hồ sơ' });
  return utils;
}

const skills = () => screen.getByLabelText('Kỹ năng') as HTMLTextAreaElement;
const saveBtn = () => screen.getByRole('button', { name: 'Lưu hồ sơ' });
const cvFile = () => screen.getByTestId('cv-file') as HTMLInputElement;
const pick = (file: File) => fireEvent.change(cvFile(), { target: { files: [file] } });
const pdf = () => new File(['%PDF-1.4'], 'cv moi.pdf', { type: 'application/pdf' });

function axiosErr(status: number, message: string) {
  return new AxiosError(message, String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { success: false, message },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('DeclaredProfileSection - tải và hiển thị', () => {
  it('đang tải -> "Đang tải…"; hồ sơ trống: công tắc bật, không công việc, chưa có CV, không có ô chữ CV, Lưu khoá', async () => {
    let resolve!: (p: DeclaredProfile) => void;
    mocks.fetchDeclaredProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<DeclaredProfileSection />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');
    await act(async () => resolve(EMPTY));
    expect(screen.getByRole('checkbox', { name: /Dùng hồ sơ này cho gợi ý phân công/ })).toBeChecked();
    expect(skills().value).toBe('');
    expect(screen.getByText('Chưa có công việc nào.')).toBeInTheDocument();
    expect(screen.getByText('Chưa tải CV lên.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải CV lên' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xoá CV' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nội dung CV dùng cho gợi ý')).not.toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('hồ sơ đã có: kỹ năng, công việc, CV (tên, cỡ, ngày, link tải về của mình); KHÔNG hiện chữ CV ra ô để sửa', async () => {
    await setup(FILLED);
    expect(skills().value).toBe('React, SQL');
    expect((screen.getByLabelText('Tên công việc 1') as HTMLInputElement).value).toBe('Trang quản trị');
    expect((screen.getByLabelText('Mô tả công việc 1') as HTMLTextAreaElement).value).toBe('Dashboard');
    expect(screen.getByText('CV Lan.pdf')).toBeInTheDocument();
    expect(screen.getByText(/150,0 KB · tải lên 20\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tải về' })).toHaveAttribute('href', 'http://api.test/me/assign-profile/cv');
    expect(screen.getByRole('button', { name: 'Thay CV' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nội dung CV dùng cho gợi ý')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Kinh nghiệm React 2 năm');
    expect(screen.queryByText(/Chưa có nội dung đọc từ tệp|nhập tay trước đây/)).not.toBeInTheDocument();
  });

  it('lỗi tải -> thông điệp + "Thử lại" gọi lại', async () => {
    mocks.fetchDeclaredProfile.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(EMPTY);
    render(<DeclaredProfileSection />);
    expect(await screen.findByText(/Không tải được hồ sơ kỹ năng\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: 'Lưu hồ sơ' })).toBeInTheDocument();
    expect(mocks.fetchDeclaredProfile).toHaveBeenCalledTimes(2);
  });
});

describe('DeclaredProfileSection - sửa và lưu', () => {
  it('sửa kỹ năng, thêm công việc, tắt công tắc -> Lưu gửi ĐÚNG thân (việc mới không id, mô tả rỗng = null); xong -> thông báo, Lưu khoá lại', async () => {
    await setup(FILLED);
    fireEvent.change(skills(), { target: { value: 'React, SQL, Docker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm công việc' }));
    fireEvent.change(screen.getByLabelText('Tên công việc 2'), { target: { value: 'Ứng dụng đặt lịch' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Dùng hồ sơ này/ }));
    const savedProfile: DeclaredProfile = {
      ...FILLED,
      useForAssign: false,
      skillsText: 'React, SQL, Docker',
      workItems: [...FILLED.workItems, { id: 'b2', title: 'Ứng dụng đặt lịch', description: null }],
    };
    mocks.saveDeclaredProfile.mockResolvedValue(savedProfile);
    expect(saveBtn()).toBeEnabled();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.saveDeclaredProfile).toHaveBeenCalledTimes(1));
    expect(mocks.saveDeclaredProfile).toHaveBeenCalledWith({
      useForAssign: false,
      cvShared: false,
      skillsText: 'React, SQL, Docker',
      workItems: [
        { id: 'a1', title: 'Trang quản trị', description: 'Dashboard' },
        { title: 'Ứng dụng đặt lịch', description: null },
      ],
      cvText: 'Kinh nghiệm React 2 năm',
    });
    expect(await screen.findByText('Đã lưu hồ sơ kỹ năng.')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).not.toBeInTheDocument();
  });

  it('xoá một công việc; "Hoàn tác" trả về như đã lưu', async () => {
    await setup(FILLED);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá công việc 1' }));
    expect(screen.queryByLabelText('Tên công việc 1')).not.toBeInTheDocument();
    expect(saveBtn()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect((screen.getByLabelText('Tên công việc 1') as HTMLInputElement).value).toBe('Trang quản trị');
    expect(saveBtn()).toBeDisabled();
  });

  it('lỗi dữ liệu (công việc chưa có tên, kỹ năng quá dài) -> liệt kê lỗi, KHOÁ Lưu; sửa xong thì mở', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm công việc' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Công việc 1 chưa có tên.');
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Tên công việc 1'), { target: { value: 'Việc A' } });
    fireEvent.change(skills(), { target: { value: 'x'.repeat(2001) } });
    expect(screen.getByRole('alert')).toHaveTextContent('Kỹ năng tối đa 2000 ký tự.');
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(skills(), { target: { value: 'React' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(saveBtn()).toBeEnabled();
  });

  it('không thêm quá 30 công việc (nút khoá ở 30)', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, title: `Việc ${i}`, description: null }));
    await setup({ ...EMPTY, workItems: many });
    expect(screen.getByRole('button', { name: 'Thêm công việc' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá công việc 30' }));
    expect(screen.getByRole('button', { name: 'Thêm công việc' })).toBeEnabled();
  });

  it('lưu thất bại -> hiện thông điệp của máy chủ, giữ bản nháp', async () => {
    await setup();
    mocks.saveDeclaredProfile.mockRejectedValue(axiosErr(400, 'Kỹ năng tối đa 2000 ký tự'));
    fireEvent.change(skills(), { target: { value: 'React' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Kỹ năng tối đa 2000 ký tự')).toBeInTheDocument();
    expect(skills().value).toBe('React');
    expect(saveBtn()).toBeEnabled();
  });
});

describe('DeclaredProfileSection - CV', () => {
  it('tải CV lên: gửi đúng tệp; báo đã lưu + số ký tự đọc được, KHÔNG hiện chữ ra ô để sửa; phần kỹ năng ĐANG SỬA DỞ giữ nguyên', async () => {
    await setup();
    fireEvent.change(skills(), { target: { value: 'React (chưa lưu)' } });
    const result: DeclaredCvUploadResult = {
      cv: { fileName: 'cv moi.pdf', size: 2048, uploadedAt: '2026-09-28T05:00:00.000Z' },
      text: 'Kinh nghiệm thiết kế giao diện',
      truncated: false,
      profile: { ...EMPTY, cv: { fileName: 'cv moi.pdf', size: 2048, uploadedAt: '2026-09-28T05:00:00.000Z' }, cvText: 'Kinh nghiệm thiết kế giao diện' },
    };
    mocks.uploadDeclaredCv.mockResolvedValue(result);
    const file = pdf();
    pick(file);
    await waitFor(() => expect(mocks.uploadDeclaredCv).toHaveBeenCalledWith(file));
    expect(
      await screen.findByText('Đã lưu CV, gợi ý phân công sẽ dùng nội dung trong tệp (đọc được 30 ký tự).')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Nội dung CV dùng cho gợi ý')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Kinh nghiệm thiết kế giao diện');
    expect(skills().value).toBe('React (chưa lưu)');
    expect(screen.getByText('cv moi.pdf')).toBeInTheDocument();
    // CV đã lưu ở máy chủ; phần kỹ năng thì chưa -> vẫn còn thay đổi để lưu
    expect(saveBtn()).toBeEnabled();
  });

  it('tệp dài bị cắt -> nói rõ "chỉ dùng phần đầu"; lỗi đọc tệp -> thông điệp của máy chủ', async () => {
    await setup();
    mocks.uploadDeclaredCv.mockResolvedValueOnce({ cv: FILLED.cv!, text: 'abc', truncated: true, profile: { ...EMPTY, cv: FILLED.cv, cvText: 'abc' } });
    pick(pdf());
    expect(await screen.findByText(/tệp dài nên chỉ dùng phần đầu/)).toBeInTheDocument();
    mocks.uploadDeclaredCv.mockRejectedValueOnce(axiosErr(400, 'Nội dung tệp không phải PDF (sai đuôi tệp hoặc tệp hỏng)'));
    pick(pdf());
    expect(await screen.findByText('Nội dung tệp không phải PDF (sai đuôi tệp hoặc tệp hỏng)')).toBeInTheDocument();
  });

  it('Xoá CV: hỏi xác nhận (Huỷ thì không gọi); đồng ý -> deleteDeclaredCv, về "Chưa tải CV lên."', async () => {
    await setup(FILLED);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá CV' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('kỹ năng và công việc đã khai vẫn giữ nguyên');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
    expect(mocks.deleteDeclaredCv).not.toHaveBeenCalled();

    mocks.deleteDeclaredCv.mockResolvedValue({ ...FILLED, cv: null, cvText: null });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá CV' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xoá CV' }));
    await waitFor(() => expect(mocks.deleteDeclaredCv).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Đã xoá CV (cả tệp và phần chữ).')).toBeInTheDocument();
    expect(screen.getByText('Chưa tải CV lên.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('dữ liệu cũ: có tệp CV nhưng chữ CV đã bị xoá hết -> nhắc tải lại CV để dùng cho gợi ý', async () => {
    await setup({ ...FILLED, cvText: null });
    expect(
      screen.getByText('Chưa có nội dung đọc từ tệp này. Tải lại CV để dùng cho gợi ý phân công.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thay CV' })).toBeInTheDocument();
  });

  it('dữ liệu cũ: chữ CV gõ tay (không có tệp) -> nói rõ đang được dùng, có nút "Xoá CV" để bỏ', async () => {
    await setup({ ...EMPTY, cvText: 'Chữ CV gõ tay' });
    expect(screen.getByRole('button', { name: 'Xoá CV' })).toBeInTheDocument();
    expect(screen.getByText('Chưa tải CV lên.')).toBeInTheDocument();
    expect(screen.getByText(/Gợi ý đang dùng phần chữ CV bạn nhập tay trước đây/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nội dung CV dùng cho gợi ý')).not.toBeInTheDocument();
  });
});

describe('DeclaredProfileSection - công tắc chia sẻ CV (mặc định tắt)', () => {
  const shareSwitch = () => screen.getByRole('checkbox', { name: /Cho phép quản trị bảng/ });

  it('mặc định TẮT; bật rồi Lưu gửi cvShared: true', async () => {
    await setup(FILLED);
    expect(shareSwitch()).not.toBeChecked();
    fireEvent.click(shareSwitch());
    expect(shareSwitch()).toBeChecked();
    mocks.saveDeclaredProfile.mockResolvedValue({ ...FILLED, cvShared: true });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.saveDeclaredProfile).toHaveBeenCalledTimes(1));
    expect(mocks.saveDeclaredProfile).toHaveBeenCalledWith(expect.objectContaining({ cvShared: true }));
    expect(await screen.findByText('Đã lưu hồ sơ kỹ năng.')).toBeInTheDocument();
  });

  it('hồ sơ đã chia sẻ hiện công tắc BẬT; tắt lại thì có thay đổi chưa lưu', async () => {
    await setup({ ...FILLED, cvShared: true });
    expect(shareSwitch()).toBeChecked();
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(shareSwitch());
    expect(saveBtn()).toBeEnabled();
  });

  it('tắt "Dùng hồ sơ này cho gợi ý" thì giải thích rõ công tắc chia sẻ chưa có tác dụng', async () => {
    await setup({ ...FILLED, cvShared: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /Dùng hồ sơ này/ }));
    expect(screen.getByText(/chưa có tác dụng vì bạn đã tắt/)).toBeInTheDocument();
  });
});
