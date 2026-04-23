import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const UPLOAD_SHEET_TITLE = '업로드데이터';
const UPLOAD_SHEET_HEADERS = ['학년', '반', '번호', '이름', '활동명', '입력내용', '입력영역'];

async function getJwt() {
  return new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // rows: [{ 학년, 반, 번호, 이름, 자율활동, 진로활동 }]
    const { rows } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: '업로드할 데이터가 없습니다.' }, { status: 400 });
    }

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
      return NextResponse.json({ error: '환경변수 설정이 누락되었습니다.' }, { status: 500 });
    }

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, await getJwt());
    await doc.loadInfo();

    // 업로드 전용 시트 가져오기 (없으면 생성, 있으면 헤더 최신화)
    let uploadSheet = doc.sheetsByTitle[UPLOAD_SHEET_TITLE];
    if (!uploadSheet) {
      uploadSheet = await doc.addSheet({
        title: UPLOAD_SHEET_TITLE,
        headerValues: UPLOAD_SHEET_HEADERS,
      });
    } else {
      // 헤더가 변경된 경우를 대비해 항상 최신 헤더로 갱신
      await uploadSheet.setHeaderRow(UPLOAD_SHEET_HEADERS);
    }

    // 기존 업로드 시트에서 이번에 업로드된 학급 데이터만 교체
    const uploadedClasses = new Set(rows.map((r: any) => `${r['학년']}-${r['반']}`));
    const existingRows = await uploadSheet.getRows();
    const rowsToKeep = existingRows
      .filter((r: any) => !uploadedClasses.has(`${r.get('학년')}-${r.get('반')}`))
      .map((r: any) => ({
        '학년': r.get('학년'),
        '반': r.get('반'),
        '번호': r.get('번호'),
        '이름': r.get('이름'),
        '활동명': r.get('활동명'),
        '입력내용': r.get('입력내용'),
        '입력영역': r.get('입력영역'),
      }));

    const deletedCount = existingRows.length - rowsToKeep.length;

    // 학생 1행 → 자율활동/진로활동 각 1행씩 분리
    const newActivityRows: any[] = [];
    for (const student of rows) {
      if (student['자율활동']) {
        newActivityRows.push({
          '학년': String(student['학년']),
          '반': String(student['반']),
          '번호': String(student['번호']),
          '이름': String(student['이름']),
          '활동명': String(student['자율활동명'] ?? ''),
          '입력내용': String(student['자율활동']),
          '입력영역': '자율활동',
        });
      }
      if (student['진로활동']) {
        newActivityRows.push({
          '학년': String(student['학년']),
          '반': String(student['반']),
          '번호': String(student['번호']),
          '이름': String(student['이름']),
          '활동명': String(student['진로활동명'] ?? ''),
          '입력내용': String(student['진로활동']),
          '입력영역': '진로활동',
        });
      }
    }

    // 업로드 시트 클리어 후 한 번에 재삽입 (Sheet 0 원본은 절대 건드리지 않음)
    await uploadSheet.clearRows();
    const allRows = [...rowsToKeep, ...newActivityRows];
    if (allRows.length > 0) {
      await uploadSheet.addRows(allRows);
    }

    return NextResponse.json({
      success: true,
      addedRows: newActivityRows.length,
      deletedRows: deletedCount,
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
