// Dung tep .docx / .pdf THAT cho test buoc 7 (khong commit tep nhi phan tu soan, tru
// plan.vi.pdf do Edge xuat de kiem chu Viet co dau trong PDF that).
//
// .docx: file zip toi thieu do JSZip dung (dung dinh dang OOXML, mammoth doc duoc).
// .pdf : bo ghi PDF toi thieu (font Helvetica, chi ASCII) - du de thu so trang, dong, mat khau.

import JSZip from 'jszip';

// ===================== DOCX =====================

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Doan van: style (Heading1..) va/hoac danh sach (numId, cap) - danh sach 1 = bullet, 2 = danh so. */
export function para(text: string, opts: { style?: string; list?: [numId: number, level: number] } = {}): string {
  const style = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '';
  const num = opts.list ? `<w:numPr><w:ilvl w:val="${opts.list[1]}"/><w:numId w:val="${opts.list[0]}"/></w:numPr>` : '';
  return `<w:p><w:pPr>${style}${num}</w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

/** Bang: mang hang, moi hang la mang o. */
export function table(rows: string[][]): string {
  const cell = (t: string) => `<w:tc><w:tcPr/>${para(t)}</w:tc>`;
  return `<w:tbl><w:tblPr/><w:tblGrid/>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;
}

const NUMBERING_XML = `${XML_HEAD}<w:numbering ${W_NS}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

const STYLES_XML = `${XML_HEAD}<w:styles ${W_NS}>${[1, 2, 3]
  .map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`)
  .join('')}</w:styles>`;

/** Tai lieu Marketing co tieu de, gach dau dong long 2 cap, danh sach danh so, bang, ghi chu. */
export const RICH_BODY = [
  para('Kế hoạch Marketing Q4/2026', { style: 'Heading1' }),
  para('Giai đoạn 1: Chuẩn bị', { style: 'Heading2' }),
  para('Chốt thông điệp chiến dịch, hạn 20/10', { list: [1, 0] }),
  para('Soạn bản nháp', { list: [1, 1] }),
  para('Duyệt với giám đốc', { list: [1, 1] }),
  para('Thiết kế bộ nhận diện, hạn 25/10', { list: [1, 0] }),
  para('Giai đoạn 2: Triển khai', { style: 'Heading2' }),
  para('Chạy quảng cáo Facebook từ 1/11 đến 15/11', { list: [2, 0] }),
  para('Họp đánh giá cuối tháng 11', { list: [2, 0] }),
  table([
    ['Việc', 'Hạn'],
    ['Viết kịch bản', '18/9'],
  ]),
  para('Ghi chú: ngân sách 50 triệu.'),
].join('');

/**
 * Doan van chua 1 ANH nhung inline, tro toi quan he rId10 (buildDocx({ image }) tao quan he do).
 * Neu bo doc khong bo qua noi dung anh, mammoth se nhung ca anh dang base64 vao HTML.
 */
export const IMAGE_PARAGRAPH =
  '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
  '<wp:extent cx="990000" cy="792000"/><wp:docPr id="1" name="Picture 1" descr="anh"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="990000" cy="792000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';

export interface DocxOptions {
  /** Noi dung <w:body>. Mac dinh RICH_BODY. */
  body?: string;
  /** Anh nhung (them word/media/image1.png + quan he rId10 + 1 doan van tham chieu no vao cuoi body). */
  image?: Buffer;
  /** Tep them vao zip (vd anh trong word/media/, hoac tep gia mao). */
  extra?: Record<string, Buffer | string>;
  /** Bo word/document.xml (de tao zip "khong phai Word"). */
  omitDocument?: boolean;
  /** Muc nen; STORE de tao zip lon nhanh. */
  compression?: 'DEFLATE' | 'STORE';
}

export async function buildDocx(opts: DocxOptions = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${
      opts.image
        ? '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
        : ''
    }</Relationships>`
  );
  if (!opts.omitDocument) {
    const body = `${opts.body ?? RICH_BODY}${opts.image ? IMAGE_PARAGRAPH : ''}`;
    zip.file('word/document.xml', `${XML_HEAD}<w:document ${W_NS}><w:body>${body}</w:body></w:document>`);
  }
  if (opts.image) zip.file('word/media/image1.png', opts.image);
  zip.file('word/numbering.xml', NUMBERING_XML);
  zip.file('word/styles.xml', STYLES_XML);
  for (const [name, data] of Object.entries(opts.extra ?? {})) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: opts.compression ?? 'DEFLATE' });
}

// ===================== PDF =====================

const pdfEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * PDF toi thieu: moi phan tu cua `pages` la danh sach dong cua 1 trang (ASCII).
 * `encrypted` them tu dien /Encrypt gia (khong ma hoa that): du de pdf.js doi mat khau.
 */
export function buildPdf(pages: string[][], opts: { encrypted?: boolean } = {}): Buffer {
  const objects: string[] = [];
  const kids = pages.map((_p, i) => `${4 + i * 2} 0 R`).join(' ');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, i) => {
    const contentId = 5 + i * 2;
    const ops = lines.map((l, k) => `${k === 0 ? '' : 'T* '}(${pdfEscape(l)}) Tj`).join(' ');
    const stream = `BT /F1 12 Tf 14 TL 72 720 Td ${ops} ET`;
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let trailerExtra = '';
  if (opts.encrypted) {
    const id = objects.length;
    const hex32 = '00'.repeat(32);
    objects[id] = `<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -4 >>`;
    trailerExtra = ` /Encrypt ${id} 0 R /ID [<${'11'.repeat(16)}> <${'11'.repeat(16)}>]`;
  }

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
