import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const SHEET1_HEADERS = ['학년', '반', '번호', '이름', '활동명', '입력내용', '입력영역'];
const SHEET2_HEADERS = ['활동명', '활동내용', '입력영역'];

function verifyAdmin(request: Request): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return request.headers.get('Authorization') === `Bearer ${adminPassword}`;
}

async function getDoc() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) throw new Error('환경변수(.env.local)에 Google API 인증 정보가 누락되었습니다.');
  const jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const doc = new GoogleSpreadsheet(sheetId, jwt);
  await doc.loadInfo();
  return doc;
}

export async function POST(request: Request) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  try {
    const { target, rows, mode = 'replace' } = await request.json();

    if (!target || !['sheet1', 'sheet2'].includes(target)) {
      return NextResponse.json({ error: 'target은 sheet1 또는 sheet2이어야 합니다.' }, { status: 400 });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: '업로드할 데이터가 없습니다.' }, { status: 400 });
    }

    const doc = await getDoc();

    if (target === 'sheet1') {
      // 시트 1: index 0 원본 활동 데이터
      const sheet = doc.sheetsByIndex[0];
      if (!sheet) return NextResponse.json({ error: '시트 1이 존재하지 않습니다.' }, { status: 500 });

      // 헤더 검증
      const required = SHEET1_HEADERS;
      const firstRow = rows[0];
      const missing = required.filter(h => !(h in firstRow));
      if (missing.length > 0) {
        return NextResponse.json({ error: `필수 열이 없습니다: ${missing.join(', ')}` }, { status: 400 });
      }

      await sheet.setHeaderRow(SHEET1_HEADERS);

      if (mode === 'replace') {
        await sheet.clearRows();
        const cleanRows = rows.map((r: any) => ({
          학년: String(r['학년'] ?? ''),
          반: String(r['반'] ?? ''),
          번호: String(r['번호'] ?? ''),
          이름: String(r['이름'] ?? ''),
          활동명: String(r['활동명'] ?? ''),
          입력내용: String(r['입력내용'] ?? ''),
          입력영역: String(r['입력영역'] ?? ''),
        }));
        await sheet.addRows(cleanRows);
        return NextResponse.json({ success: true, addedRows: cleanRows.length, mode: 'replace' });
      } else {
        const cleanRows = rows.map((r: any) => ({
          학년: String(r['학년'] ?? ''),
          반: String(r['반'] ?? ''),
          번호: String(r['번호'] ?? ''),
          이름: String(r['이름'] ?? ''),
          활동명: String(r['활동명'] ?? ''),
          입력내용: String(r['입력내용'] ?? ''),
          입력영역: String(r['입력영역'] ?? ''),
        }));
        await sheet.addRows(cleanRows);
        return NextResponse.json({ success: true, addedRows: cleanRows.length, mode: 'append' });
      }
    }

    if (target === 'sheet2') {
      // 시트 2: '추가문구(자율)' 시트
      const allSheets = doc.sheetsByIndex;
      let recSheet = allSheets.find((s: any) => s.title === '추가문구(자율)');

      if (!recSheet) {
        // 추천 문구 시트가 없으면 새로 생성
        recSheet = await doc.addSheet({ title: '추가문구(자율)', headerValues: SHEET2_HEADERS });
      }

      const required = SHEET2_HEADERS;
      const firstRow = rows[0];
      const missing = required.filter(h => !(h in firstRow));
      if (missing.length > 0) {
        return NextResponse.json({ error: `필수 열이 없습니다: ${missing.join(', ')}` }, { status: 400 });
      }

      await recSheet.setHeaderRow(SHEET2_HEADERS);

      if (mode === 'replace') {
        await recSheet.clearRows();
        const cleanRows = rows.map((r: any) => ({
          활동명: String(r['활동명'] ?? ''),
          활동내용: String(r['활동내용'] ?? ''),
          입력영역: String(r['입력영역'] ?? ''),
        }));
        await recSheet.addRows(cleanRows);
        return NextResponse.json({ success: true, addedRows: cleanRows.length, sheetTitle: recSheet.title, mode: 'replace' });
      } else {
        const cleanRows = rows.map((r: any) => ({
          활동명: String(r['활동명'] ?? ''),
          활동내용: String(r['활동내용'] ?? ''),
          입력영역: String(r['입력영역'] ?? ''),
        }));
        await recSheet.addRows(cleanRows);
        return NextResponse.json({ success: true, addedRows: cleanRows.length, sheetTitle: recSheet.title, mode: 'append' });
      }
    }

    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  } catch (error: any) {
    console.error('Sheet upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
