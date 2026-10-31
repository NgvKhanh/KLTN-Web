import { useState } from 'react';
import LandingIcon from './LandingIcon';
import './BoardPreview.css';

const columns = [
  {
    title: 'Cần làm',
    tone: 'slate',
    cards: [
      {
        title: 'Viết nội dung trang giới thiệu',
        tag: 'Nội dung',
        tone: 'orange',
        person: 'LA',
        due: '24 Th10',
        checks: '0/3',
      },
      {
        title: 'Chuẩn bị bộ hình sản phẩm',
        tag: 'Thiết kế',
        tone: 'purple',
        person: 'MN',
        due: '25 Th10',
        checks: '1/4',
      },
    ],
  },
  {
    title: 'Đang làm',
    tone: 'purple',
    cards: [
      {
        title: 'Thiết kế giao diện website',
        tag: 'Thiết kế',
        tone: 'purple',
        person: 'HA',
        due: '22 Th10',
        checks: '3/5',
      },
      {
        title: 'Xây dựng trang sản phẩm',
        tag: 'Phát triển',
        tone: 'blue',
        person: 'KT',
        due: '24 Th10',
        checks: '2/4',
      },
    ],
  },
  {
    title: 'Hoàn thành',
    tone: 'green',
    cards: [
      {
        title: 'Thống nhất ý tưởng dự án',
        tag: 'Kế hoạch',
        tone: 'green',
        person: 'LA',
        due: '20 Th10',
        checks: '3/3',
      },
      {
        title: 'Phác thảo luồng người dùng',
        tag: 'Thiết kế',
        tone: 'purple',
        person: 'HA',
        due: '21 Th10',
        checks: '4/4',
      },
    ],
  },
] as const;

export default function BoardPreview() {
  const [view, setView] = useState<'board' | 'calendar'>('board');
  return (
    <div className="tf-preview" role="group" aria-label="Minh họa không gian làm việc TaskFlow">
      <div className="tf-preview-chrome">
        <span className="tf-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Không gian của nhóm</span>
        <span className="tf-demo-badge">Bản minh họa</span>
      </div>
      <div className="tf-preview-body">
        <div className="tf-preview-rail" aria-hidden="true">
          <span className="tf-rail-logo">T</span>
          <span className="tf-rail-selected">
            <LandingIcon name="board" />
          </span>
          <LandingIcon name="calendar" />
          <LandingIcon name="chart" />
          <LandingIcon name="team" />
          <span className="tf-rail-bottom tf-person tf-person-purple">MA</span>
        </div>
        <div className="tf-preview-content">
          <div className="tf-preview-heading">
            <h3>Ra mắt website mới</h3>
            <span
              className="tf-avatar-stack"
              role="img"
              aria-label="Nhóm minh họa gồm 3 thành viên"
            >
              <i className="tf-person tf-person-orange">LA</i>
              <i className="tf-person tf-person-purple">HA</i>
              <i className="tf-person tf-person-blue">KT</i>
            </span>
          </div>
          <div className="tf-preview-toolbar">
            <div role="group" aria-label="Chế độ xem minh họa">
              <button
                type="button"
                aria-pressed={view === 'board'}
                onClick={() => setView('board')}
              >
                <LandingIcon name="board" />
                Bảng Kanban
              </button>
              <button
                type="button"
                aria-pressed={view === 'calendar'}
                onClick={() => setView('calendar')}
              >
                <LandingIcon name="calendar" />
                Lịch
              </button>
            </div>
            <span className="tf-preview-filter">Lọc</span>
          </div>
          {view === 'board' ? (
            <div className="tf-kanban" role="group" aria-label="Bảng Kanban minh họa">
              {columns.map((column) => (
                <div className="tf-kanban-column" key={column.title}>
                  <div className="tf-column-title">
                    <span className={`tf-status-dot tf-dot-${column.tone}`} />
                    <span>{column.title}</span>
                    <small>{column.cards.length}</small>
                    <span className="tf-column-more" aria-hidden="true">
                      ···
                    </span>
                  </div>
                  {column.cards.map((card, index) => (
                    <div
                      className={`tf-task ${column.tone === 'purple' && index === 0 ? 'tf-task-featured' : ''}`}
                      key={card.title}
                    >
                      <span className={`tf-task-tag tf-tag-${card.tone}`}>{card.tag}</span>
                      <p>{card.title}</p>
                      {column.tone === 'purple' && index === 0 && (
                        <div className="tf-task-art" aria-hidden="true">
                          <span />
                          <div>
                            <i />
                            <i />
                            <i />
                          </div>
                        </div>
                      )}
                      <div className="tf-task-meta">
                        <span>
                          <LandingIcon name="clock" />
                          {card.due}
                        </span>
                        <span className={`tf-person tf-person-${card.tone}`}>{card.person}</span>
                      </div>
                      <div className="tf-task-footer">
                        <span>
                          <LandingIcon name="check" />
                          {card.checks}
                        </span>
                        <LandingIcon name="message" />
                      </div>
                    </div>
                  ))}
                  <span className="tf-sample-add" aria-hidden="true">
                    <LandingIcon name="plus" />
                    Thêm thẻ
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="tf-calendar-preview"
              role="group"
              aria-label="Lịch công việc minh họa tháng 10"
            >
              <div className="tf-calendar-heading">
                <strong>Tháng 10</strong>
                <span>Lịch ra mắt website</span>
              </div>
              <div className="tf-calendar-grid">
                {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => (
                  <span className="tf-calendar-day" key={day}>
                    {day}
                  </span>
                ))}
                {Array.from({ length: 21 }, (_, i) => i + 12).map((day) => (
                  <div key={day} className={day === 22 ? 'tf-calendar-today' : ''}>
                    <span>{day > 31 ? day - 31 : day}</span>
                    {day === 20 && <small className="tf-tag-green">Ý tưởng dự án</small>}
                    {day === 22 && <small className="tf-tag-purple">Thiết kế giao diện</small>}
                    {day === 24 && <small className="tf-tag-blue">Trang sản phẩm</small>}
                    {day === 25 && <small className="tf-tag-orange">Bộ hình sản phẩm</small>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
