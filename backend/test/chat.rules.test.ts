// Bo luat hieu cau hoi - nhanh B0 (CHATBOT_MODULE.md §10.1, §4.1, §8.2).
import { describe, expect, it } from 'vitest';
import { foldText } from '../src/modules/ai/ai.rules';
import {
  CHAT_FOCUSES,
  CHAT_INTENTS,
  CHAT_PERIODS,
  type ChatFocus,
  type ChatIntent,
  type ChatPeriod,
  type ParsedQuestion,
} from '../src/modules/chat/chat.intent';
import type { EntityCatalog } from '../src/modules/chat/chat.entities';
import { matchMember, type RosterMember } from '../src/modules/chat/chat.members';
import { parseByRules } from '../src/modules/chat/chat.rules';

const ROSTER: RosterMember[] = [
  { userId: 'lan1', name: 'Nguyễn Thị Lan' },
  { userId: 'lan2', name: 'Trần Lan' },
  { userId: 'minh', name: 'Hoàng Minh' },
  { userId: 'binh', name: 'Bình' },
  { userId: 'tanh', name: 'Tuấn Anh' },
];

/** Danh sach nguoi co ten TRUNG voi tu chi thoi gian / tu thuong khi bo dau. */
const TRAPS: RosterMember[] = [
  { userId: 'tuan', name: 'Lê Văn Tuấn' },
  { userId: 'tuanp', name: 'Tuan' }, // ten luu khong dau
  { userId: 'mai', name: 'Phạm Mai' },
  { userId: 'nam', name: 'Đỗ Nam' },
  { userId: 'an', name: 'Võ An' },
  { userId: 'thang', name: 'Trịnh Thắng' },
  { userId: 'minh', name: 'Minh' },
];

function P(
  intent: ChatIntent,
  period: ChatPeriod | null = null,
  focus: ChatFocus | null = null,
  member: string | null = null
): ParsedQuestion {
  return { intent, period, focus, member };
}

describe('parseByRules - cau hoi mau', () => {
  it('bon nhom cau hoi, thao tac va ngoai pham vi', () => {
    const cases: [string, ParsedQuestion][] = [
      // Viec ca nhan
      ['Việc nào của tôi sắp đến hạn?', P('MY_TASKS', 'NEXT_7_DAYS', 'OPEN')],
      ['Tuần sau tôi có việc gì?', P('MY_TASKS', 'NEXT_WEEK')],
      ['Tôi có việc gì quá hạn không?', P('MY_TASKS', null, 'OVERDUE')],
      ['Tuần này tôi xong những gì?', P('MY_TASKS', 'THIS_WEEK', 'DONE')],
      ['Việc chưa xong nào của tôi quá hạn?', P('MY_TASKS', null, 'OVERDUE')],
      ['Thẻ nào của tôi đang bị kẹt?', P('MY_TASKS', null, 'BLOCKED')],
      ['Kết thúc tuần này tôi còn việc gì?', P('MY_TASKS', 'THIS_WEEK')], // "kết thúc" khong phai "kẹt"
      ['ket thuc tuan nay toi con viec gi', P('MY_TASKS', 'THIS_WEEK')], // khong dau: "ket" + "thuc" khong phai "kẹt"
      ['Em có việc gì quá hạn không?', P('MY_TASKS', null, 'OVERDUE')],
      ['Tiến độ của em thế nào?', P('MY_TASKS')], // "em" tu xung -> khong phai tien do nhom
      ['Việc nào được giao cho tôi?', P('MY_TASKS')], // "được giao" khong phai thao tac
      ['mai tôi có việc gì', P('MY_TASKS', 'TOMORROW')],
      ['Việc nào 7 ngày tới của tôi?', P('MY_TASKS', 'NEXT_7_DAYS')],
      ['Có việc nào trễ hạn không?', P('MY_TASKS', null, 'OVERDUE')],
      ['Tiến độ của tôi thế nào?', P('MY_TASKS')],
      ['Việc của anh ấy', P('MY_TASKS')], // "anh ấy" khong phai ten "Tuấn Anh" (gioi han da biet: hieu la viec cua toi)
      ['Hôm nay và tuần sau tôi có việc gì?', P('MY_TASKS', 'TODAY')], // nhieu ky -> ky nhac TRUOC
      ['Tôi chán việc này quá', P('MY_TASKS')], // "chán" go co dau khong phai "chặn"
      // Uu tien
      ['Hôm nay tôi nên xử lý gì trước?', P('MY_PRIORITIES', 'TODAY')],
      ['Tôi nên ưu tiên việc nào?', P('MY_PRIORITIES')],
      ['Lan nên làm gì trước?', P('MEMBER_TASKS', null, null, 'lan')],
      // Mot nguoi
      ['Lan đang làm gì, đã xong những việc nào?', P('MEMBER_TASKS', null, null, 'lan')],
      ['Minh đang làm gì?', P('MEMBER_TASKS', null, 'OPEN', 'minh')],
      ['viec cua Minh qua han', P('MEMBER_TASKS', null, 'OVERDUE', 'minh')],
      ['Bình đã hoàn thành những gì tuần trước?', P('MEMBER_TASKS', 'LAST_WEEK', 'DONE', 'bình')],
      ['Việc của chị Lan', P('MEMBER_TASKS', null, null, 'lan')],
      ['Tuấn Anh có việc gì quá hạn?', P('MEMBER_TASKS', null, 'OVERDUE', 'tuấn anh')],
      ['Nguyễn Thị Lan đang giữ những việc gì?', P('MEMBER_TASKS', null, 'OPEN', 'nguyễn thị lan')],
      ['Lan?', P('MEMBER_TASKS', null, null, 'lan')],
      ['Tuần này Lan thế nào?', P('MEMBER_TASKS', 'THIS_WEEK', null, 'lan')], // chi nho viet hoa giua cau
      ['Việc của Lan trong dự án?', P('MEMBER_TASKS', null, null, 'lan')], // co ca ten lan tu chi nhom -> ten thang
      // Nhom
      ['Tuần này nhóm hoàn thành gì, còn vướng gì?', P('TEAM_SUMMARY', 'THIS_WEEK')], // xong + vuong -> tong quan
      ['Nhóm có việc nào quá hạn?', P('TEAM_SUMMARY', null, 'OVERDUE')],
      ['bảng này có việc nào bị chặn không', P('TEAM_SUMMARY', null, 'BLOCKED')],
      ['Việc nào chưa giao?', P('TEAM_SUMMARY')],
      ['Tiến độ dự án tuần này thế nào?', P('TEAM_SUMMARY', 'THIS_WEEK')],
      ['Tuần trước nhóm xong bao nhiêu việc?', P('TEAM_SUMMARY', 'LAST_WEEK', 'DONE')],
      ['Ai đang có nhiều việc?', P('TEAM_WORKLOAD')],
      ['Mỗi người đang giữ bao nhiêu việc?', P('TEAM_WORKLOAD', null, 'OPEN')],
      ['Ai rảnh nhất tuần này?', P('TEAM_WORKLOAD', 'THIS_WEEK')],
      ['Ai quá tải?', P('TEAM_WORKLOAD')],
      ['khối lượng công việc của mọi người', P('TEAM_WORKLOAD')],
      // Thao tac / ngoai pham vi
      ['Tạo thẻ mới cho Lan', P('UNSUPPORTED')],
      ['Giao việc này cho Minh', P('UNSUPPORTED')],
      ['Xoá các thẻ quá hạn của tôi', P('UNSUPPORTED')],
      ['Đổi hạn thẻ này sang thứ 6', P('UNSUPPORTED')],
      ['doi han the nay', P('UNSUPPORTED')],
      ['Email của Lan là gì?', P('UNSUPPORTED')],
      ['Số điện thoại của Minh?', P('UNSUPPORTED')],
      ['Hồ sơ của Lan', P('UNSUPPORTED')],
      ['xin chào', P('UNSUPPORTED')],
      ['', P('UNSUPPORTED')],
      ['còn gì nữa không?', P('UNSUPPORTED')], // dau hieu noi tiep nhung khong co tham so nao
      // Cau noi tiep (NONE: chat.followup quyet dinh)
      ['còn Minh thì sao?', P('NONE', null, null, 'minh')],
      ['còn tuần sau thì sao?', P('NONE', 'NEXT_WEEK')],
      ['còn tôi?', P('NONE', null, null, 'tôi')],
      ['còn em thì sao?', P('NONE', null, null, 'tôi')],
      ['tuần sau?', P('NONE', 'NEXT_WEEK')],
      ['Vậy còn quá hạn?', P('NONE', null, 'OVERDUE')],
      ['Quá hạn thì sao?', P('NONE', null, 'OVERDUE')], // dau hieu noi tiep o CUOI cau
      ['Thời tiết hôm nay thế nào?', P('NONE', 'TODAY')], // khong co ngu canh truoc -> followup tra UNSUPPORTED
      ['còn việc nào của tôi bị chặn?', P('MY_TASKS', null, 'BLOCKED')], // co tu "việc" -> cau hoi moi
    ];
    for (const [q, expected] of cases) expect(parseByRules(q, ROSTER), q).toEqual(expected);
  });

  it('tu vung bo sung sau khi chay tap dev (buoc 8): "gấp", "đến hạn", "từng thành viên"', () => {
    const roster: RosterMember[] = [...ROSTER, { userId: 'tung', name: 'Nguyễn Sơn Tùng' }];
    const cases: [string, ParsedQuestion][] = [
      // "gấp" -> uu tien; "gặp" va "gap" khong dau dung mot minh KHONG phai uu tien
      ['Việc nào cần làm gấp?', P('MY_PRIORITIES', null, 'OPEN')],
      ['viec nao can lam gap', P('MY_PRIORITIES', null, 'OPEN')], // khong dau: chi nhan cum "làm gap"
      ['Việc gấp của tôi', P('MY_PRIORITIES')],
      ['Hôm nay tôi gặp ai?', P('MY_TASKS', 'TODAY')],
      ['hom nay toi gap ai', P('MY_TASKS', 'TODAY')],
      ['Tạo việc gấp cho Lan', P('UNSUPPORTED')], // thao tac van thang
      // "đến hạn" = chua xong (khac "quá hạn")
      ['Bảng này tuần sau có những việc nào đến hạn?', P('TEAM_SUMMARY', 'NEXT_WEEK', 'OPEN')],
      ['viec nao cua toi den han hom nay', P('MY_TASKS', 'TODAY', 'OPEN')],
      ['Việc nào chưa đến hạn?', P('MY_TASKS', null, 'OPEN')],
      ['Lan có việc nào đến hạn không?', P('MEMBER_TASKS', null, 'OPEN', 'lan')],
      ['Việc quá hạn hay đến hạn của tôi?', P('MY_TASKS', null, 'OVERDUE')], // cu the hon thang
      ['Việc nào sắp đến hạn?', P('MY_TASKS', 'NEXT_7_DAYS', 'OPEN')], // van la cum thoi gian
      // "từng người / từng thành viên / mỗi thành viên" nhu "mỗi người"
      ['Số việc của từng thành viên là bao nhiêu?', P('TEAM_WORKLOAD')],
      ['mỗi thành viên đang giữ bao nhiêu việc', P('TEAM_WORKLOAD', null, 'OPEN')],
      ['So viec cua tung nguoi', P('TEAM_WORKLOAD')],
      ['Từng người có bao nhiêu việc?', P('TEAM_WORKLOAD')],
      ['Việc nào của từng người quá hạn?', P('TEAM_SUMMARY', null, 'OVERDUE')], // khong co tu chi so luong -> khong phai luong viec
      // Ten "Tùng" trung "từng" khi bo dau: van la ten
      ['Tùng đang làm gì?', P('MEMBER_TASKS', null, 'OPEN', 'tùng')],
      ['Số việc của Tùng là bao nhiêu?', P('MEMBER_TASKS', null, null, 'tùng')],
    ];
    const wrong = cases.filter(([q, want]) => JSON.stringify(parseByRules(q, roster)) !== JSON.stringify(want)).map(([q]) => q);
    expect(wrong).toEqual([]);
  });

  it('danh muc truy van (buoc 10, §18): 4 y dinh moi + ten bang / khong gian / cot; cau gan giong GIU y dinh cu', () => {
    const roster: RosterMember[] = [...ROSTER, { userId: 'khanh', name: 'Khánh' }];
    const catalog: EntityCatalog = {
      workspaces: [
        { id: 'w1', name: 'Nhóm Demo' },
        { id: 'w2', name: 'Không gian của Khánh' },
      ],
      boards: [
        { id: 'b1', name: '1234', workspaceId: 'w2', workspaceName: 'Không gian của Khánh' },
        { id: 'b2', name: 'khanh', workspaceId: 'w2', workspaceName: 'Không gian của Khánh' },
        { id: 'b3', name: 'Kế hoạch Marketing ra mắt', workspaceId: 'w1', workspaceName: 'Nhóm Demo' },
        { id: 'b4', name: 'Dự án Demo', workspaceId: 'w1', workspaceName: 'Nhóm Demo' },
      ],
      columns: [
        { id: 'c1', name: 'Đang làm', boardId: 'b1' },
        { id: 'c2', name: 'Cần làm', boardId: 'b1' },
        { id: 'c3', name: 'Hoàn thành', boardId: 'b4' },
      ],
    };
    const C = (intent: ChatIntent, target?: string, column?: string): ParsedQuestion => ({
      ...P(intent),
      ...(target === undefined ? {} : { target }),
      ...(column === undefined ? {} : { column }),
    });
    const cases: [string, ParsedQuestion][] = [
      // MY_BOARDS
      ['Tôi đang ở trong bao nhiêu bảng?', C('MY_BOARDS')],
      ['tôi có tổng cộng bao nhiêu bảng', C('MY_BOARDS')],
      ['Tôi có những bảng nào?', C('MY_BOARDS')],
      ['bảng của tôi', C('MY_BOARDS')],
      ['Các bảng trong không gian Nhóm Demo', C('MY_BOARDS', 'Nhóm Demo')],
      ['toi o bao nhieu bang', C('MY_BOARDS')], // khong dau
      // MY_WORKSPACES
      ['Tôi thuộc những không gian nào?', C('MY_WORKSPACES')],
      ['Có bao nhiêu không gian?', C('MY_WORKSPACES')],
      ['Không gian của tôi', C('MY_WORKSPACES')],
      // MEMBER_LIST
      ['Bảng 1234 có những ai?', C('MEMBER_LIST', '1234')],
      ['Bảng này có bao nhiêu thành viên?', C('MEMBER_LIST')],
      ['Không gian Nhóm Demo có bao nhiêu người?', C('MEMBER_LIST', 'Nhóm Demo')],
      ['Trong bảng khanh có ai?', C('MEMBER_LIST', 'khanh')], // "khanh" la bang, khong phai nguoi (Khánh)
      ['Danh sách thành viên của bảng Dự án Demo', C('MEMBER_LIST', 'Dự án Demo')],
      // CARD_COUNTS
      ['Bảng 1234 có bao nhiêu thẻ?', C('CARD_COUNTS', '1234')],
      ['Cột Đang làm có mấy thẻ?', C('CARD_COUNTS', undefined, 'Đang làm')], // "Đang làm" la ten cot, khong phai tinh trang
      ['Cột Đang làm của bảng 1234 có bao nhiêu thẻ?', C('CARD_COUNTS', '1234', 'Đang làm')],
      ['Mỗi bảng có bao nhiêu thẻ?', C('CARD_COUNTS')],
      ['bang 1234 co bao nhieu the', C('CARD_COUNTS', '1234')],
      ['Bảng Kế hoạch Marketing có bao nhiêu thẻ?', C('CARD_COUNTS', 'Kế hoạch Marketing')], // phan dau cua ten
      ['Không gian Nhóm Demo có bao nhiêu thẻ?', C('CARD_COUNTS', 'Nhóm Demo')],
      // GAN GIONG: giu y dinh cu
      ['Bảng này tuần sau có những việc nào đến hạn?', P('TEAM_SUMMARY', 'NEXT_WEEK', 'OPEN')],
      ['Bảng nào bị chặn?', P('MY_TASKS', null, 'BLOCKED')],
      ['Tôi có bao nhiêu thẻ chưa xong?', P('MY_TASKS', null, 'OPEN')],
      ['Tôi có bao nhiêu thẻ ở bảng 1234?', P('MY_TASKS')], // "cua toi" + the = viec ca nhan
      ['Khánh có bao nhiêu việc?', P('MEMBER_TASKS', null, null, 'khánh')],
      ['Nhóm có việc nào quá hạn?', P('TEAM_SUMMARY', null, 'OVERDUE')],
      ['Mỗi người đang giữ bao nhiêu việc?', P('TEAM_WORKLOAD', null, 'OPEN')],
      ['Ai đang có nhiều việc?', P('TEAM_WORKLOAD')],
      ['Thành viên nào đang bị chặn việc?', P('TEAM_SUMMARY', null, 'BLOCKED')],
      ['Không gian này có việc nào quá hạn?', P('TEAM_SUMMARY', null, 'OVERDUE')],
      ['Hôm nay tôi nên làm gì trước?', P('MY_PRIORITIES', 'TODAY')],
      // ten KHONG co trong danh muc: bo luat DOAN ten (den tu khong the la ten) de tra loi "khong tim thay", khong bo qua ten
      ['Bảng bí mật có bao nhiêu thẻ?', C('CARD_COUNTS', 'bí mật')],
      ['Bảng bí mật có những ai?', C('MEMBER_LIST', 'bí mật')],
      ['Không gian xyz có bao nhiêu người?', C('MEMBER_LIST', 'xyz')],
      ['Cột Kiểm thử có mấy thẻ?', C('CARD_COUNTS', undefined, 'Kiểm thử')],
      ['Trong bảng zzz có bao nhiêu thẻ?', C('CARD_COUNTS', 'zzz')],
      // ten chi KHOP MOT PHAN DAU nhung con tu dinh theo -> la ten khac, KHONG doc thanh bang co ten bat dau giong nhau
      ['Bảng Kế hoạch Quý 9 có bao nhiêu thẻ?', C('CARD_COUNTS', 'Kế hoạch Quý 9')],
      ['Bảng Dự án Xyz có những ai?', C('MEMBER_LIST', 'Dự án Xyz')],
      // ... con phan dau dung ranh gioi (het cau / tu ke tiep khong the la ten) thi la ten that
      ['Bảng Dự án có những ai?', C('MEMBER_LIST', 'Dự án')],
      ['Bảng Kế hoạch Marketing ra mắt', P('UNSUPPORTED')],
      // ... nhung KHONG doan khi tu sau tu khoa la tu hoi / chi dinh / danh tu khac
      ['Bảng nào có bao nhiêu thẻ?', C('CARD_COUNTS')],
      ['Danh sách bảng của tôi', C('MY_BOARDS')],
      ['Bảng này có bao nhiêu thẻ?', C('CARD_COUNTS')],
      ['Bảng của tôi có bao nhiêu thẻ?', P('MY_TASKS')],
      // ten bang DUNG + thoi gian ngay sau: thoi gian van duoc doc, bang ten la dau hieu hoi ve viec cua ca nhom
      ['Bảng Kế hoạch Marketing ra mắt tuần này có việc nào đến hạn?', P('TEAM_SUMMARY', 'THIS_WEEK', 'OPEN')],
      // "tôi" ket thuc ten dang doan (khong nuot vao ten khong gian)
      ['Trong không gian Khánh tôi có bao nhiêu bảng?', C('MY_BOARDS', 'Khánh')],
      // dem the kem "chua xong" / "da hoan thanh": van la cau dem the (cau tra loi co san ca hai so); chi khi co ten bang
      ['Bảng 1234 còn bao nhiêu thẻ chưa xong?', C('CARD_COUNTS', '1234')],
      ['Bảng 1234 có bao nhiêu thẻ đã hoàn thành?', C('CARD_COUNTS', '1234')],
      ['Bảng này còn bao nhiêu thẻ chưa xong?', P('TEAM_SUMMARY', null, 'OPEN')], // khong co ten bang -> khong doan ra dem the
      // "mỗi / mọi / từng không gian": hoi ve TUNG khong gian (bang khong gian da co so bang + so thanh vien)
      ['Mỗi không gian có bao nhiêu thành viên?', C('MY_WORKSPACES')],
      ['Cho biết mọi không gian làm việc tôi tham gia và số thành viên của từng cái', C('MY_WORKSPACES')],
      // "không gian làm việc" la thuat ngu cua giao dien: "làm việc" khong la ten va khong la tu chi viec
      ['Tôi đang ở những không gian làm việc nào?', C('MY_WORKSPACES')],
      ['Các bảng trong không gian làm việc Nhóm Demo', C('MY_BOARDS', 'Nhóm Demo')],
      // hai ten cung loai: ten KHOP danh muc thang ten chi doan (bo luat khong lay ten dau tien mot cach mu quang)
      ['Bảng zzz có bao nhiêu thẻ ở bảng 1234?', C('CARD_COUNTS', '1234')],
      // tu chi viec: khong phai cau danh muc ("Bảng 1234 có những việc nào?" hoi ve viec cua ca nhom)
      ['Bảng 1234 có những việc nào?', P('TEAM_SUMMARY')],
      // thao tac / ngoai pham vi van thang
      ['Tạo bảng mới', P('UNSUPPORTED')],
      ['Xoá cột Đang làm', P('UNSUPPORTED')],
      ['Email của thành viên bảng 1234 là gì?', P('UNSUPPORTED')],
    ];
    const wrong = cases.filter(([q, want]) => JSON.stringify(parseByRules(q, roster, catalog)) !== JSON.stringify(want)).map(([q]) => q);
    expect(wrong).toEqual([]);

    // khong co danh muc: van nhan y dinh (tu khoa + cum so luong), chi khong lay duoc ten -> de LLM lo
    expect(parseByRules('Bảng 1234 có bao nhiêu thẻ?', roster)).toEqual(P('CARD_COUNTS'));
    expect(parseByRules('Trong bảng khanh có ai?', roster)).toEqual(P('MEMBER_LIST'));
    // ... va "Đang làm" khi KHONG biet la ten cot thi la tinh trang (hanh vi cu, cau bo qua danh muc)
    expect(parseByRules('Cột Đang làm có mấy thẻ?', roster).intent).not.toBe('CARD_COUNTS');
    // cau khong co tu khoa dung truoc ten: bo luat khong doan ten ("abc co bao nhieu the" thuoc ve LLM)
    expect(parseByRules('1234 có bao nhiêu thẻ?', roster, catalog)).not.toHaveProperty('target');
    // ten thuc the khong bi doc thanh thoi gian / nguoi: bang ten "tuần này" hay "Lan"
    const odd: EntityCatalog = {
      workspaces: [],
      boards: [
        { id: 'b9', name: 'tuần này', workspaceId: 'w', workspaceName: 'W' },
        { id: 'b8', name: 'Lan', workspaceId: 'w', workspaceName: 'W' },
      ],
      columns: [],
    };
    expect(parseByRules('Bảng tuần này có bao nhiêu thẻ?', roster, odd)).toEqual(C('CARD_COUNTS', 'tuần này'));
    expect(parseByRules('Bảng Lan có những ai?', roster, odd)).toEqual(C('MEMBER_LIST', 'Lan'));

    // ten bang BAT DAU bang chinh tu khoa ("Bảng công việc"): khong roi vao tu "việc" cua bo luat cau viec
    const startsWithCue: EntityCatalog = {
      workspaces: [{ id: 'w', name: 'công việc' }],
      boards: [{ id: 'b', name: 'Bảng công việc', workspaceId: 'w', workspaceName: 'công việc' }],
      columns: [],
    };
    expect(parseByRules('Bảng công việc có bao nhiêu thẻ?', roster, startsWithCue)).toEqual(C('CARD_COUNTS', 'Bảng công việc'));
    expect(parseByRules('Bảng Bảng công việc có bao nhiêu thẻ?', roster, startsWithCue)).toEqual(C('CARD_COUNTS', 'Bảng công việc'));
    expect(parseByRules('Không gian công việc có bao nhiêu thẻ?', roster, startsWithCue)).toEqual(C('CARD_COUNTS', 'công việc'));
  });

  it('tu de nham voi ten khi bo dau: tuần/Tuấn, mai/Mai, năm/Nam, an toàn/An, tháng/Thắng, mình/Minh', () => {
    const noMember: [string, ChatIntent, ChatPeriod | null][] = [
      ['Tuần sau tôi có việc gì?', 'MY_TASKS', 'NEXT_WEEK'],
      ['tuan sau toi co viec gi', 'MY_TASKS', 'NEXT_WEEK'],
      ['Việc của tuần sau', 'MY_TASKS', 'NEXT_WEEK'],
      ['Tuần tới nhóm cần làm gì?', 'TEAM_SUMMARY', 'NEXT_WEEK'],
      ['3 tuần nữa tôi có việc gì', 'MY_TASKS', null],
      ['2 tuần có việc gì của tôi', 'MY_TASKS', null], // so dung truoc "tuần"
      ['Đêm mai tôi có việc gì', 'MY_TASKS', 'TOMORROW'], // "đêm mai" khong nam trong cum thoi gian nhung van khong phai Mai
      ['Đêm mai có việc gì không?', 'MY_TASKS', 'TOMORROW'], // co dau hieu "có" ngay sau ma van khong phai Mai
      // Cum thoi gian ngay sau "của": co dau hieu ten nhung van phai loai
      ['viec cua thang nay', 'MY_TASKS', null],
      ['Tiến độ của năm nay', 'TEAM_SUMMARY', null],
      ['Việc của tuần vừa qua', 'MY_TASKS', 'LAST_WEEK'], // "vừa" khong o danh sach tu bo nghia -> nho cum thoi gian da chiem tu
      ['Ngày mai tôi có việc gì?', 'MY_TASKS', 'TOMORROW'],
      ['Sáng mai có việc gì?', 'MY_TASKS', 'TOMORROW'],
      ['ngay mai co viec gi', 'MY_TASKS', 'TOMORROW'],
      ['Năm nay nhóm xong bao nhiêu việc?', 'TEAM_SUMMARY', null],
      ['nam nay nhom xong bao nhieu viec', 'TEAM_SUMMARY', null],
      ['Việc an toàn của tôi', 'MY_TASKS', null],
      ['Tháng này tôi có việc gì?', 'MY_TASKS', null],
      ['thang nay toi co viec gi', 'MY_TASKS', null],
      ['mình có việc gì quá hạn', 'MY_TASKS', null],
      ['viec cua minh qua han', 'MY_TASKS', null], // ca cau khong dau: "minh" = "mình"
    ];
    for (const [q, intent, period] of noMember) {
      const r = parseByRules(q, TRAPS);
      expect(r.member, q).toBeNull();
      expect([r.intent, r.period], q).toEqual([intent, period]);
    }

    const withMember: [string, string, ChatPeriod | null][] = [
      ['Mai đang làm gì?', 'mai', null],
      ['Việc của Tuấn tuần sau', 'tuấn', 'NEXT_WEEK'],
      ['Nam có việc gì quá hạn?', 'nam', null],
      ['An đang làm gì?', 'an', null],
      ['Thắng đang làm gì?', 'thắng', null],
      ['Việc của minh', 'minh', null], // cau co dau ma "minh" khong dau -> la ten
      ['tuan dang lam gi', 'tuan', null], // khop ca "Tuấn" lan "Tuan" -> tang sau hoi lai
    ];
    for (const [q, member, period] of withMember) {
      const r = parseByRules(q, TRAPS);
      expect([r.intent, r.member, r.period], q).toEqual(['MEMBER_TASKS', member, period]);
    }
    // Ten nguoi chua tu khoa cua bo luat ("Trưởng Nhóm"): tu khoa dung mot minh khong la ten
    const boss = [{ userId: 'boss', name: 'Trưởng Nhóm' }, { userId: 'viec', name: 'Lê Việc' }];
    expect(parseByRules('Nhóm có việc nào quá hạn?', boss)).toEqual(P('TEAM_SUMMARY', null, 'OVERDUE'));
    expect(parseByRules('Việc của tôi có gì?', boss)).toEqual(P('MY_TASKS'));
    expect(parseByRules('Trưởng Nhóm có việc gì quá hạn?', boss)).toEqual(P('MEMBER_TASKS', null, 'OVERDUE', 'trưởng nhóm'));
    expect(parseByRules('Lê Việc đang làm gì?', boss)).toEqual(P('MEMBER_TASKS', null, 'OPEN', 'lê việc'));

    // ten luu KHONG dau ("Tuan") co the la Tuấn/Tuân/Tuần... -> khop ca hai cach go, tang sau hoi lai
    expect(matchMember('tuan', TRAPS).kind).toBe('MANY');
    expect(matchMember('tuấn', TRAPS).kind).toBe('MANY');
    expect(matchMember('Lê Văn Tuấn', TRAPS).kind).toBe('ONE');
  });

  it('go khong dau / NFD cho cung ket qua; cat cau dai qua 500 ky tu', () => {
    const questions = [
      'Việc nào của tôi sắp đến hạn?',
      'Hôm nay tôi nên xử lý gì trước?',
      'Lan đang làm gì, đã xong những việc nào?',
      'Tuần này nhóm hoàn thành gì, còn vướng gì?',
      'Ai đang có nhiều việc?',
      'Tuần sau tôi có việc gì?',
      'Tôi có việc gì quá hạn không?',
      'Tuần này tôi xong những gì?',
      'Bình đã hoàn thành những gì tuần trước?',
      'Mỗi người đang giữ bao nhiêu việc?',
      'Nhóm có việc nào quá hạn?',
      'Việc nào chưa giao?',
      'Tôi nên ưu tiên việc nào?',
      'còn Minh thì sao?',
      'còn tuần sau thì sao?',
      'Vậy còn quá hạn?',
      'Tuần trước nhóm xong bao nhiêu việc?',
    ];
    const key = (r: ParsedQuestion) => ({ ...r, member: r.member === null ? null : foldText(r.member) });
    // Bo dau nhung GIU hoa/thuong (nguoi go khong dau van viet hoa ten rieng)
    const plainOf = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
    for (const q of questions) {
      const base = parseByRules(q, ROSTER);
      expect(plainOf(q)).not.toMatch(/[^ -~]/u); // da thuc su khong dau
      expect(key(parseByRules(plainOf(q), ROSTER)), `khong dau: ${q}`).toEqual(key(base));
      expect(parseByRules(q.normalize('NFD'), ROSTER), `NFD: ${q}`).toEqual(base);
    }

    const tail = ' Lan đang làm gì';
    const long = 'x '.repeat(250) + tail; // phan "Lan..." nam sau ky tu thu 500
    expect(long.length).toBeGreaterThan(500);
    expect(parseByRules(long, ROSTER)).toEqual(P('UNSUPPORTED'));
    expect(parseByRules('x '.repeat(200) + tail, ROSTER).intent).toBe('MEMBER_TASKS');
  });

  it('tinh chat tren 3000 cau ngau nhien: khong nem loi, ket qua hop le va tat dinh; du nhanh', () => {
    const vocab = [
      'tôi', 'toi', 'mình', 'minh', 'Minh', 'Lan', 'lan', 'chị', 'anh', 'Tuấn', 'tuần', 'tuan', 'sau', 'này', 'nay',
      'trước', 'tới', 'hôm', 'ngày', 'mai', 'Mai', 'việc', 'viec', 'thẻ', 'hạn', 'quá', 'sắp', 'đến', 'xong', 'chưa',
      'hoàn', 'thành', 'bị', 'chặn', 'kẹt', 'vướng', 'nhóm', 'ai', 'nhiều', 'mọi', 'người', 'bao', 'nhiêu', 'nên',
      'làm', 'gì', 'ưu', 'tiên', 'còn', 'thì', 'sao', 'của', 'đang', 'có', 'không', 'tạo', 'giao', 'được', 'email',
      '7', 'bảy', 'Nguyễn', 'Thị', 'Bình', '?', ',', '!', '😀', '<script>', '...', '  ',
      // danh muc truy van (buoc 10): tu don + cum de bo sinh cham duoc ca 4 y dinh moi
      'bảng', 'cột', 'mấy', 'những', 'các', 'nào', 'thành viên', 'không gian', 'bao nhiêu bảng', 'bao nhiêu thẻ', 'bao nhiêu người', 'những ai',
    ];
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const intents = new Set<string>(CHAT_INTENTS);
    const periods = new Set<string>(CHAT_PERIODS);
    const focuses = new Set<string>(CHAT_FOCUSES);
    const seen = new Set<string>();
    const t0 = performance.now();
    for (let n = 0; n < 3000; n++) {
      const words = Array.from({ length: 1 + rand(14) }, () => vocab[rand(vocab.length)]);
      const q = words.join(rand(3) === 0 ? '' : ' ');
      const r = parseByRules(q, ROSTER);
      seen.add(r.intent);
      expect(intents.has(r.intent), q).toBe(true);
      expect(r.period === null || periods.has(r.period), q).toBe(true);
      expect(r.focus === null || focuses.has(r.focus), q).toBe(true);
      if (r.intent === 'UNSUPPORTED') expect([r.period, r.focus, r.member], q).toEqual([null, null, null]);
      if (r.intent === 'MEMBER_TASKS') expect(matchMember(r.member ?? '', ROSTER).kind, q).not.toBe('NONE');
      if (['MY_TASKS', 'MY_PRIORITIES', 'TEAM_SUMMARY', 'TEAM_WORKLOAD'].includes(r.intent)) {
        expect(r.member, q).toBeNull();
      }
      if (r.intent === 'NONE') expect(r.period !== null || r.focus !== null || r.member !== null, q).toBe(true);
      // 4 y dinh danh muc khong dung thoi gian / tinh trang / nguoi (§18.1)
      if (['MY_BOARDS', 'MY_WORKSPACES', 'MEMBER_LIST', 'CARD_COUNTS'].includes(r.intent)) expect([r.period, r.focus, r.member], q).toEqual([null, null, null]);
      expect(parseByRules(q, ROSTER), q).toEqual(r);
    }
    expect((performance.now() - t0) / 3000).toBeLessThan(5);
    expect([...seen].sort()).toEqual([...CHAT_INTENTS].sort()); // bo sinh cham duoc moi nhanh
  });
});
